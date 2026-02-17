// HLS Player Module
export class HLSPlayer {
    constructor(containerId, videoUrl, options = {}) {
        this.container = document.getElementById(containerId);
        this.url = videoUrl;
        this.isHLS = videoUrl.includes('.m3u8');
        this.hls = null;
        this.video = null;
        this.options = {
            autoplay: true,
            controls: true,
            ...options
        };
    }

    init() {
        if (!this.container) {
            console.error('Container not found:', this.container);
            return;
        }

        this.container.innerHTML = '';

        if (this.isHLS && Hls.isSupported()) {
            this.initHLS();
        } else if (this.isHLS && this.video?.canPlayType('application/vnd.apple.mpegurl')) {
            this.initNativeHLS();
        } else {
            this.initStandard();
        }

        return this.video;
    }

    initHLS() {
        this.video = document.createElement('video');
        this.video.controls = this.options.controls;
        this.video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        
        this.container.appendChild(this.video);

        this.hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 600,
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
            debug: false
        });

        this.hls.loadSource(this.url);
        this.hls.attachMedia(this.video);

        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (this.options.autoplay) {
                this.video.play().catch(() => {});
            }
        });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                switch(data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('Network error, retrying...');
                        this.hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('Media error, recovering...');
                        this.hls.recoverMediaError();
                        break;
                    default:
                        console.log('Fatal error, destroying...');
                        this.destroy();
                        break;
                }
            }
        });

        // Quality levels
        this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            console.log('Quality switched to:', data.level);
        });
    }

    initNativeHLS() {
        this.video = document.createElement('video');
        this.video.src = this.url;
        this.video.controls = this.options.controls;
        this.video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        
        this.container.appendChild(this.video);

        this.video.addEventListener('loadedmetadata', () => {
            if (this.options.autoplay) {
                this.video.play().catch(() => {});
            }
        });
    }

    initStandard() {
        this.video = document.createElement('video');
        this.video.src = this.url;
        this.video.controls = this.options.controls;
        this.video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        
        this.container.appendChild(this.video);

        if (this.options.autoplay) {
            this.video.play().catch(() => {});
        }
    }

    changeQuality(levelIndex) {
        if (this.hls && this.hls.levels[levelIndex]) {
            this.hls.currentLevel = levelIndex;
        }
    }

    getQualityLevels() {
        if (this.hls) {
            return this.hls.levels.map((level, index) => ({
                index,
                height: level.height,
                width: level.width,
                bitrate: level.bitrate
            }));
        }
        return [];
    }

    destroy() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.video) {
            this.video.pause();
            this.video.src = '';
            this.video = null;
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    pause() {
        this.video?.pause();
    }

    play() {
        this.video?.play().catch(() => {});
    }

    get currentTime() {
        return this.video?.currentTime || 0;
    }

    get duration() {
        return this.video?.duration || 0;
    }

    get paused() {
        return this.video?.paused || true;
    }
}

// Simple player factory
export function createPlayer(containerId, videoUrl, options = {}) {
    const player = new HLSPlayer(containerId, videoUrl, options);
    return player.init();
}
