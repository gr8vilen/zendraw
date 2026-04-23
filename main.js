const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, desktopCapturer } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode');
const ip = require('ip');

let mainWindow;
let tray = null;
const expressApp = express();
const server = http.createServer(expressApp);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = 6991;

function createMenu() {
  const template = [
    {
      label: 'ZenDraw',
      submenu: [
        { label: 'About ZenDraw', role: 'about' },
        { type: 'separator' },
        { label: 'Hide', role: 'hide' },
        { label: 'Hide Others', role: 'hideOthers' },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', role: 'minimize' },
        { label: 'Close', role: 'close' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray_icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show ZenDraw', click: () => mainWindow.show() },
    { label: 'Minimize', click: () => mainWindow.minimize() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  
  tray.setToolTip('ZenDraw');
  tray.setContextMenu(contextMenu);
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height, x, y } = primaryDisplay.bounds;

  const iconPath = path.join(__dirname, 'icon.png');
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    roundedCorners: false, // Ensure edges are sharp and aligned
    skipTaskbar: false,
    icon: appIcon, // Set taskbar icon
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  // Set Dock icon for Mac
  if (process.platform === 'darwin') {
    app.dock.setIcon(appIcon);
  }

  // Mac specific behavior to ensure it stays above but accessible
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Ignore mouse events by default so we can click through to apps
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Handle IPC for window controls
  ipcMain.on('minimize-window', () => mainWindow.minimize());
  ipcMain.on('quit-app', () => app.quit());
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    mainWindow.setIgnoreMouseEvents(ignore, options);
  });

  ipcMain.handle('get-sources', async () => {
    return await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  });

  ipcMain.handle('get-display-info', async (event, targetDisplayId) => {
    const displays = screen.getAllDisplays();
    let display = targetDisplayId
      ? displays.find(d => d.id === parseInt(targetDisplayId))
      : screen.getPrimaryDisplay();
    if (!display) display = screen.getPrimaryDisplay();
    return {
      width:       display.size.width,
      height:      display.size.height,
      scaleFactor: display.scaleFactor,
    };
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  mainWindow.loadFile('index.html').then(() => {
    // Generate QR Code for mobile connection
    const localIp = ip.address();
    const url = `http://${localIp}:${PORT}`;
    
    qrcode.toDataURL(url, (err, qrData) => {
      if (err) console.error(err);
      mainWindow.webContents.send('init-data', { 
        url, 
        qrData, 
        desktopWidth: width, 
        desktopHeight: height 
      });
    });
  });
}

// Socket.io for real-time drawing + WebRTC signaling
let connectedClients = 0;
let activeSocket = null; // Track the active mobile socket for targeted WebRTC signaling

io.on('connection', (socket) => {
  connectedClients++;
  activeSocket = socket; // Store reference so ipcMain handlers can target this socket
  console.log(`Mobile connected. Total: ${connectedClients}`);
  mainWindow.webContents.send('connection-status', { connected: true, count: connectedClients });

  // Send desktop screen dimensions and all displays immediately so mobile can align canvas and allow selection
  const displays = screen.getAllDisplays().map((d, index) => ({
    id: d.id,
    label: `Monitor ${index + 1}${d.id === screen.getPrimaryDisplay().id ? ' (Primary)' : ''}`,
    width: d.size.width,
    height: d.size.height,
    isPrimary: d.id === screen.getPrimaryDisplay().id
  }));

  const primaryDisplay = screen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor || 1;
  socket.emit('init', {
    width: primaryDisplay.size.width,
    height: primaryDisplay.size.height,
    scaleFactor,
    displays: displays
  });

  // --- Monitor selection ---
  socket.on('select-monitor', (displayId) => {
    console.log(`Switching to monitor: ${displayId}`);
    const targetDisplay = screen.getAllDisplays().find(d => d.id === parseInt(displayId));
    
    if (targetDisplay) {
      const { x, y, width, height } = targetDisplay.bounds;
      
      // Move and resize main window to match target display
      mainWindow.setBounds({ x, y, width, height });
      
      // Notify renderer to switch capture source and clear canvas
      mainWindow.webContents.send('switch-monitor', displayId);
      mainWindow.webContents.send('clear');
      
      // Notify mobile of new dimensions
      socket.emit('init', {
        width: targetDisplay.size.width,
        height: targetDisplay.size.height,
        displays: displays // Send updated list if needed
      });
      // Also notify mobile to clear its canvas
      socket.emit('clear');
    }
  });

  // --- Drawing events ---
  socket.on('log-pen', (data) => console.log(`[PEN LOG] type: ${data.type}, button: ${data.button}, buttons: ${data.buttons}`));
  socket.on('draw-start', (data) => mainWindow.webContents.send('draw-start', data));
  socket.on('draw-move',  (data) => mainWindow.webContents.send('draw-move', data));
  socket.on('draw-end',   ()     => mainWindow.webContents.send('draw-end'));
  socket.on('hover-move', (data) => mainWindow.webContents.send('hover-move', data));
  socket.on('hover-end',  ()     => mainWindow.webContents.send('hover-end'));
  socket.on('clear',      ()     => mainWindow.webContents.send('clear'));

  // --- WebRTC signaling (Mobile → Desktop) ---
  socket.on('signal-answer', (answer) => {
    console.log('Got WebRTC answer from mobile');
    mainWindow.webContents.send('webrtc-answer', answer);
  });

  // Mobile → Desktop ICE
  socket.on('signal-ice', (candidate) => {
    mainWindow.webContents.send('webrtc-ice', candidate);
  });

  // Desktop → Mobile ICE (relayed back via socket)
  socket.on('signal-ice-desktop', (candidate) => {
    mainWindow.webContents.send('webrtc-ice', candidate);
  });

  socket.on('disconnect', () => {
    connectedClients--;
    if (activeSocket === socket) activeSocket = null;
    console.log(`Mobile disconnected. Total: ${connectedClients}`);
    mainWindow.webContents.send('connection-status', {
      connected: connectedClients > 0,
      count: connectedClients
    });
  });
});

// WebRTC signaling relay: desktop renderer → mobile
ipcMain.on('webrtc-offer', (event, offer) => {
  if (activeSocket) activeSocket.emit('signal-offer', offer);
});

ipcMain.on('webrtc-ice-desktop', (event, candidate) => {
  if (activeSocket) activeSocket.emit('signal-ice-desktop', candidate);
});

// Serve the mobile controller
expressApp.use(express.static(path.join(__dirname, 'mobile')));

app.whenReady().then(() => {
  // Show dock on Mac explicitly
  if (process.platform === 'darwin') {
    app.dock.show();
  }
  
  createMenu();
  createTray();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://${ip.address()}:${PORT}`);
    createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
