/**
 * Browser Fingerprinting Library
 * Creates a unique identifier for the browser/device combination
 * This replaces HWID (hardware ID) used in desktop applications
 */

class BrowserFingerprint {
    constructor() {
        this.fingerprint = null;
    }

    async generate() {
        const components = [];

        // 1. User Agent
        components.push(navigator.userAgent);

        // 2. Screen Information
        components.push(`${screen.width}x${screen.height}`);
        components.push(`${screen.colorDepth}`);

        // 3. Timezone
        components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

        // 4. Language
        components.push(navigator.language);

        // 5. Platform
        components.push(navigator.platform);

        // 6. Canvas Fingerprint
        components.push(await this.getCanvasFingerprint());

        // 7. WebGL Fingerprint
        components.push(await this.getWebGLFingerprint());

        // 8. Audio Fingerprint (if available)
        try {
            components.push(await this.getAudioFingerprint());
        } catch (e) {
            components.push('audio-not-available');
        }

        // 9. Plugins
        const plugins = [];
        for (let i = 0; i < navigator.plugins.length; i++) {
            plugins.push(navigator.plugins[i].name);
        }
        components.push(plugins.join(','));

        // 10. Touch Support
        components.push('ontouchstart' in window);

        // 11. Battery Status (if available)
        try {
            if (navigator.getBattery) {
                const battery = await navigator.getBattery();
                components.push(battery.level.toString());
            } else {
                components.push('battery-not-available');
            }
        } catch (e) {
            components.push('battery-not-available');
        }

        // 12. Device Memory (if available)
        components.push(navigator.deviceMemory || 'not-available');

        // 13. Hardware Concurrency (CPU cores)
        components.push(navigator.hardwareConcurrency || 'not-available');

        // 14. Do Not Track
        components.push(navigator.doNotTrack || 'not-set');

        // 15. Cookie Enabled
        components.push(navigator.cookieEnabled);

        // 16. PDF Viewer Enabled
        components.push(navigator.pdfViewerEnabled);

        // Generate hash from all components
        this.fingerprint = await this.hashString(components.join('|||'));
        
        return this.fingerprint;
    }

    async getCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Draw some text with specific font
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('Browser Fingerprint 🖥️', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('KDV Asistan v1.0', 4, 45);
            
            return canvas.toDataURL();
        } catch (e) {
            return 'canvas-not-available';
        }
    }

    async getWebGLFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            
            if (!gl) return 'webgl-not-available';

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                return `${vendor}|||${renderer}`;
            }
            
            return 'webgl-debug-not-available';
        } catch (e) {
            return 'webgl-error';
        }
    }

    async getAudioFingerprint() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const analyser = audioContext.createAnalyser();
            const gain = audioContext.createGain();
            const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

            gain.gain.value = 0; // Mute audio
            oscillator.type = 'triangle';
            oscillator.frequency.value = 10000;

            oscillator.connect(analyser);
            analyser.connect(scriptProcessor);
            scriptProcessor.connect(gain);
            gain.connect(audioContext.destination);

            oscillator.start(0);

            return new Promise((resolve) => {
                scriptProcessor.onaudioprocess = (event) => {
                    const data = event.inputBuffer.getChannelData(0);
                    let sum = 0;
                    for (let i = 0; i < data.length; i++) {
                        sum += Math.abs(data[i]);
                    }
                    oscillator.stop();
                    audioContext.close();
                    resolve(sum.toString());
                };
                
                // Timeout fallback
                setTimeout(() => {
                    oscillator.stop();
                    audioContext.close();
                    resolve('audio-timeout');
                }, 100);
            });
        } catch (e) {
            return 'audio-error';
        }
    }

    async hashString(str) {
        // Web Crypto API (secure context: HTTPS veya localhost)
        if (crypto && crypto.subtle) {
            try {
                const encoder = new TextEncoder();
                const data = encoder.encode(str);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            } catch (e) {
                // crypto.subtle başarısız, fallback kullan
            }
        }
        // Fallback: JS tabanlı hash (HTTP/non-secure context için)
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; // 32-bit integer
        }
        // Ek karıştırma
        const salted = str + '::kdv-asistan-v1::' + str.length;
        let hash2 = 0;
        for (let i = 0; i < salted.length; i++) {
            const chr = salted.charCodeAt(i);
            hash2 = ((hash2 << 5) - hash2) + chr;
            hash2 |= 0;
        }
        return 'fp-' + Math.abs(hash).toString(16).padStart(8, '0') + Math.abs(hash2).toString(16).padStart(8, '0');
    }

    get() {
        return this.fingerprint;
    }
}

// Initialize and export
const fingerprint = new BrowserFingerprint();
