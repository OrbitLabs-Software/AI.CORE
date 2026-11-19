// main.js — AI Core als Programm für Windows, macOS und Linux (Electron).
// Die Oberfläche liegt als Dateien im Programm (offline startbar) und spricht mit deinem AI-Core-Server.
// Sie läuft unter der Adresse aicore://app, die der Server standardmäßig als Ursprung zulässt.
const { app, BrowserWindow, Menu, protocol, net, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, 'web');
const ORIGIN = 'aicore://app';

protocol.registerSchemesAsPrivileged([{ scheme: 'aicore', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.commandLine.appendSwitch('allow-running-insecure-content');   // Heimnetz-Server über http://192.168… erreichbar machen

if (!app.requestSingleInstanceLock()) app.quit();

/** Datei im web-Ordner finden; nichts außerhalb davon ausliefern. */
function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  const full = path.resolve(WEB, rel);
  if (full !== WEB && !full.startsWith(WEB + path.sep)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  return null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 420, minHeight: 600,
    backgroundColor: '#0b0c14', title: 'AI Core', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, allowRunningInsecureContent: true, spellcheck: true },
  });
  win.loadURL(`${ORIGIN}/index.html`);
  // Links nach außen im Browser öffnen, nicht in der App
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  return win;
}

app.whenReady().then(() => {
  protocol.handle('aicore', (req) => {
    const file = resolveFile(new URL(req.url).pathname);
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Nicht gefunden', { status: 404 });
  });

  // Antworten des Servers für die App freigeben (falls der Server die Ursprungs-Liste nicht kennt).
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (details.url.startsWith('aicore:')) return cb({});
    const h = { ...details.responseHeaders };
    for (const k of Object.keys(h)) if (/^access-control-/i.test(k)) delete h[k];
    h['Access-Control-Allow-Origin'] = [ORIGIN];
    h['Access-Control-Allow-Headers'] = ['Content-Type, Authorization'];
    h['Access-Control-Allow-Methods'] = ['GET, POST, DELETE, OPTIONS'];
    cb({ responseHeaders: h });
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'Ansicht', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    { role: 'windowMenu' },
  ]));

  let win = createWindow();
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) win = createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
