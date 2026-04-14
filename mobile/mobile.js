const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const clearBtn = document.getElementById('clearBtn');
const colorDots = document.querySelectorAll('.color-dot');

let isDrawing = false;
let currentColor = '#ef4444';
let currentSize = 8;

function setupCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

setupCanvas();
window.addEventListener('resize', setupCanvas);

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
    isDrawing = true;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    
    socket.emit('draw-start', { x, y, color: currentColor, size: currentSize });
    
    // Draw locally for feedback
    ctx.beginPath();
    ctx.moveTo(e.clientX, e.clientY);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;
});

canvas.addEventListener('pointermove', (e) => {
    if (!isDrawing) return;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    
    socket.emit('draw-move', { x, y });
    
    // Draw locally
    ctx.lineTo(e.clientX, e.clientY);
    ctx.stroke();
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
