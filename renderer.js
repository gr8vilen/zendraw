const { ipcRenderer } = require('electron');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const connectionInfo = document.getElementById('connection-info');
const statusBadge = document.getElementById('status-badge');
const uiLayer = document.getElementById('ui-layer');

let isDrawing = false;

// Set canvas resolution for Retina screens
function resize() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

window.addEventListener('resize', resize);
resize();

// Screen Streaming Logic
async function startScreenStream() {
    try {
        const sources = await ipcRenderer.invoke('get-sources');
        const primarySource = sources[0]; // Assume first screen is primary

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: primarySource.id
                }
            }
        });

        const video = document.createElement('video');
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            const captureCanvas = document.createElement('canvas');
            const captureCtx = captureCanvas.getContext('2d');
            
            // USE ACTUAL VIDEO SOURCE DIMENSIONS
            const streamRatio = video.videoHeight / video.videoWidth;
            captureCanvas.width = 1000; 
            captureCanvas.height = 1000 * streamRatio;

            setInterval(() => {
                captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
                const frameData = captureCanvas.toDataURL('image/jpeg', 0.4); 
                ipcRenderer.send('send-frame', frameData);
            }, 200);
        };
    } catch (e) {
        console.error('Failed to start screen stream:', e);
    }
}

startScreenStream();

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
        uiLayer.classList.add('hidden'); // Auto-hide when connected
    } else {
        connectionInfo.classList.remove('hidden');
        statusBadge.classList.add('hidden');
        uiLayer.classList.remove('hidden'); // Show QR when disconnected
    }
    updateUIVisibility();
});

let currentStrokeColor = '#ff0000';
let currentStrokeSize = 5;
const cursorDot = document.getElementById('cursor-dot');

ipcRenderer.on('draw-start', (event, data) => {
    isDrawing = true;
    currentStrokeColor = data.color || '#ff0000';
    currentStrokeSize = data.size || 5;
    const pressure = data.pressure || 0.5;

    ctx.beginPath();
    ctx.moveTo(data.x * window.innerWidth, data.y * window.innerHeight);
    ctx.strokeStyle = currentStrokeColor;
    ctx.lineWidth = currentStrokeSize * (pressure * 2);
    
    // Auto-hide UI when drawing starts
    uiLayer.classList.add('hidden');
    // Hide cursor dot when drawing
    cursorDot.style.opacity = '0';
});

let hoverTimeout;

ipcRenderer.on('hover-move', (event, data) => {
    if (isDrawing) return;
    
    // Clear existing timeout
    clearTimeout(hoverTimeout);
    
    cursorDot.style.left = `${data.x * 100}%`;
    cursorDot.style.top = `${data.y * 100}%`;
    cursorDot.style.opacity = '1';
    cursorDot.style.borderColor = data.color || 'white';
    cursorDot.style.boxShadow = `0 0 10px ${data.color || 'white'}`;

    // Auto-hide if no move received for 500ms
    hoverTimeout = setTimeout(() => {
        cursorDot.style.opacity = '0';
    }, 500);
});

ipcRenderer.on('hover-end', () => {
    clearTimeout(hoverTimeout);
    cursorDot.style.opacity = '0';
});

ipcRenderer.on('draw-move', (event, data) => {
    if (!isDrawing) return;
    const pressure = data.pressure || 0.5;
    
    // To support variable thickness, we stroke each segment
    ctx.lineTo(data.x * window.innerWidth, data.y * window.innerHeight);
    ctx.lineWidth = currentStrokeSize * (pressure * 2);
    ctx.stroke();
    
    // Start next segment with same position
    ctx.beginPath();
    ctx.moveTo(data.x * window.innerWidth, data.y * window.innerHeight);
});

ipcRenderer.on('draw-end', () => {
    isDrawing = false;
    ctx.closePath();
});

ipcRenderer.on('clear', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Only show UI if disconnected
    if (!isConnected) {
        uiLayer.classList.remove('hidden');
    }
});

// Window interaction handling
uiLayer.addEventListener('mouseenter', () => {
    ipcRenderer.send('set-ignore-mouse-events', false);
});

uiLayer.addEventListener('mouseleave', () => {
    // Only go back to ignore if UI is NOT visible (or if it's hidden)
    if (uiLayer.classList.contains('hidden')) {
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    }
});

// Button handlers
document.getElementById('min-btn').addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('quit-app');
});

// Toggle UI with Spacebar
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        uiLayer.classList.toggle('hidden');
        // If UI is hidden, ensure we ignore mouse
        if (uiLayer.classList.contains('hidden')) {
            ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        } else {
            ipcRenderer.send('set-ignore-mouse-events', false);
        }
    }
    if (e.code === 'KeyC') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!isConnected) {
            uiLayer.classList.remove('hidden');
        }
    }
});
