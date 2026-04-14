# ZenDraw 🎨

**ZenDraw** is a minimalist, powerful tool that turns your mobile device into a remote drawing controller for your desktop. Draw directly over your screen, apps, and windows with zero latency, making it perfect for presentations, tutorials, and creative brainstorming.

[![SEO Keyword: Screen Drawing Tool](https://img.shields.io/badge/Focus-Screen%20Drawing-brightgreen)](#)
[![SEO Keyword: Remote Control](https://img.shields.io/badge/Controller-Mobile-blue)](#)
[![Built with Electron](https://img.shields.io/badge/Built%20with-Electron-9feaf9)](#)

---

## 🌟 Features

- **Mobile as a Remote**: Use your phone's touchscreen as a precision drawing pad.
- **Always-on-Top Overlay**: Draw over any application or presentation without interrupting your workflow.
- **QR Code Pairing**: Instant connection via local network—no complicated setup required.
- **Zero Latency**: Real-time synchronization between mobile input and desktop output.
- **Minimalist UI**: Stay focused on your content with a non-intrusive desktop interface.

---

## 🚀 Getting Started

Follow these steps to set up ZenDraw on your machine.

### 1. Prerequisites (Installing Node.js)

To run or build ZenDraw, you need **Node.js** installed on your system.

- **Windows/macOS**: Download the installer from the [official Node.js website](https://nodejs.org/). We recommend the **LTS (Long Term Support)** version.
- **Linux (Ubuntu/Debian)**:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```

Verify the installation by running:
```bash
node -v
npm -v
```

### 2. Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/gr8vilen/zendraw.git
cd zendraw
npm install
```

### 3. Running the App

Start the application in development mode:
```bash
npm start
```
Scan the QR code displayed on your desktop with your phone to start drawing!

---

## 🛠 Compilation (Build for Any Platform)

ZenDraw uses `electron-builder` to package the application. You can compile it for macOS, Windows, or Linux.

### Compile for Current OS
To build for your current operating system:
```bash
npx electron-builder
```

### Specific Platform Builds

#### 🍏 macOS
```bash
# Build for Apple Silicon (M1/M2/M3)
npm run build

# Build for Intel Mac
npx electron-builder --mac --x64

# Build for both
npx electron-builder --mac --universal
```

#### 🪟 Windows
```bash
npx electron-builder --win --x64
```

#### 🐧 Linux
```bash
npx electron-builder --linux
```

*Note: The executable will be generated in the `dist/` folder.*

---

## 🏗 How It Works

1. **Desktop Server**: An Electron app starts a local Express server and a Socket.io instance.
2. **QR Connection**: A QR code is generated using your local IP address.
3. **Mobile Client**: Accessing the URL on your phone opens a web-based drawing pad.
4. **Real-time Sync**: Drawing coordinates are sent via WebSockets to the Electron overlay and rendered instantly on a transparent canvas.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---

**Crafted with ❤️ for creators and presenters.**
