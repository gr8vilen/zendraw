const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const clearBtn = document.getElementById('clearBtn');
const colorDots = document.querySelectorAll('.color-dot');
const stylusBtn = document.getElementById('stylusBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const monitorBtn = document.getElementById('monitorBtn');
const monitorList = document.getElementById('monitor-list');

let isDrawing = false;
let currentColor = '#ef4444';
let currentSize = 8;
let isStylusMode = false;
let currentMonitorId = null;

// ------------------------------------------------------------------
// WEBRTC STREAM RECEIVER
// ------------------------------------------------------------------
const screenStream = document.getElementById('screen-stream');
let mobilePc = null;

socket.on('signal-offer', async (offer) => {
    if (mobilePc) { mobilePc.close(); mobilePc = null; }

    mobilePc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    mobilePc.ontrack = (event) => {
        console.log('WebRTC: track received, streams:', event.streams.length);
        const stream = (event.streams && event.streams[0])
            ? event.streams[0]
            : new MediaStream([event.track]);
        screenStream.srcObject = stream;
        // Explicit play() is required — autoplay attribute alone is unreliable for
        // programmatically-assigned srcObject on mobile browsers
        screenStream.play().catch(err => console.warn('Video play failed:', err));
    };

    mobilePc.onicecandidate = ({ candidate }) => {
        if (candidate) {
            socket.emit('signal-ice', candidate.toJSON());
        }
    };

    mobilePc.onconnectionstatechange = () => {
        console.log('WebRTC mobile state:', mobilePc.connectionState);
    };

    try {
        await mobilePc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await mobilePc.createAnswer();
        await mobilePc.setLocalDescription(answer);
        console.log('Mobile: sending answer');
        socket.emit('signal-answer', mobilePc.localDescription.toJSON());
    } catch (e) {
        console.error('Mobile WebRTC error:', e);
    }
});

// ICE candidates from desktop
socket.on('signal-ice-desktop', async (candidate) => {
    if (!mobilePc) return;
    try { await mobilePc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* ignore */ }
});

socket.on('clear', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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

    if (data.displays) {
        populateMonitorList(data.displays);
    }
});

function populateMonitorList(displays) {
    monitorList.innerHTML = '';
    displays.forEach(d => {
        const item = document.createElement('div');
        item.className = `monitor-item ${d.isPrimary && !currentMonitorId ? 'active' : (currentMonitorId === d.id ? 'active' : '')}`;
        item.innerHTML = `
            <span>${d.label}</span>
            <span class="res">${d.width}x${d.height}</span>
        `;
        item.onclick = () => {
            currentMonitorId = d.id;
            socket.emit('select-monitor', d.id);
            monitorList.classList.remove('show');
            // Optimistically update active state
            document.querySelectorAll('.monitor-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        };
        monitorList.appendChild(item);
    });
}

// ------------------------------------------------------------------
// CANVAS ALIGNMENT
// ------------------------------------------------------------------
function alignCanvasWithStream() {
    const imgRatio = hasDesktopDim
        ? (desktopWidth / desktopHeight)
        : (screenStream.videoWidth && screenStream.videoWidth / screenStream.videoHeight);
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

screenStream.addEventListener('loadedmetadata', alignCanvasWithStream);
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

let isErasing = false;

canvas.addEventListener('pointerdown', (e) => {
    socket.emit('log-pen', { type: e.pointerType, button: e.button, buttons: e.buttons });

    if (isStylusMode && e.pointerType !== 'pen') return;

    // Check for "Clear Screen" pen button (button 1 / middle click)
    if (e.pointerType === 'pen' && (e.button === 1 || (e.buttons & 4))) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clear');
        return;
    }

    isDrawing = true;
    
    // Check for "Eraser" pen button (button 2 / right click OR button 5 / eraser end)
    isErasing = (e.pointerType === 'pen' && (e.button === 2 || e.button === 5 || (e.buttons & 2) || (e.buttons & 32)));

    const { x, y } = getCanvasCoords(e);
    const pressure  = e.pressure || 0.5;
    
    socket.emit('draw-start', { 
        x, y, 
        color: isErasing ? 'erase' : currentColor, 
        size: isErasing ? 40 : currentSize, // Thicker eraser
        pressure 
    });

    ctx.beginPath();
    ctx.moveTo(x * canvas.width, y * canvas.height);
    
    if (isErasing) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 40 * (pressure * 2);
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = currentColor;
        ctx.lineWidth   = currentSize * (pressure * 2);
    }
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

    ctx.lineWidth = (isErasing ? 40 : currentSize) * (pressure * 2);
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
            ctx.globalCompositeOperation = 'source-over'; // reset back to normal
            isErasing = false;
        }
    });
});

// Quick Clear Button for collapsed state
const quickClearBtn = document.getElementById('quickClearBtn');
if (quickClearBtn) {
    quickClearBtn.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clear');
    });
}

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

monitorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    monitorList.classList.toggle('show');
});

document.addEventListener('click', (e) => {
    if (!monitorList.contains(e.target) && e.target !== monitorBtn) {
        monitorList.classList.remove('show');
    }
});

// ------------------------------------------------------------------
// DRAGGABLE & COLLAPSIBLE TOOLBAR
// ------------------------------------------------------------------
const controlsWrapper = document.getElementById('controlsWrapper');
const dragHandle = document.getElementById('dragHandle');
const toggleBtn = document.getElementById('toggleBtn');

let isDraggingUI = false;
let startX, startY, initialLeft, initialTop;

dragHandle.addEventListener('touchstart', (e) => {
    isDraggingUI = true;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    
    // Switch to absolute positioning from transform
    const rect = controlsWrapper.getBoundingClientRect();
    controlsWrapper.style.left = `${rect.left}px`;
    controlsWrapper.style.top = `${rect.top}px`;
    controlsWrapper.style.transform = 'none';
    controlsWrapper.style.bottom = 'auto';
    controlsWrapper.style.right = 'auto';
    
    initialLeft = rect.left;
    initialTop = rect.top;
    controlsWrapper.classList.add('dragging');
    e.preventDefault(); // Prevent drawing interference
});

document.addEventListener('touchmove', (e) => {
    if (!isDraggingUI) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    
    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;
    
    // Simple bounds checking
    const rect = controlsWrapper.getBoundingClientRect();
    if (newLeft < 0) newLeft = 0;
    if (newLeft + rect.width > window.innerWidth) newLeft = window.innerWidth - rect.width;
    if (newTop < 0) newTop = 0;
    if (newTop + rect.height > window.innerHeight) newTop = window.innerHeight - rect.height;

    controlsWrapper.style.left = `${newLeft}px`;
    controlsWrapper.style.top = `${newTop}px`;
}, { passive: false });

document.addEventListener('touchend', () => {
    if (isDraggingUI) {
        isDraggingUI = false;
        controlsWrapper.classList.remove('dragging');
    }
});

toggleBtn.addEventListener('click', () => {
    controlsWrapper.classList.toggle('collapsed');
    toggleBtn.innerHTML = controlsWrapper.classList.contains('collapsed') ? '⚙️ Tools' : '▼ Hide Tools';
});

// ------------------------------------------------------------------
document.body.addEventListener('touchstart', (e) => {
    // Allow default behavior for UI elements (buttons, color dots, monitor list, toolbar wrapper)
    if (e.target.closest('.controls-wrapper') || e.target.closest('#monitor-list')) {
        return;
    }
    // Prevent default (scrolling/zooming) for canvas and other areas to keep drawing smooth
    if (e.target === canvas || e.target.tagName === 'BODY' || e.target.tagName === 'HTML') {
        e.preventDefault();
    }
}, { passive: false });
