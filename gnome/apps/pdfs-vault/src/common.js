'use strict';
// ═══════════════════════════════════════════════════════════════
//  Shared main-process helpers (identical copy lives in every app)
//   • native GNOME title bar (or custom bar on tiling WMs)
//   • safe window-state persistence (debounced, off-screen safe)
//   • atomic JSON writes (a power cut can't corrupt progress/favs)
//   • localfile:// protocol with Range support (video seeking)
//   • single-instance lock
// ═══════════════════════════════════════════════════════════════
const { app, BrowserWindow, ipcMain, protocol, net, screen, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');
const { pathToFileURL } = require('url');

// ── Chromium flags (kept conservative: never force-disable software
//    rendering, otherwise the window stays blank when the GPU process
//    can't start, e.g. VMs / some NVIDIA setups) ──────────────────
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// Optional native-Wayland mode:  VAULT_WAYLAND=1 <app>
if (process.env.VAULT_WAYLAND === '1') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

// ── Window frame mode ───────────────────────────────────────────
//  native  → real title bar from the desktop (GNOME, KDE, …)
//  custom  → our own coloured dots (tiling WMs without decorations)
const TILING = /(hypr|sway|niri|i3|bspwm|river|dwl|awesome|qtile|xmonad|herbstluft)/i;
function useNativeFrame() {
  const argv = process.argv;
  if (argv.includes('--frame=custom')) return false;
  if (argv.includes('--frame=native')) return true;
  const forced = (process.env.VAULT_FRAME || '').toLowerCase();
  if (forced === 'custom') return false;
  if (forced === 'native') return true;
  const de = [process.env.XDG_CURRENT_DESKTOP, process.env.XDG_SESSION_DESKTOP, process.env.DESKTOP_SESSION]
    .filter(Boolean).join(':');
  return !TILING.test(de);
}

// ── localfile:// (must be declared before app is ready) ─────────
// NOTE: only used for fetch() (thumbnail generation). Images and videos are
// shown through plain file:// URLs — routing a 300 MB video through a custom
// protocol made its metadata load ~15x slower.
protocol.registerSchemesAsPrivileged([{
  scheme: 'localfile',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
}]);

function registerLocalFileProtocol() {
  protocol.handle('localfile', (req) => {
    try {
      const p = decodeURIComponent(new URL(req.url).pathname);
      return net.fetch(pathToFileURL(p).toString(), { headers: req.headers });
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
  });
}

// absolute path → direct file:// URL (fast: the browser streams/seeks the file itself)
function fileUrlFor(p) { return pathToFileURL(p).toString(); }

// absolute path → localfile://local/<path> (every segment encoded).
// A fixed dummy host is used on purpose: for a 'standard' scheme Chromium would
// otherwise treat the first folder of the path as the host and lowercase it.
function localUrl(p) {
  return 'localfile://local' + p.split('/').map(encodeURIComponent).join('/');
}

// ── JSON persistence ────────────────────────────────────────────
function userFile(name) { return path.join(app.getPath('userData'), name); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);          // atomic on the same filesystem
    return true;
  } catch (err) {
    console.error('writeJson failed:', file, err.message);
    return false;
  }
}

// ── Window state ────────────────────────────────────────────────
function onScreen(b) {
  if (typeof b.x !== 'number' || typeof b.y !== 'number') return false;
  return screen.getAllDisplays().some(d => {
    const w = d.workArea;
    const ox = Math.min(b.x + b.width,  w.x + w.width)  - Math.max(b.x, w.x);
    const oy = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return ox >= 120 && oy >= 80;
  });
}

function createMainWindow(o) {
  const native    = useNativeFrame();
  const stateFile = userFile('window-state.json');
  const saved     = readJson(stateFile, {}) || {};
  const area      = screen.getPrimaryDisplay().workArea;

  const width  = Math.min(saved.width  || o.width,  area.width);
  const height = Math.min(saved.height || o.height, area.height);
  const pos    = onScreen({ x: saved.x, y: saved.y, width, height }) ? { x: saved.x, y: saved.y } : {};

  const win = new BrowserWindow({
    width, height, ...pos,
    minWidth: o.minWidth, minHeight: o.minHeight,
    frame: native,
    ...(native ? {} : { titleBarStyle: 'hidden' }),
    autoHideMenuBar: true,
    backgroundColor: '#1e1e2e',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,            // local files only — see README
      plugins: !!o.plugins,          // built-in PDF viewer
      additionalArguments: ['--vault-native-frame=' + (native ? 1 : 0)],
    },
  });
  win.removeMenu();

  // never let a stray drop / link navigate the UI away
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  let tid = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const prev = readJson(stateFile, {}) || {};
    const b = (maximized || win.isFullScreen()) ? prev : win.getBounds();
    writeJson(stateFile, { ...b, maximized });
  };
  const later = () => { clearTimeout(tid); tid = setTimeout(save, 400); };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach(ev => win.on(ev, later));
  win.on('close', () => { clearTimeout(tid); save(); });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize();
    win.show();
  });
  return win;
}

// window-control IPC (used by the custom bar, harmless otherwise)
function registerWindowIpc() {
  const w = e => BrowserWindow.fromWebContents(e.sender);
  ipcMain.on('window-minimize',   e => w(e)?.minimize());
  ipcMain.on('window-maximize',   e => { const x = w(e); if (x) x.isMaximized() ? x.unmaximize() : x.maximize(); });
  ipcMain.on('window-close',      e => w(e)?.close());
  ipcMain.on('toggle-fullscreen', e => { const x = w(e); if (x) x.setFullScreen(!x.isFullScreen()); });
}

// returns false if another instance already runs (then we just quit)
function singleInstance(getWin) {
  if (!app.requestSingleInstanceLock()) { app.quit(); return false; }
  app.on('second-instance', () => {
    const win = getWin();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  return true;
}

function boot(id, create) {
  // makes GNOME match the window to the .desktop file (dock icon / grouping)
  if (typeof app.setDesktopName === 'function') app.setDesktopName(id + '.desktop');
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); } catch {}
  app.whenReady().then(() => {
    // VAULT_DEBUG=1 <app>  → prints whether the GPU is really used (helps diagnose stutter)
    if (process.env.VAULT_DEBUG === '1') {
      console.log('[vault] GPU feature status:', JSON.stringify(app.getGPUFeatureStatus(), null, 1));
      console.log('[vault] frame mode:', useNativeFrame() ? 'native' : 'custom', '| session:', process.env.XDG_SESSION_TYPE);
    }
    Menu.setApplicationMenu(null);
    registerLocalFileProtocol();
    registerWindowIpc();
    create();
  });
  app.on('window-all-closed', () => app.quit());
}

module.exports = {
  createMainWindow, singleInstance, boot,
  readJson, writeJson, userFile, localUrl, fileUrlFor,
};
