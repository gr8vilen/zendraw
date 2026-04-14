const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage } = require('electron');
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
    skipTaskbar: false, // Ensure it shows in taskbar
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

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
io.on('connection', (socket) => {
  console.log('Mobile connected');
  
  socket.on('draw-start', (data) => {
    mainWindow.webContents.send('draw-start', data);
  });

  socket.on('draw-move', (data) => {
    mainWindow.webContents.send('draw-move', data);
  });

  socket.on('draw-end', () => {
    mainWindow.webContents.send('draw-end');
  });

  socket.on('clear', () => {
    mainWindow.webContents.send('clear');
  });

  socket.on('disconnect', () => {
    console.log('Mobile disconnected');
  });
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
