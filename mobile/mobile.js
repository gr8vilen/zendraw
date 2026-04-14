const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const clearBtn = document.getElementById('clearBtn');
const colorDots = document.querySelectorAll('.color-dot');
const stylusBtn = document.getElementById('stylusBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const remoteVideo = document.getElementById('remote-video');

let isDrawing = false;
let currentColor = '#ef4444';
let currentSize = 8;
let isStylusMode = false;

// ------------------------------------------------------------------
// STREAM RECEIVER — JPEG over Socket.io
// ------------------------------------------------------------------
const screenStream = document.getElementById('screen-stream');

socket.on('stream-frame', (frameData) => {
    screenStream.src = frameData;
});

// ------------------------------------------------------------------
// DESKTOP DIMENSIONS (for canvas alignment)
// ------------------------------------------------------------------
let desktopWidth = 1920;
let desktopHeight = 1080;
let hasDesktopDim = false;

socket.on('init', (data) => {
    desktopWidth = data.width;
    desktopHeight = data.height;
    hasDesktopDim = true;
    alignCanvasWithStream();
});

// ------------------------------------------------------------------
// CANVAS ALIGNMENT
// ------------------------------------------------------------------
function alignCanvasWithStream() {
    const imgRatio = hasDesktopDim
        ? (desktopWidth / desktopHeight)
        : (screenStream.naturalWidth && screenStream.naturalWidth / screenStream.naturalHeight);
    if (!imgRatio || isNaN(imgRatio)) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const vpRatio = vw / vh;

    let drawW, drawH, drawLeft, drawTop;
    if (imgRatio > vpRatio) {
        drawW = vw; drawH = vw / imgRatio; drawLeft = 0; drawTop = (vh - drawH) / 2;
    } else {
        drawH = vh; drawW = vh * imgRatio; drawTop = 0; drawLeft = (vw - drawW) / 2;
    }

    canvas.style.left   = `${drawLeft}px`;
    canvas.style.top    = `${drawTop}px`;
    canvas.style.width  = `${drawW}px`;
    canvas.style.height = `${drawH}px`;
    canvas.width  = drawW;
    canvas.height = drawH;
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
}

screenStream.addEventListener('load', alignCanvasWithStream);
window.addEventListener('resize', alignCanvasWithStream);

// ------------------------------------------------------------------
// POINTER EVENTS
// All coordinates are normalised 0-1 WITHIN the canvas bounding box.
// ------------------------------------------------------------------
function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    // Using pageX/Y to account for any potential scroll-related offsets in mobile browsers
    const clientX = e.pageX || e.clientX;
    const clientY = e.pageY || e.clientY;
    
    return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top)  / rect.height
    };
}

canvas.addEventListener('pointerdown', (e) => {
    if (isStylusMode && e.pointerType !== 'pen') return;
    isDrawing = true;

    const { x, y } = getCanvasCoords(e);
    const pressure  = e.pressure || 0.5;
    socket.emit('draw-start', { x, y, color: currentColor, size: currentSize, pressure });

    ctx.beginPath();
    ctx.moveTo(x * canvas.width, y * canvas.height);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth   = currentSize * (pressure * 2);
});

canvas.addEventListener('pointermove', (e) => {
    const { x, y } = getCanvasCoords(e);

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
    ctx.lineTo(x * canvas.width, y * canvas.height);
    ctx.stroke();
});

['pointerup', 'pointerleave', 'pointerout', 'pointercancel'].forEach(evt => {
    canvas.addEventListener(evt, () => {
        socket.emit('hover-end');
        if (!isDrawing) return;
        if (evt === 'pointerup') {
            isDrawing = false;
            socket.emit('draw-end');
            ctx.closePath();
        }
    });
});

// ------------------------------------------------------------------
// CONTROLS
// ------------------------------------------------------------------
colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        currentColor = dot.dataset.color;
    });
});

stylusBtn.addEventListener('click', () => {
    isStylusMode = !isStylusMode;
    stylusBtn.classList.toggle('active', isStylusMode);
    alert(isStylusMode ? "Stylus Mode: Only Pen draws." : "Touch Mode Active");
});

fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        (document.documentElement.requestFullscreen
            || document.documentElement.webkitRequestFullscreen
            || document.documentElement.mozRequestFullScreen
        ).call(document.documentElement);
    } else {
        (document.exitFullscreen
            || document.webkitExitFullscreen
            || document.mozCancelFullScreen
        ).call(document);
    }
});

clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear');
});

document.body.addEventListener('touchstart', (e) => {
    if (e.target.tagName !== 'BUTTON' && e.target.className !== 'color-dot') {
        e.preventDefault();
    }
}, { passive: false });
