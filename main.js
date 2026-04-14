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

const PORT = 3000;

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
  const { width, height } = primaryDisplay.size;

  const iconPath = path.join(__dirname, 'icon.png');
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    movable: false,
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

  mainWindow.loadFile('index.html');

  // Handle IPC for window controls
  ipcMain.on('minimize-window', () => mainWindow.minimize());
  ipcMain.on('quit-app', () => app.quit());
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    mainWindow.setIgnoreMouseEvents(ignore, options);
  });

  ipcMain.handle('get-sources', async () => {
    return await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  });

  // Generate QR Code for mobile connection
  const localIp = ip.address();
  const url = `http://${localIp}:${PORT}`;
  
  qrcode.toDataURL(url, (err, qrData) => {
    if (err) console.error(err);
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('init-data', { url, qrData });
    });
  });
}

// Socket.io for real-time drawing
let connectedClients = 0;

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`Mobile connected. Total: ${connectedClients}`);
  mainWindow.webContents.send('connection-status', { connected: true, count: connectedClients });
  
  socket.on('draw-start', (data) => {
    mainWindow.webContents.send('draw-start', data);
  });

  socket.on('draw-move', (data) => {
    mainWindow.webContents.send('draw-move', data);
  });

  socket.on('draw-end', () => {
    mainWindow.webContents.send('draw-end');
  });

  socket.on('hover-move', (data) => {
    mainWindow.webContents.send('hover-move', data);
  });

  socket.on('hover-end', () => {
    mainWindow.webContents.send('hover-end');
  });

  socket.on('clear', () => {
    mainWindow.webContents.send('clear');
  });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`Mobile disconnected. Total: ${connectedClients}`);
    mainWindow.webContents.send('connection-status', { 
      connected: connectedClients > 0, 
      count: connectedClients 
    });
  });
});

// Forward screen frames from renderer to mobile (Broadcasting to all connected)
ipcMain.on('send-frame', (event, frameData) => {
  io.emit('stream-frame', frameData);
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
