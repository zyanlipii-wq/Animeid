import { HLSPlayer } from './hls-player.js';

import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signInWithPopup,
    onAuthStateChanged,
    signOut,
    deleteUser,
    updateProfile
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { 
    collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, 
    addDoc, updateDoc, increment, arrayUnion, arrayRemove, serverTimestamp, 
    onSnapshot, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";

// Global state
let currentUser = null;
let userData = null;
let currentPage = 'home';
let currentHlsPlayer = null;

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        document.getElementById('splash').style.opacity = '0';
        setTimeout(() => {
            document.getElementById('splash').classList.add('hidden');
            initAuth();
        }, 500);
    }, 2000);
});

function initAuth() {
    onAuthStateChanged(window.auth, async (user) => {
        if (user) {
            currentUser = user;
            const docSnap = await getDoc(doc(window.db, 'users', user.uid));
            userData = docSnap.data();
            
            // Set online status
            await updateDoc(doc(window.db, 'users', user.uid), { 
                status: 'online',
                lastActive: serverTimestamp()
            });
            
            // Set offline on disconnect
            window.addEventListener('beforeunload', () => {
                updateDoc(doc(window.db, 'users', user.uid), { status: 'offline' });
            });
            
            document.getElementById('auth').classList.add('hidden');
            document.getElementById('app').classList.remove('hidden');
            
            setupNav();
            go('home');
        } else {
            document.getElementById('auth').classList.remove('hidden');
        }
    });
}

// ========== AUTH ==========
window.switchTab = (type) => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('login-form').classList.toggle('hidden', type !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', type !== 'register');
};

window.register = async () => {
    const username = document.getElementById('reg-user').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-pass').value;
    const ownerCode = document.getElementById('owner-code').value;

    if (!username || !email || !password) return alert('Lengkapi data!');

    try {
        const { user } = await createUserWithEmailAndPassword(window.auth, email, password);
        const isOwner = ownerCode === window.OWNER_CODE;
        const allUsers = await getDocs(collection(window.db, 'users'));
        const userNum = allUsers.size;
        
        // Super badge untuk user 1-10
        let superBadge = null;
        if (userNum <= 10) {
            superBadge = {
                active: 'sepuh',
                items: ['sepuh', 'sensei', 'pro', 'hacker'],
                unlocked: ['sepuh', 'sensei', 'pro', 'hacker'] // Semua gratis
            };
        }
        
        await setDoc(doc(window.db, 'users', user.uid), {
            uid: user.uid,
            username,
            email,
            isOwner,
            role: isOwner ? 'owner' : 'user',
            photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
            status: 'online',
            level: 1,
            xp: 0,
            coins: isOwner ? 999999999 : 100,
            watchedAnime: [],
            totalEpisodes: 0,
            favorites: [], // Subscribe anime
            downloads: [], // Download tracking
            badges: [],
            vip: null,
            usernameColor: null,
            avatarFrame: null,
            inventory: [],
            superBadge,
            createdAt: serverTimestamp()
        });
    } catch (e) {
        alert(e.message);
    }
};

window.login = async () => {
    try {
        await signInWithEmailAndPassword(window.auth, 
            document.getElementById('login-email').value,
            document.getElementById('login-password').value
        );
    } catch (e) {
        alert(e.message);
    }
};

window.googleLogin = async () => {
    try {
        const { user } = await signInWithPopup(window.auth, window.googleProvider);
        const userDoc = await getDoc(doc(window.db, 'users', user.uid));
        
        if (!userDoc.exists()) {
            await setDoc(doc(window.db, 'users', user.uid), {
                uid: user.uid,
                username: user.displayName || 'User',
                email: user.email,
                isOwner: false,
                photoURL: user.photoURL,
                status: 'online',
                level: 1,
                xp: 0,
                coins: 100,
                watchedAnime: [],
                totalEpisodes: 0,
                favorites: [],
                downloads: [],
                badges: [],
                vip: null,
                usernameColor: null,
                avatarFrame: null,
                inventory: [],
                createdAt: serverTimestamp()
            });
        }
    } catch (e) {
        alert(e.message);
    }
};

window.logout = () => {
    if (currentUser) {
        updateDoc(doc(window.db, 'users', currentUser.uid), { status: 'offline' });
    }
    signOut(window.auth);
};

// ========== NAVIGATION ==========
function setupNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            go(page);
        });
    });
}

window.go = (page, params = {}) => {
    currentPage = page;
    currentHlsPlayer?.destroy();
    currentHlsPlayer = null;
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
    
    const main = document.getElementById('main');
    main.innerHTML = '';
    
    switch(page) {
        case 'home': renderHome(main); break;
        case 'search': renderSearch(main); break;
        case 'feed': renderFeed(main); break;
        case 'profile': renderProfile(main, params.uid || currentUser.uid); break;
        case 'anime': renderAnime(main, params.id); break;
        case 'watch': renderWatch(main, params.animeId, params.epId); break;
        case 'settings': renderSettings(main); break;
        case 'store': renderStore(main, params.cat); break;
        case 'legal': renderLegal(main, params.type); break;
        case 'admin': userData?.isOwner && renderAdmin(main); break;
    }
};

// ========== HOME ==========
async function renderHome(container) {
    const q = query(collection(window.db, 'anime'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const anime = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    let html = `
        <div class="card">
            <h3 style="margin-bottom:12px">🎉 Event Terbaru</h3>
            <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:20px;border-radius:12px;text-align:center">
                <p>Grand Opening! Daftar dapat 100 coin gratis!</p>
            </div>
        </div>
        <div class="section-title">
            <h2>Anime Terbaru</h2>
            ${userData?.isOwner ? `<button onclick="go('admin')" style="width:auto;padding:8px 16px;background:#ff453a">+ Upload</button>` : ''}
        </div>
    `;

    if (!anime.length) {
        html += `<div class="card" style="text-align:center;padding:40px"><p style="color:#8e8e93">Belum ada anime</p></div>`;
    } else {
        html += '<div class="grid">' + anime.map(a => `
            <div class="anime-card" onclick="go('anime',{id:'${a.id}'})">
                <img src="${a.poster}" loading="lazy">
                <div class="anime-info">
                    <div class="anime-title">${a.title}</div>
                    <div class="anime-meta">${a.episodes?.length||0} Episode</div>
                </div>
            </div>
        `).join('') + '</div>';
    }
    
    container.innerHTML = html;
}

// ========== SEARCH (Anime + User) ==========
let searchType = 'anime';

function renderSearch(container) {
    container.innerHTML = `
        <div class="card">
            <input type="text" id="search" placeholder="Cari anime atau user..." onkeyup="doSearch(this.value)" style="margin-bottom:12px">
            <div class="filter-bar" style="margin-bottom:0">
                <button class="filter-btn ${searchType==='anime'?'active':''}" onclick="setSearchType('anime')">📺 Anime</button>
                <button class="filter-btn ${searchType==='user'?'active':''}" onclick="setSearchType('user')">👤 Pengguna</button>
            </div>
        </div>
        <div id="results"></div>
    `;
}

window.setSearchType = (type) => {
    searchType = type;
    const input = document.getElementById('search');
    if (input?.value) {
        renderSearch(document.getElementById('main'));
        doSearch(input.value);
    } else {
        renderSearch(document.getElementById('main'));
    }
};

window.doSearch = async (v) => {
    if (!v) return document.getElementById('results').innerHTML = '';
    
    if (searchType === 'anime') {
        const q = query(
            collection(window.db, 'anime'), 
            where('title','>=',v), 
            where('title','<=',v+'\uf8ff')
        );
        const snap = await getDocs(q);
        const res = snap.docs.map(d => ({id:d.id,...d.data()}));
        
        document.getElementById('results').innerHTML = res.length ? 
            '<div class="grid">' + res.map(r => `
                <div class="anime-card" onclick="go('anime',{id:'${r.id}'})">
                    <img src="${r.poster}">
                    <div class="anime-info"><div class="anime-title">${r.title}</div></div>
                </div>
            `).join('') + '</div>' : 
            '<p style="text-align:center;color:#8e8e93;padding:40px">Tidak ada hasil</p>';
    } else {
        // Search user
        const q = query(
            collection(window.db, 'users'),
            where('username','>=',v),
            where('username','<=',v+'\uf8ff')
        );
        const snap = await getDocs(q);
        const users = snap.docs.map(d => ({id:d.id,...d.data()}));
        
        document.getElementById('results').innerHTML = users.length ?
            users.map(u => `
                <div class="card" onclick="go('profile',{uid:'${u.uid}'})" style="display:flex;align-items:center;gap:12px;cursor:pointer">
                    <div style="position:relative">
                        <img src="${u.photoURL}" style="width:50px;height:50px;border-radius:50%;border:3px solid ${u.avatarFrame||'transparent'}">
                        ${u.status==='online' ? '<div style="position:absolute;bottom:0;right:0;width:14px;height:14px;background:#30d158;border-radius:50%;border:2px solid #000"></div>' : ''}
                    </div>
                    <div style="flex:1">
                        <div style="font-weight:600;color:${u.usernameColor||'inherit'};display:flex;align-items:center;gap:6px">
                            ${u.username}
                            ${u.vip==='prince' ? '<span class="rgb">👑</span>' : u.vip ? '💎' : ''}
                            ${renderBadgesMini(u)}
                        </div>
                        <div style="font-size:12px;color:#8e8e93">Lv.${u.level} • ${u.watchedAnime?.length||0} anime</div>
                    </div>
                    <span style="color:#8e8e93">›</span>
                </div>
            `).join('') :
            '<p style="text-align:center;color:#8e8e93;padding:40px">Tidak ada user</p>';
    }
};

function renderBadgesMini(u) {
    let html = '';
    if (u.superBadge) {
        const icons = {sepuh:'👑',sensei:'🎓',pro:'⚡',hacker:'💻'};
        html += `<span style="font-size:12px">${icons[u.superBadge.active]}</span>`;
    }
    return html;
}

// ========== ANIME DETAIL ==========
async function renderAnime(container, id) {
    const d = await getDoc(doc(window.db, 'anime', id));
    const a = d.data();
    const isFav = userData.favorites?.includes(id);
    
    container.innerHTML = `
        <div class="card" style="text-align:center;position:relative">
            <img src="${a.poster}" style="width:200px;border-radius:16px;margin-bottom:16px">
            <button onclick="toggleFav('${id}')" style="position:absolute;top:20px;right:20px;width:auto;padding:8px 12px;background:${isFav?'#ff2d55':'#1c1c1e'};border-radius:20px">
                ${isFav?'❤️':'🤍'}
            </button>
            <h2>${a.title}</h2>
            <p style="color:#8e8e93;margin:8px 0">${a.studio} • ${a.genre?.join(', ')}</p>
            <p style="font-size:14px;line-height:1.6">${a.synopsis}</p>
        </div>
        <h3 style="margin:20px 0 12px">Episode</h3>
        ${a.episodes?.map((e,i) => `
            <div class="card" onclick="go('watch',{animeId:'${id}',epId:${i}})" style="display:flex;align-items:center;gap:12px;cursor:pointer">
                <div style="width:80px;height:60px;background:#2c2c2e;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px">▶</div>
                <div style="flex:1">
                    <div style="font-weight:600">Episode ${e.number}</div>
                    <div style="font-size:12px;color:#8e8e93">${e.title||''}</div>
                </div>
                ${e.isHLS ? '<span style="background:#30d158;color:#000;padding:4px 8px;border-radius:4px;font-size:10px">HLS</span>' : ''}
            </div>
        `).join('') || '<p>Tidak ada episode</p>'}
    `;
}

window.toggleFav = async (id) => {
    const isFav = userData.favorites?.includes(id);
    await updateDoc(doc(window.db, 'users', currentUser.uid), {
        favorites: isFav ? arrayRemove(id) : arrayUnion(id)
    });
    userData.favorites = isFav ? 
        userData.favorites.filter(x => x !== id) : 
        [...(userData.favorites||[]), id];
    go('anime', {id});
};

// ========== WATCH ==========
async function renderWatch(container, animeId, epId) {
    const d = await getDoc(doc(window.db, 'anime', animeId));
    const a = d.data();
    const e = a.episodes[epId];
    
    // Update stats
    if (!userData.watchedAnime?.includes(animeId)) {
        await updateDoc(doc(window.db, 'users', currentUser.uid), {
            watchedAnime: arrayUnion(animeId),
            totalEpisodes: increment(1),
            xp: increment(10)
        });
    }
    
    container.innerHTML = `
        <div class="card" style="padding:0">
            <div class="player-container">
                <div id="video-box"></div>
                ${e.isHLS ? '<span class="quality-badge">HLS LIVE</span>' : ''}
            </div>
            <div style="padding:16px">
                <h3>${a.title} - Ep ${e.number}</h3>
                <p style="color:#8e8e93;font-size:14px">${e.title||''}</p>
                <button onclick="addToDownloads('${animeId}',${epId})" style="width:auto;margin-top:12px;background:#007aff;padding:8px 16px">
                    ⬇️ Tandai Sudah Download
                </button>
            </div>
        </div>
        <div class="card">
            <h4 style="margin-bottom:12px">💬 Komentar</h4>
            <div id="comments"></div>
            <div style="display:flex;gap:8px;margin-top:12px">
                <input type="text" id="cmt" placeholder="Tulis komentar..." style="flex:1;margin-bottom:0">
                <button onclick="sendCmt('${animeId}',${epId})" class="btn-primary" style="width:auto">Kirim</button>
            </div>
        </div>
    `;
    
    // Player
    currentHlsPlayer = new HLSPlayer('video-box', e.videoUrl, { autoplay: true, controls: true });
    currentHlsPlayer.init();
    
    // XP timer
    let xpTimer = setInterval(() => {
        if (currentHlsPlayer && !currentHlsPlayer.paused) {
            updateDoc(doc(window.db, 'users', currentUser.uid), { xp: increment(1) });
        }
    }, 1000);
    
    currentHlsPlayer.video?.addEventListener('pause', () => clearInterval(xpTimer));
    
    // Comments with replies
    loadComments(animeId, epId);
}

window.addToDownloads = async (aid, eid) => {
    const downloadData = { animeId: aid, epId: eid, time: new Date().toISOString() };
    await updateDoc(doc(window.db, 'users', currentUser.uid), {
        downloads: arrayUnion(downloadData)
    });
    alert('Ditambahkan ke daftar unduhan!');
};

function loadComments(animeId, epId) {
    const q = query(
        collection(window.db, 'comments'), 
        where('animeId','==',animeId), 
        where('epId','==',epId), 
        orderBy('time','desc')
    );
    
    onSnapshot(q, snap => {
        document.getElementById('comments').innerHTML = snap.docs.map(d => {
            const c = d.data();
            return renderComment(d.id, c);
        }).join('') || '<p style="color:#8e8e93">Belum ada komentar</p>';
    });
}

function renderComment(id, c) {
    const u = c.user || {};
    const isRGB = u.vip === 'prince';
    
    return `
        <div class="comment" id="cmt-${id}">
            <img src="${u.photo}" class="comment-avatar" style="${u.avatarFrame ? `border:2px solid ${u.avatarFrame};border-radius:50%` : ''}">
            <div class="comment-content">
                <div class="comment-author" style="color:${u.color||'inherit'};display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    ${u.name}
                    ${isRGB ? '<span class="rgb">👑 PRINCE</span>' : u.vip ? '💎' : ''}
                    ${renderBadgesComment(u)}
                </div>
                <div class="comment-text">${c.text}</div>
                <div class="comment-actions">
                    <span onclick="likeCmt('${id}')">❤️ ${c.likes||0}</span>
                    <span onclick="showReply('${id}')">💬 Balas</span>
                    ${c.replies?.length ? `<span>${c.replies.length} balasan</span>` : ''}
                </div>
                ${c.replies?.length ? `
                    <div style="margin-top:12px;padding-left:12px;border-left:2px solid #2c2c2e">
                        ${c.replies.map(r => `
                            <div style="margin-bottom:8px;font-size:13px">
                                <strong style="color:${r.user?.color||'inherit'}">${r.user?.name}</strong>
                                ${r.user?.vip==='prince'?'<span class="rgb">👑</span>':''}
                                <span style="color:#8e8e93">${r.text}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                <div id="reply-${id}" class="hidden" style="margin-top:8px;display:flex;gap:8px">
                    <input type="text" id="reply-text-${id}" placeholder="Balas..." style="flex:1;margin-bottom:0;padding:8px 12px;font-size:14px">
                    <button onclick="sendReply('${id}')" style="width:auto;padding:8px 16px;font-size:14px">Kirim</button>
                </div>
            </div>
        </div>
    `;
}

function renderBadgesComment(u) {
    let html = '';
    if (u.superBadge) {
        const icons = {sepuh:'👑',sensei:'🎓',pro:'⚡',hacker:'💻'};
        html += `<span style="font-size:14px">${icons[u.superBadge.active]}</span>`;
    }
    if (u.badges?.includes('raja')) html += '🥇';
    else if (u.badges?.includes('master')) html += '🥈';
    else if (u.badges?.includes('bronze')) html += '🥉';
    return html;
}

window.sendCmt = async (aid, eid) => {
    const text = document.getElementById('cmt').value;
    if (!text) return;
    
    await addDoc(collection(window.db, 'comments'), {
        animeId: aid, 
        epId: eid, 
        text,
        user: { 
            name: userData.username, 
            photo: userData.photoURL, 
            vip: userData.vip, 
            color: userData.usernameColor,
            avatarFrame: userData.avatarFrame,
            superBadge: userData.superBadge,
            badges: userData.badges
        },
        likes: 0,
        likedBy: [],
        replies: [],
        time: serverTimestamp()
    });
    document.getElementById('cmt').value = '';
};

window.showReply = (id) => {
    document.getElementById(`reply-${id}`).classList.toggle('hidden');
};

window.sendReply = async (id) => {
    const text = document.getElementById(`reply-text-${id}`).value;
    if (!text) return;
    
    const reply = {
        user: {
            name: userData.username,
            photo: userData.photoURL,
            vip: userData.vip,
            color: userData.usernameColor,
            avatarFrame: userData.avatarFrame
        },
        text,
        time: new Date().toISOString()
    };
    
    await updateDoc(doc(window.db, 'comments', id), {
        replies: arrayUnion(reply)
    });
};

window.likeCmt = async (id) => {
    const ref = doc(window.db, 'comments', id);
    const d = await getDoc(ref);
    const data = d.data();
    const liked = data.likedBy?.includes(currentUser.uid);
    
    await updateDoc(ref, liked ? {
        likes: increment(-1),
        likedBy: arrayRemove(currentUser.uid)
    } : {
        likes: increment(1),
        likedBy: arrayUnion(currentUser.uid)
    });
};

// ========== PROFILE (Self & Others) ==========
async function renderProfile(container, uid) {
    const isSelf = uid === currentUser.uid;
    const d = await getDoc(doc(window.db, 'users', uid));
    const u = d.data();
    
    const levelNeed = u.level * 100;
    const progress = ((u.xp % levelNeed) / levelNeed * 100).toFixed(0);
    
    let html = `
        <div class="profile-header">
            <div style="position:relative;display:inline-block">
                <img src="${u.photoURL}" class="profile-avatar" style="${u.avatarFrame ? `border-color:${u.avatarFrame}` : ''}">
                ${u.status==='online' ? '<div class="pulse-ring"></div>' : ''}
            </div>
            <h2 style="color:${u.usernameColor||'inherit'};display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">
                ${u.username}
                ${u.vip==='prince' ? '<span class="rgb">👑</span>' : ''}
            </h2>
            <div class="online" style="color:${u.status==='online'?'#30d158':'#8e8e93'}">
                ● ${u.status==='online'?'Online':'Offline'}
            </div>
            ${u.isOwner?'<div style="color:#ff9f0a;font-size:12px;margin-top:8px">👑 OWNER</div>':''}
            ${renderBadgesFull(u)}
        </div>
        
        <div class="stats">
            <div class="stat"><div class="stat-value">${u.watchedAnime?.length||0}</div><div class="stat-label">Anime</div></div>
            <div class="stat"><div class="stat-value">${u.totalEpisodes||0}</div><div class="stat-label">Episode</div></div>
            <div class="stat"><div class="stat-value">${u.level}</div><div class="stat-label">Level</div></div>
        </div>
        
        <div class="card">
            <div class="level-header"><span>Level ${u.level}</span><span>${u.xp} XP</span></div>
            <div class="level-bar"><div class="level-progress" style="width:${progress}%"></div></div>
        </div>
    `;
    
    if (isSelf) {
        html += `
            <div class="card" style="display:flex;justify-content:space-between;align-items:center">
                <span>💰 Saldo</span>
                <span style="font-size:24px;font-weight:700;color:#ff9f0a">${u.coins?.toLocaleString()||0}</span>
            </div>
            <div class="card" onclick="go('settings')" style="cursor:pointer">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span>⚙️ Pengaturan</span>
                    <span style="color:#8e8e93">›</span>
                </div>
            </div>
            ${u.isOwner?'<button class="admin-btn" onclick="go(\'admin\')">⚙️</button>':''}
        `;
    }
    
    container.innerHTML = html;
}

function renderBadgesFull(u) {
    if (!u.superBadge && !u.badges?.length && !u.vip) return '';
    
    let html = '<div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">';
    
    if (u.superBadge) {
        const icons = {sepuh:'👑 Sepuh',sensei:'🎓 Sensei',pro:'⚡ Pro',hacker:'💻 Hacker'};
        html += `<span class="rgb" style="font-size:12px;background:#1c1c1e;padding:4px 12px;border-radius:12px">${icons[u.superBadge.active]}</span>`;
    }
    
    if (u.vip && u.vip !== 'prince') {
        const colors = {bronze:'#cd7f32',gold:'#ffd700',diamond:'#b9f2ff',master:'#ff6b6b'};
        html += `<span style="font-size:12px;background:${colors[u.vip]};color:#000;padding:4px 12px;border-radius:12px">${u.vip.toUpperCase()}</span>`;
    }
    
    u.badges?.forEach(b => {
        const icons = {bronze:'🥉',master:'🥈',raja:'🥇'};
        html += `<span style="font-size:12px;background:#1c1c1e;padding:4px 8px;border-radius:8px">${icons[b]}</span>`;
    });
    
    html += '</div>';
    return html;
}

// ========== SETTINGS ==========
function renderSettings(container) {
    container.innerHTML = `
        <h2 style="margin-bottom:20px">Pengaturan</h2>
        
        <div class="card" onclick="showEditProfile()" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>✏️ Edit Profil</span>
                <span style="color:#8e8e93">›</span>
            </div>
        </div>
        
        <div class="card" onclick="go('store')" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>🛒 Toko</span>
                <span style="color:#8e8e93">›</span>
            </div>
        </div>
        
        <div class="card" onclick="showFavorites()" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>❤️ Subscribe (Favorit)</span>
                <span style="color:#8e8e93">${userData.favorites?.length||0} ›</span>
            </div>
        </div>
        
        <div class="card" onclick="showDownloads()" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>⬇️ Unduhan</span>
                <span style="color:#8e8e93">${userData.downloads?.length||0} ›</span>
            </div>
        </div>
        
        <div class="card" onclick="showInventory()" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>🎒 My Koleksi</span>
                <span style="color:#8e8e93">${userData.inventory?.length||0} item ›</span>
            </div>
        </div>
        
        <h3 style="margin:24px 0 12px;color:#8e8e93;font-size:14px;text-transform:uppercase">Legal</h3>
        
        <div class="card" onclick="go('legal',{type:'about'})" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>ℹ️ Tentang NanimeX</span>
                <span style="color:#8e8e93">›</span>
            </div>
        </div>
        
        <div class="card" onclick="go('legal',{type:'privacy'})" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>🔒 Privacy Policy</span>
                <span style="color:#8e8e93">›</span>
            </div>
        </div>
        
        <div class="card" onclick="go('legal',{type:'dmca'})" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>⚖️ DMCA</span>
                <span style="color:#8e8e93">›</span>
            </div>
        </div>
        
        <div class="card" onclick="go('legal',{type:'disclaimer'})" style="cursor:pointer;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span>⚠️ Disclaimer</span>
                <span style="color:#8e8e93">›</span>
            </div>
        </div>
        
        <h3 style="margin:24px 0 12px;color:#8e8e93;font-size:14px;text-transform:uppercase">Akun</h3>
        
        <div class="card" onclick="switchAccount()" style="cursor:pointer;color:#0a84ff;margin-bottom:12px">
            🔄 Ganti Akun
        </div>
        
        <div class="card" onclick="logout()" style="cursor:pointer;color:#ff453a;margin-bottom:12px">
            🚪 Keluar
        </div>
        
        <div class="card" onclick="deleteAccount()" style="cursor:pointer;color:#ff453a">
            🗑️ Hapus Akun Permanen
        </div>
    `;
}

window.showEditProfile = () => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3 style="margin-bottom:16px">Edit Profil</h3>
            <input type="text" id="edit-name" value="${userData.username}" placeholder="Username baru">
            <input type="text" id="edit-photo" value="${userData.photoURL}" placeholder="URL Foto (atau kosongkan)">
            <div style="display:flex;gap:12px;margin-top:16px">
                <button onclick="this.closest('.modal-overlay').remove()" style="flex:1;background:#2c2c2e">Batal</button>
                <button onclick="saveProfile()" class="btn-primary" style="flex:1">Simpan</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
};

window.saveProfile = async () => {
    const name = document.getElementById('edit-name').value;
    const photo = document.getElementById('edit-photo').value;
    
    await updateDoc(doc(window.db, 'users', currentUser.uid), {
        username: name,
        photoURL: photo || userData.photoURL
    });
    
    // Update auth profile
    await updateProfile(currentUser, { displayName: name, photoURL: photo });
    
    userData.username = name;
    if (photo) userData.photoURL = photo;
    
    document.querySelector('.modal-overlay').remove();
    alert('Profil diperbarui!');
    go('profile');
};

window.showFavorites = async () => {
    if (!userData.favorites?.length) {
        alert('Belum ada anime favorit');
        return;
    }
    
    const container = document.getElementById('main');
    let html = '<h3 style="margin-bottom:16px">❤️ Anime Favorit</h3>';
    
    for (const favId of userData.favorites) {
        const d = await getDoc(doc(window.db, 'anime', favId));
        if (d.exists()) {
            const a = d.data();
            html += `
                <div class="card" onclick="go('anime',{id:'${favId}'})" style="display:flex;gap:12px;cursor:pointer">
                    <img src="${a.poster}" style="width:80px;height:100px;object-fit:cover;border-radius:8px">
                    <div>
                        <div style="font-weight:600">${a.title}</div>
                        <div style="font-size:12px;color:#8e8e93">${a.episodes?.length||0} episode</div>
                    </div>
                </div>
            `;
        }
    }
    
    container.innerHTML = html;
};

window.showDownloads = () => {
    if (!userData.downloads?.length) {
        alert('Belum ada unduhan');
        return;
    }
    
    const container = document.getElementById('main');
    container.innerHTML = `
        <h3 style="margin-bottom:16px">⬇️ Daftar Unduhan</h3>
        ${userData.downloads.map(d => `
            <div class="card" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-weight:600">Episode ${d.epId + 1}</div>
                    <div style="font-size:12px;color:#8e8e93">${new Date(d.time).toLocaleDateString('id-ID')}</div>
                </div>
                <span style="color:#30d158">✓</span>
            </div>
        `).join('')}
    `;
};

window.switchAccount = () => {
    logout();
};

window.deleteAccount = async () => {
    if (!confirm('PERINGATAN: Semua data akan dihapus permanen!\nLanjutkan?')) return;
    if (!confirm('Yakin? Ini tidak bisa dibatalkan!')) return;
    
    try {
        await deleteDoc(doc(window.db, 'users', currentUser.uid));
        await deleteUser(currentUser);
    } catch (e) {
        alert('Error: ' + e.message);
    }
};

// ========== STORE (Lengkap) ==========
const STORE = {
    badges: [
        {id:'bronze',name:'Bronze',price:1000,icon:'🥉'},
        {id:'master',name:'Master',price:5000,icon:'🥈'},
        {id:'raja',name:'Raja',price:10000,icon:'🥇'}
    ],
    vip: [
        {id:'bronze',name:'Bronze VIP',price:50000,color:'#cd7f32'},
        {id:'gold',name:'Gold VIP',price:100000,color:'#ffd700'},
        {id:'diamond',name:'Diamond VIP',price:250000,color:'#b9f2ff'},
        {id:'master',name:'Master VIP',price:500000,color:'#ff6b6b'},
        {id:'prince',name:'Prince VIP',price:1000000,rgb:true,tag:'RGB ANIMATION'}
    ],
    super: [], // Gratis untuk user 1-10, dipilih di settings
    colors: generateColors(),
    frames: generateFrames()
};

function generateColors() {
    const colors = [];
    const names = ['Merah','Biru','Hijau','Ungu','Pink','Orange','Cyan','Magenta','Kuning','Silver'];
    const hex = ['#ff3b30','#007aff','#34c759','#af52de','#ff2d55','#ff9500','#5ac8fa','#ff00ff','#ffcc00','#c0c0c0'];
    
    for (let i = 0; i < 67; i++) {
        const tier = Math.floor(i / 10) + 1;
        colors.push({
            id: `color-${i}`,
            name: i === 66 ? 'RGB OWNER' : `${names[i % 10]} Tier ${tier}`,
            price: i === 66 ? 999999 : tier * 5000,
            color: i === 66 ? 'rgb' : hex[i % 10],
            isRGB: i === 66
        });
    }
    return colors;
}

function generateFrames() {
    const tiers = [
        {name:'Basic',price:10000,color:'#8e8e93'},
        {name:'Iron',price:15000,color:'#9a9a9a'},
        {name:'Bronze',price:25000,color:'#cd7f32'},
        {name:'Silver',price:50000,color:'#c0c0c0'},
        {name:'Gold',price:100000,color:'#ffd700'}
    ];
    
    const frames = [];
    for (let i = 0; i < 40; i++) {
        const tier = Math.floor(i / 8);
        frames.push({
            id: `frame-${i}`,
            name: `${tiers[tier].name} Frame ${(i % 8) + 1}`,
            price: tiers[tier].price,
            color: tiers[tier].color,
            tier: tier + 1
        });
    }
    return frames;
}

function renderStore(container, cat = 'vip') {
    let items = [];
    let title = '';
    
    switch(cat) {
        case 'vip': items = STORE.vip; title = 'VIP Membership'; break;
        case 'badges': items = STORE.badges; title = 'Badge'; break;
        case 'colors': items = STORE.colors; title = 'Warna Username'; break;
        case 'frames': items = STORE.frames; title = 'Avatar Frame'; break;
        case 'super': 
            if (userData.superBadge) {
                items = userData.superBadge.items.map(item => ({
                    id: item,
                    name: item.charAt(0).toUpperCase() + item.slice(1),
                    price: 0,
                    icon: {sepuh:'👑',sensei:'🎓',pro:'⚡',hacker:'💻'}[item],
                    owned: userData.superBadge.active === item
                }));
                title = 'Super Badge (Gratis)';
            } else {
                title = 'Super Badge - Hanya untuk user #1-10';
            }
            break;
    }
    
    container.innerHTML = `
        <h2 style="margin-bottom:16px">${title}</h2>
        <div class="filter-bar" style="margin-bottom:16px">
            <button class="filter-btn ${cat==='vip'?'active':''}" onclick="go('store',{cat:'vip'})">VIP</button>
            <button class="filter-btn ${cat==='badges'?'active':''}" onclick="go('store',{cat:'badges'})">Badge</button>
            <button class="filter-btn ${cat==='colors'?'active':''}" onclick="go('store',{cat:'colors'})">Warna</button>
            <button class="filter-btn ${cat==='frames'?'active':''}" onclick="go('store',{cat:'frames'})">Frame</button>
            ${userData.superBadge ? `<button class="filter-btn ${cat==='super'?'active':''}" onclick="go('store',{cat:'super'})">Super</button>` : ''}
        </div>
        <div class="store-grid">
            ${items.map(i => renderStoreItem(i, cat)).join('')}
        </div>
    `;
}

function renderStoreItem(i, cat) {
    let owned = false;
    let active = false;
    
    if (cat === 'vip') owned = userData.vip === i.id;
    else if (cat === 'badges') owned = userData.badges?.includes(i.id);
    else if (cat === 'colors') {
        owned = userData.inventory?.includes(i.id);
        active = userData.usernameColor === i.id;
    }
    else if (cat === 'frames') {
        owned = userData.inventory?.includes(i.id);
        active = userData.avatarFrame === i.color;
    }
    else if (cat === 'super') {
        owned = i.owned;
        active = i.owned;
    }
    
    const style = i.rgb ? 'background:linear-gradient(45deg,red,orange,yellow,green,blue,indigo,violet)' : 
                   i.color ? `background:${i.color}` : '';
    
    return `
        <div class="store-item ${owned?'owned':''} ${active?'active':''}" style="${active?'border-color:#30d158':''}">
            <div class="item-preview" style="${style};${i.isRGB?'animation:rgb 3s linear infinite':''}">
                ${i.icon || '👤'}
            </div>
            <div class="item-name ${i.rgb||i.isRGB?'rgb':''}">${i.name}</div>
            <div class="item-price">${i.price ? i.price.toLocaleString() + ' 🪙' : '✨ GRATIS'}</div>
            <button onclick="buy('${cat}','${i.id}',${i.price},'${i.color||''}')" 
                    style="background:${active?'#30d158':owned?'#2c2c2e':'#0a84ff'};width:auto;padding:8px 16px;font-size:14px"
                    ${owned && !active ? '' : owned && active ? 'disabled' : ''}>
                ${active ? '✓ Aktif' : owned ? 'Pilih' : i.price ? 'Beli' : 'Klaim'}
            </button>
        </div>
    `;
}

window.buy = async (cat, id, price, extra = '') => {
    if (cat === 'super') {
        // Ganti super badge aktif
        await updateDoc(doc(window.db, 'users', currentUser.uid), {
            'superBadge.active': id
        });
        userData.superBadge.active = id;
        alert('Super badge diganti!');
        go('store', {cat});
        return;
    }
    
    const owned = userData.inventory?.includes(id) || 
                 (cat === 'vip' && userData.vip === id) ||
                 (cat === 'colors' && userData.usernameColor === id) ||
                 (cat === 'frames' && userData.avatarFrame === extra);
    
    // Kalau sudah punya tapi bukan yang aktif, aktifkan saja
    if (owned && cat === 'colors') {
        await updateDoc(doc(window.db, 'users', currentUser.uid), { usernameColor: id });
        userData.usernameColor = id;
        go('store', {cat});
        return;
    }
    
    if (owned && cat === 'frames') {
        await updateDoc(doc(window.db, 'users', currentUser.uid), { avatarFrame: extra });
        userData.avatarFrame = extra;
        go('store', {cat});
        return;
    }
    
    if (userData.coins < price) return alert('Koin tidak cukup!');
    
    const upd = { coins: increment(-price), inventory: arrayUnion(id) };
    
    if (cat === 'vip') upd.vip = id;
    if (cat === 'badges') upd.badges = arrayUnion(id);
    if (cat === 'colors') upd.usernameColor = id;
    if (cat === 'frames') upd.avatarFrame = extra;
    
    await updateDoc(doc(window.db, 'users', currentUser.uid), upd);
    userData.coins -= price;
    alert('Berhasil dibeli!');
    go('store', {cat});
};

window.showInventory = () => {
    const container = document.getElementById('main');
    let html = '<h3 style="margin-bottom:16px">🎒 My Koleksi</h3>';
    
    // VIP
    if (userData.vip) {
        const vip = STORE.vip.find(v => v.id === userData.vip);
        html += `
            <div class="card" style="border-color:${vip.color}">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:50px;height:50px;border-radius:50%;background:${vip.rgb?'linear-gradient(45deg,red,orange,yellow,green,blue,indigo,violet)':vip.color}"></div>
                    <div>
                        <div style="font-weight:600 ${vip.rgb?'rgb':''}">${vip.name}</div>
                        <div style="font-size:12px;color:#30d158">✓ Aktif</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    // Super Badge
    if (userData.superBadge) {
        const icons = {sepuh:'👑',sensei:'🎓',pro:'⚡',hacker:'💻'};
        html += `
            <div class="card" style="border:2px solid transparent;position:relative">
                <div style="position:absolute;inset:-2px;background:linear-gradient(45deg,red,orange,yellow,green,blue,indigo,violet);border-radius:18px;z-index:-1"></div>
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="font-size:32px">${icons[userData.superBadge.active]}</div>
                    <div>
                        <div class="rgb" style="font-weight:600;text-transform:uppercase">${userData.superBadge.active}</div>
                        <div style="font-size:12px;color:#8e8e93">Super Badge #${userData.uid.slice(0,4)}</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    // Colors
    const colors = userData.inventory?.filter(i => i.startsWith('color-')) || [];
    if (colors.length) {
        html += '<h4 style="margin:16px 0 12px">Warna Username</h4>';
        colors.forEach(c => {
            const color = STORE.colors.find(x => x.id === c);
            if (color) {
                html += `
                    <div class="card" style="display:flex;align-items:center;gap:12px;border-color:${userData.usernameColor===c?'#30d158':'transparent'}">
                        <div style="width:30px;height:30px;border-radius:50%;background:${color.isRGB?'linear-gradient(45deg,red,orange,yellow,green,blue,indigo,violet)':color.color}"></div>
                        <div style="flex:1;color:${color.isRGB?'inherit':color.color}">${color.name}</div>
                        ${userData.usernameColor===c?'<span style="color:#30d158">✓ Aktif</span>':''}
                    </div>
                `;
            }
        });
    }
    
    // Frames
    const frames = userData.inventory?.filter(i => i.startsWith('frame-')) || [];
    if (frames.length) {
        html += '<h4 style="margin:16px 0 12px">Avatar Frame</h4>';
        frames.forEach(f => {
            const frame = STORE.frames.find(x => x.id === f);
            if (frame) {
                html += `
                    <div class="card" style="display:flex;align-items:center;gap:12px;border-color:${userData.avatarFrame===frame.color?'#30d158':'transparent'}">
                        <div style="width:40px;height:40px;border-radius:50%;border:3px solid ${frame.color}"></div>
                        <div style="flex:1">${frame.name}</div>
                        ${userData.avatarFrame===frame.color?'<span style="color:#30d158">✓ Aktif</span>':''}
                    </div>
                `;
            }
        });
    }
    
    container.innerHTML = html || '<p style="color:#8e8e93;text-align:center">Koleksi kosong</p>';
};

// ========== FEED (dengan foto) ==========
function renderFeed(container) {
    container.innerHTML = `
        <div class="feed-input">
            <img src="${userData.photoURL}">
            <div class="input-trigger" onclick="newPost()">Buat postingan...</div>
        </div>
        <div id="posts"></div>
    `;
    
    onSnapshot(query(collection(window.db,'posts'),orderBy('time','desc')), snap => {
        document.getElementById('posts').innerHTML = snap.docs.map(d => {
            const p = d.data();
            return renderPost(d.id, p);
        }).join('');
    });
}

function renderPost(id, p) {
    const u = p.user || {};
    const isRGB = u.vip === 'prince';
    
    return `
        <div class="post">
            <div class="post-header">
                <div style="position:relative">
                    <img src="${u.photo}" style="${u.avatarFrame?`border:2px solid ${u.avatarFrame}`:''};border-radius:50%;width:40px;height:40px">
                </div>
                <div style="flex:1">
                    <div style="font-weight:600;color:${u.color||'inherit'};display:flex;align-items:center;gap:6px">
                        ${u.name}
                        ${isRGB?'<span class="rgb">👑</span>':u.vip?'💎':''}
                    </div>
                    <div style="font-size:12px;color:#8e8e93">Baru saja</div>
                </div>
            </div>
            <p>${p.text}</p>
            ${p.image?`<img src="${p.image}" style="width:100%;border-radius:12px;margin-top:12px;max-height:400px;object-fit:cover">`:''}
            <div class="post-actions">
                <span onclick="likePost('${id}')" style="cursor:pointer">❤️ ${p.likes?.length||0}</span>
                <span>💬 ${p.comments?.length||0}</span>
            </div>
        </div>
    `;
}

window.newPost = () => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3 style="margin-bottom:16px">Buat Postingan</h3>
            <textarea id="post-text" placeholder="Apa yang kamu pikirkan?" style="width:100%;min-height:100px;background:#2c2c2e;border:none;border-radius:12px;color:#fff;padding:12px;margin-bottom:12px;resize:none"></textarea>
            <input type="file" id="post-img" accept="image/*" style="display:none">
            <button onclick="document.getElementById('post-img').click()" style="background:#2c2c2e;margin-bottom:12px">📷 Tambah Foto</button>
            <div id="img-preview" style="display:none;margin-bottom:12px">
                <img style="max-width:100%;border-radius:8px">
            </div>
            <div style="display:flex;gap:12px">
                <button onclick="this.closest('.modal-overlay').remove()" style="flex:1;background:#2c2c2e">Batal</button>
                <button onclick="submitPost()" class="btn-primary" style="flex:1">Posting</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Preview image
    document.getElementById('post-img').onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            const preview = document.getElementById('img-preview');
            preview.style.display = 'block';
            preview.querySelector('img').src = url;
            preview.dataset.file = file;
        }
    };
};

window.submitPost = async () => {
    const text = document.getElementById('post-text').value;
    const preview = document.getElementById('img-preview');
    const file = preview.dataset.file;
    
    if (!text && !file) return;
    
    let imageUrl = null;
    
    if (file) {
        // Upload ke Firebase Storage
        const storageRef = ref(window.storage, `posts/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        imageUrl = await getDownloadURL(storageRef);
    }
    
    await addDoc(collection(window.db,'posts'),{
        user: {
            name: userData.username,
            photo: userData.photoURL,
            vip: userData.vip,
            color: userData.usernameColor,
            avatarFrame: userData.avatarFrame
        },
        text: text || '',
        image: imageUrl,
        likes: [],
        comments: [],
        time: serverTimestamp()
    });
    
    document.querySelector('.modal-overlay').remove();
};

window.likePost = async (id) => {
    const ref = doc(window.db,'posts',id);
    const d = await getDoc(ref);
    const likes = d.data().likes || [];
    
    await updateDoc(ref, likes.includes(currentUser.uid) ? 
        {likes:arrayRemove(currentUser.uid)} : 
        {likes:arrayUnion(currentUser.uid)}
    );
};

// ========== LEGAL PAGES ==========
const LEGAL = {
    about: {
        title: 'Tentang NanimeX',
        content: `
            <div style="text-align:center;margin-bottom:24px">
                <div style="font-size:64px;margin-bottom:16px">🎌</div>
                <h2>NanimeX v2.0</h2>
                <p style="color:#8e8e93">Platform streaming anime modern</p>
            </div>
            <div class="card">
                <h4 style="margin-bottom:12px">Fitur Unggulan</h4>
                <ul style="color:#8e8e93;line-height:2">
                    <li>📺 Streaming HLS & MP4</li>
                    <li>💬 Komentar real-time dengan reply</li>
                    <li>🛒 Toko badge, VIP, warna, frame</li>
                    <li>👤 Profile dengan online status</li>
                    <li>📱 Feed komunitas dengan foto</li>
                </ul>
            </div>
            <div class="card" style="text-align:center;background:linear-gradient(135deg,#667eea,#764ba2)">
                <p style="color:#fff">© 2025 NanimeX Team</p>
            </div>
        `
    },
    privacy: {
        title: 'Privacy Policy',
        content: `
            <div class="card">
                <h4 style="margin-bottom:12px">Data yang Dikumpulkan</h4>
                <p style="color:#8e8e93;line-height:1.6">Kami mengumpulkan: username, email, foto profil, aktivitas nonton, dan data transaksi toko.</p>
            </div>
            <div class="card">
                <h4 style="margin-bottom:12px">Keamanan</h4>
                <p style="color:#8e8e93;line-height:1.6">Data dienkripsi dengan SSL. Kami tidak menjual data ke pihak ketiga.</p>
            </div>
            <div class="card">
                <h4 style="margin-bottom:12px">Kontak</h4>
                <p style="color:#8e8e93">privacy@nanimex.id</p>
            </div>
        `
    },
    dmca: {
        title: 'DMCA',
        content: `
            <div class="card" style="background:#ff453a;color:#fff">
                <h4>Copyright Notice</h4>
                <p>Kami menghormati hak cipta. Laporkan pelanggaran ke dmca@nanimex.id</p>
            </div>
            <div class="card">
                <h4 style="margin-bottom:12px">Prosedur Takedown</h4>
                <ol style="color:#8e8e93;line-height:2;padding-left:20px">
                    <li>Identifikasi karya yang dilindungi</li>
                    <li>URL konten yang melanggar</li>
                    <li>Informasi kontak lengkap</li>
                    <li>Tanda tangan elektronik</li>
                </ol>
            </div>
        `
    },
    disclaimer: {
        title: 'Disclaimer',
        content: `
            <div class="card" style="border-left:4px solid #ff9500">
                <h4 style="color:#ff9500">Peringatan</h4>
                <p style="color:#8e8e93;line-height:1.6;margin-top:8px">
                    Platform ini hanya menyediakan konten dari sumber legal. 
                    Pengguna bertanggung jawab atas penggunaan layanan.
                </p>
            </div>
            <div class="card">
                <h4 style="margin-bottom:12px">Batasan Tanggung Jawab</h4>
                <ul style="color:#8e8e93;line-height:2">
                    <li>Konten dari user upload</li>
                    <li>Kualitas bergantung sumber</li>
                    <li>Coin virtual tidak bisa diuangkan</li>
                </ul>
            </div>
        `
    }
};

function renderLegal(container, type) {
    const data = LEGAL[type];
    container.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
            <button onclick="go('settings')" style="width:auto;padding:8px 12px;background:#1c1c1e">←</button>
            <h2>${data.title}</h2>
        </div>
        ${data.content}
    `;
}

// ========== ADMIN ==========
function renderAdmin(container) {
    container.innerHTML = `
        <h2 style="margin-bottom:20px">Owner Panel</h2>
        <div class="card">
            <h4 style="margin-bottom:16px">Upload Anime</h4>
            <input type="text" id="a-title" placeholder="Judul">
            <input type="text" id="a-studio" placeholder="Studio">
            <input type="text" id="a-genre" placeholder="Genre (koma)">
            <input type="text" id="a-poster" placeholder="URL Poster">
            <textarea id="a-synopsis" placeholder="Sinopsis" style="width:100%;min-height:80px;background:#1c1c1e;border:1px solid #2c2c2e;border-radius:12px;color:#fff;padding:16px;margin-bottom:12px"></textarea>
            
            <h5 style="margin:16px 0 12px">Episode</h5>
            <div id="eps"></div>
            <button onclick="addEp()" style="background:#2c2c2e;margin-bottom:16px">+ Episode</button>
            
            <button onclick="uploadAnime()" class="btn-primary">Upload</button>
        </div>
    `;
    
    window.addEp = () => {
        const div = document.createElement('div');
        div.style.cssText = 'background:#2c2c2e;padding:12px;border-radius:8px;margin-bottom:8px';
        div.innerHTML = `
            <input type="number" class="ep-num" placeholder="No" style="width:60px;margin-bottom:8px">
            <input type="text" class="ep-title" placeholder="Judul" style="margin-bottom:8px">
            <input type="text" class="ep-url" placeholder="URL Video (MP4/M3U8)">
        `;
        document.getElementById('eps').appendChild(div);
    };
    
    addEp();
    
    window.uploadAnime = async () => {
        const eps = [];
        document.querySelectorAll('#eps > div').forEach(d => {
            const url = d.querySelector('.ep-url').value;
            eps.push({
                number: parseInt(d.querySelector('.ep-num').value),
                title: d.querySelector('.ep-title').value,
                videoUrl: url,
                isHLS: url.includes('.m3u8')
            });
        });
        
        await addDoc(collection(window.db,'anime'),{
            title: document.getElementById('a-title').value,
            studio: document.getElementById('a-studio').value,
            genre: document.getElementById('a-genre').value.split(','),
            synopsis: document.getElementById('a-synopsis').value,
            poster: document.getElementById('a-poster').value,
            episodes: eps,
            createdAt: serverTimestamp()
        });
        
        alert('Upload berhasil!');
        go('home');
    };
}
