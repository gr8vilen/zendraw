const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const clearBtn = document.getElementById('clearBtn');
const colorDots = document.querySelectorAll('.color-dot');

let isDrawing = false;
let currentColor = '#ef4444';
let currentSize = 8;
let isStylusMode = false;
const stylusBtn = document.getElementById('stylusBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const screenStream = document.getElementById('screen-stream');

socket.on('stream-frame', (frameData) => {
    screenStream.src = frameData;
});

let lastRatio = 0;

function alignCanvasWithStream() {
    const img = screenStream;
    if (!img.naturalWidth || !img.naturalHeight) return;

    const imgRatio = img.naturalWidth / img.naturalHeight;
    if (Math.abs(lastRatio - imgRatio) < 0.001) {
        // Only re-calculate if container size changed
        if (img.dataset.lastContainerW == window.innerWidth && img.dataset.lastContainerH == window.innerHeight) return;
    }
    lastRatio = imgRatio;
    img.dataset.lastContainerW = window.innerWidth;
    img.dataset.lastContainerH = window.innerHeight;

    const containerWidth = window.innerWidth;
    const containerHeight = window.innerHeight;
    const containerRatio = containerWidth / containerHeight;

    let w, h, top, left;
    if (imgRatio > containerRatio) {
        w = containerWidth;
        h = containerWidth / imgRatio;
        left = 0;
        top = (containerHeight - h) / 2;
    } else {
        h = containerHeight;
        w = containerHeight * imgRatio;
        top = 0;
        left = (containerWidth - w) / 2;
    }

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.top = `${top}px`;
    canvas.style.left = `${left}px`;

    canvas.width = w;
    canvas.height = h;
    
    // Reset ctx state after resize
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

// Update src handler to trigger alignment check
socket.on('stream-frame', (frameData) => {
    screenStream.src = frameData;
});

screenStream.onload = alignCanvasWithStream;
window.addEventListener('resize', alignCanvasWithStream);

// Initialize
alignCanvasWithStream();

// Fullscreen Toggle
fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
        } else if (document.documentElement.mozRequestFullScreen) { // Firefox
            document.documentElement.mozRequestFullScreen();
        } else if (document.documentElement.webkitRequestFullscreen) { // Chrome, Safari and Opera
            document.documentElement.webkitRequestFullscreen();
        } else if (document.documentElement.msRequestFullscreen) { // IE/Edge
            document.documentElement.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
});

// Stylus Mode Toggle (Palm Rejection)
stylusBtn.addEventListener('click', () => {
    isStylusMode = !isStylusMode;
    stylusBtn.classList.toggle('active', isStylusMode);
    alert(isStylusMode ? "Stylus Mode Active: Only Pen will draw." : "Touch Mode Active");
});

// Color Selection
colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        currentColor = dot.dataset.color;
    });
});

// Pointer Events (Support touch & Apple Pencil)
canvas.addEventListener('pointerdown', (e) => {
    if (isStylusMode && e.pointerType !== 'pen') return;
    
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const pressure = e.pressure || 0.5;
    
    socket.emit('draw-start', { x, y, color: currentColor, size: currentSize, pressure });
    
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize * (pressure * 2);
});

canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (!isDrawing) {
        if (e.pointerType === 'pen') {
            socket.emit('hover-move', { x, y, color: currentColor });
        }
        return;
    }
    
    if (isStylusMode && e.pointerType !== 'pen') return;
    
    const pressure = e.pressure || 0.5;
    socket.emit('draw-move', { x, y, pressure });
    
    ctx.lineWidth = currentSize * (pressure * 2);
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
});

canvas.addEventListener('pointerleave', () => {
    socket.emit('hover-end');
});

canvas.addEventListener('pointerout', () => {
    socket.emit('hover-end');
});

canvas.addEventListener('pointercancel', () => {
    socket.emit('hover-end');
});

canvas.addEventListener('pointerup', () => {
    if (!isDrawing) return;
    isDrawing = false;
    socket.emit('draw-end');
    ctx.closePath();
});

clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear');
});

// Prevent scrolling on mobile
document.body.addEventListener('touchstart', (e) => {
    if (e.target.tagName !== 'BUTTON') e.preventDefault();
}, { passive: false });
