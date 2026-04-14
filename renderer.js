const { ipcRenderer } = require('electron');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const uiLayer = document.getElementById('ui-layer');

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

let isDrawing = false;

ipcRenderer.on('init-data', (event, { url, qrData }) => {
    document.getElementById('qr-code').src = qrData;
    document.getElementById('url-text').innerText = url;
});

ipcRenderer.on('draw-start', (event, data) => {
    isDrawing = true;
    ctx.beginPath();
    ctx.moveTo(data.x * window.innerWidth, data.y * window.innerHeight);
    ctx.strokeStyle = data.color || '#ff0000';
    ctx.lineWidth = data.size || 5;
    
    // Auto-hide UI when drawing starts
    uiLayer.classList.add('hidden');
});

ipcRenderer.on('draw-move', (event, data) => {
    if (!isDrawing) return;
    ctx.lineTo(data.x * window.innerWidth, data.y * window.innerHeight);
    ctx.stroke();
});

ipcRenderer.on('draw-end', () => {
    isDrawing = false;
    ctx.closePath();
});

ipcRenderer.on('clear', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    uiLayer.classList.remove('hidden');
});

// Window interaction handling
uiLayer.addEventListener('mouseenter', () => {
    ipcRenderer.send('set-ignore-mouse-events', false);
});

uiLayer.addEventListener('mouseleave', () => {
    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
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
        }
    }
    if (e.code === 'KeyC') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        uiLayer.classList.remove('hidden');
    }
});
