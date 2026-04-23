const { ipcRenderer } = require('electron');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const connectionInfo = document.getElementById('connection-info');
const statusBadge = document.getElementById('status-badge');
const uiLayer = document.getElementById('ui-layer');

let isDrawing = false;

function resize() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------
// SCREEN STREAMING — WebRTC (hardware-accelerated H.264, 25 FPS)
// ------------------------------------------------------------------
let pc = null;
let currentStream = null;
let currentMonitorId = null;


async function startWebRTC(targetDisplayId = null) {
    if (pc) { pc.close(); pc = null; }
    if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }

    try {
        console.log(`[Renderer] Initiating WebRTC setup`);
        const sources = await ipcRenderer.invoke('get-sources');
        let selectedSource = targetDisplayId
            ? sources.find(s => s.display_id === targetDisplayId.toString())
            : null;
        if (!selectedSource) selectedSource = sources[0];
        console.log(`[Renderer] WebRTC: using source "${selectedSource.name}"`);

        // Get actual display info to force physical pixel capture on Retina/HiDPI displays
        const displayInfo = await ipcRenderer.invoke('get-display-info', targetDisplayId);
        const scaleFactor = displayInfo.scaleFactor || 1;
        const physW = Math.round(displayInfo.width  * scaleFactor);
        const physH = Math.round(displayInfo.height * scaleFactor);
        console.log(`[Renderer] Display logical: ${displayInfo.width}x${displayInfo.height}, scaleFactor: ${scaleFactor}, physical target: ${physW}x${physH}`);

        // Pass physical pixel dimensions — forces Chromium to capture at native res on Retina
        currentStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: selectedSource.id,
                    minWidth:  physW,
                    minHeight: physH,
                    maxWidth:  physW,
                    maxHeight: physH,
                    maxFrameRate: 60,
                }
            }
        });

        // Log actual captured resolution to verify
        const vTrack = currentStream.getVideoTracks()[0];
        vTrack.contentHint = 'motion'; // Prioritize fluidity/low latency over static detail
        const settings = vTrack.getSettings();
        console.log(`[Renderer] Captured at: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);

        pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // Use addTrack (sendrecv) — addTransceiver+sendonly breaks msid association
        // causing event.streams[0] to be undefined on mobile → black screen.
        // Post-negotiation setParameters() IS valid for bitrate/resolution control.
        let videoSender = null;
        for (const track of currentStream.getTracks()) {
            const sender = pc.addTrack(track, currentStream);
            if (track.kind === 'video') videoSender = sender;
        }

        // Trickle ICE: send candidates as they are found
        pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                ipcRenderer.send('webrtc-ice-desktop', candidate.toJSON());
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`[Renderer] WebRTC state: ${pc.connectionState}`);
            if (pc.connectionState === 'connected') {
                // Post-negotiation setParameters is reliable — transactionId exists now
                if (videoSender) {
                    const p = videoSender.getParameters();
                    if (p.encodings && p.encodings.length > 0) {
                        p.encodings[0].maxBitrate            = 5_000_000; // 5 Mbps (prevents bufferbloat lag)
                        p.encodings[0].maxFramerate          = 60;
                        p.encodings[0].scaleResolutionDownBy = 1;          // no downscaling
                        videoSender.setParameters(p)
                            .then(() => console.log('[Renderer] Encoding params locked post-negotiation'))
                            .catch(e  => console.warn('[Renderer] setParameters failed:', e.message));
                    }
                }
            }
            if (pc.connectionState === 'failed') {
                console.warn('[Renderer] WebRTC failed, retrying in 2s...');
                setTimeout(() => startWebRTC(currentMonitorId), 2000);
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('[Renderer] WebRTC: Sending offer to mobile');
        ipcRenderer.send('webrtc-offer', pc.localDescription.toJSON());
    } catch (e) {
        console.error(`[Renderer] WebRTC setup failed: ${e.message}`);
    }
}

ipcRenderer.on('webrtc-answer', async (event, answer) => {
    if (!pc || pc.signalingState === 'closed') return;
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('[Renderer] WebRTC: answer applied, stream active');
    } catch (e) { console.error(`[Renderer] setRemoteDescription failed: ${e.message}`); }
});

ipcRenderer.on('webrtc-ice', async (event, candidate) => {
    if (!pc || pc.signalingState === 'closed') return;
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* ignore */ }
});

// ------------------------------------------------------------------
ipcRenderer.on('init-data', (event, { url, qrData }) => {
    document.getElementById('qr-code').src = qrData;
    document.getElementById('url-text').innerText = url;
});

let isConnected = false;

function updateUIVisibility() {
    if (isConnected) {
        uiLayer.classList.add('hidden');
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    } else {
        uiLayer.classList.remove('hidden');
        ipcRenderer.send('set-ignore-mouse-events', false);
    }
}

ipcRenderer.on('connection-status', (event, { connected, count }) => {
    isConnected = connected;
    if (connected) {
        connectionInfo.classList.add('hidden');
        statusBadge.classList.remove('hidden');
        uiLayer.classList.add('hidden');
        // Small delay ensures mobile JS is ready to receive the offer
        // Minimal delay — just enough for mobile socket listener to register
        setTimeout(() => startWebRTC(currentMonitorId), 100);
    } else {
        connectionInfo.classList.remove('hidden');
        statusBadge.classList.add('hidden');
        uiLayer.classList.remove('hidden');
        if (pc) { pc.close(); pc = null; }
        if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
    }
    updateUIVisibility();
});

ipcRenderer.on('switch-monitor', (event, displayId) => {
    console.log(`Renderer: switching to monitor ${displayId}`);
    currentMonitorId = displayId;
    startWebRTC(displayId);
});

// ------------------------------------------------------------------
// DRAWING
// ------------------------------------------------------------------
let currentStrokeColor = '#ff0000';
let currentStrokeSize = 5;
const cursorDot = document.getElementById('cursor-dot');

ipcRenderer.on('draw-start', (event, data) => {
    isDrawing = true;
    const pressure = data.pressure || 0.5;
    
    ctx.beginPath();
    ctx.moveTo(data.x * window.innerWidth, data.y * window.innerHeight);
    
    if (data.color === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = (data.size || 40) * (pressure * 2);
    } else {
        ctx.globalCompositeOperation = 'source-over';
        currentStrokeColor = data.color || '#ff0000';
        currentStrokeSize = data.size || 5;
        ctx.strokeStyle = currentStrokeColor;
        ctx.lineWidth = currentStrokeSize * (pressure * 2);
    }
    
    uiLayer.classList.add('hidden');
    cursorDot.style.opacity = '0';
});

let hoverTimeout;

ipcRenderer.on('hover-move', (event, data) => {
    if (isDrawing) return;
    clearTimeout(hoverTimeout);
    cursorDot.style.left = `${data.x * 100}%`;
    cursorDot.style.top = `${data.y * 100}%`;
    cursorDot.style.opacity = '1';
    cursorDot.style.borderColor = data.color || 'white';
    cursorDot.style.boxShadow = `0 0 10px ${data.color || 'white'}`;
    hoverTimeout = setTimeout(() => { cursorDot.style.opacity = '0'; }, 500);
});

ipcRenderer.on('hover-end', () => {
    clearTimeout(hoverTimeout);
    cursorDot.style.opacity = '0';
});

ipcRenderer.on('draw-move', (event, data) => {
    if (!isDrawing) return;
    const pressure = data.pressure || 0.5;
    ctx.lineTo(data.x * window.innerWidth, data.y * window.innerHeight);
    ctx.lineWidth = currentStrokeSize * (pressure * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(data.x * window.innerWidth, data.y * window.innerHeight);
});

ipcRenderer.on('draw-end', () => { isDrawing = false; ctx.closePath(); });

ipcRenderer.on('clear', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!isConnected) uiLayer.classList.remove('hidden');
});

// ------------------------------------------------------------------
// WINDOW INTERACTION
// ------------------------------------------------------------------
uiLayer.addEventListener('mouseenter', () => ipcRenderer.send('set-ignore-mouse-events', false));
uiLayer.addEventListener('mouseleave', () => {
    if (uiLayer.classList.contains('hidden'))
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
});

document.getElementById('min-btn').addEventListener('click', () => ipcRenderer.send('minimize-window'));
document.getElementById('close-btn').addEventListener('click', () => ipcRenderer.send('quit-app'));

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        uiLayer.classList.toggle('hidden');
        if (uiLayer.classList.contains('hidden'))
            ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        else
            ipcRenderer.send('set-ignore-mouse-events', false);
    }
    if (e.code === 'KeyC') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!isConnected) uiLayer.classList.remove('hidden');
    }
});
