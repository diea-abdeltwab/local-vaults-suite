const { app, BrowserWindow, ipcMain, dialog, protocol, nativeTheme, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

nativeTheme.themeSource = 'dark';
let mainWindow;

// ── GPU / quality flags ──────────────────────────────────────────
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// ── Window state ─────────────────────────────────────────────────
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
function loadWinState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { width:1400, height:880, maximized:false }; }
}
function saveWinState() {
  if (!mainWindow) return;
  try {
    const maximized = mainWindow.isMaximized();
    const b = maximized ? loadWinState() : mainWindow.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized }), 'utf8');
  } catch {}
}

function createWindow() {
  const ws = loadWinState();
  mainWindow = new BrowserWindow({
    width: ws.width, height: ws.height,
    x: ws.x, y: ws.y,
    minWidth: 900, minHeight: 600,
    frame: false, titleBarStyle: 'hidden',
    backgroundColor: '#1e1e2e',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      zoomFactor: 1.0,
      plugins: true,   // needed for PDF viewing
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (ws.maximized) mainWindow.maximize();
    mainWindow.show();
    mainWindow.webContents.setZoomFactor(1.0);
  });

  ['resize','move'].forEach(ev => mainWindow.on(ev, saveWinState));
  mainWindow.on('close', saveWinState);

  if (!ipcMain.eventNames().includes('window-minimize')) {
    ipcMain.on('window-minimize',   () => mainWindow.minimize());
    ipcMain.on('window-maximize',   () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
    ipcMain.on('window-close',      () => mainWindow.close());
    ipcMain.on('toggle-fullscreen', () => mainWindow.setFullScreen(!mainWindow.isFullScreen()));
  }
}

// ── Open folder dialog ───────────────────────────────────────────
ipcMain.handle('open-folder-dialog', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select PDF Library Folder',
    buttonLabel: 'Select Folder',
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── Recursive scan ───────────────────────────────────────────────
// Builds a tree node for any folder, arbitrary depth:
//   { type:'folder', name, path, children:[...], pdfCount, totalPdfCount }
//   { type:'pdf', name, path, size }
// Empty folders (no PDFs anywhere inside, recursively) are pruned.

function getDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}
function getPDFs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
      .map(e => {
        const fp = path.join(dir, e.name);
        try { return { name: e.name, path: fp, size: fs.statSync(fp).size }; }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}

function buildTree(dirPath, dirName) {
  const subDirs = getDirs(dirPath);
  const pdfs    = getPDFs(dirPath);

  const childFolders = subDirs
    .map(d => buildTree(path.join(dirPath, d.name), d.name))
    .filter(Boolean); // prune empty branches

  const pdfNodes = pdfs.map(p => ({ type: 'pdf', name: p.name, path: p.path, size: p.size, courseName: dirName }));

  const children = [...childFolders, ...pdfNodes];
  if (children.length === 0) return null; // empty folder, prune

  const totalPdfCount = childFolders.reduce((sum, c) => sum + c.totalPdfCount, 0) + pdfNodes.length;

  return {
    type: 'folder',
    name: dirName,
    path: dirPath,
    children,
    directPdfCount: pdfNodes.length,
    totalPdfCount,
  };
}

ipcMain.handle('scan-root', async (e, rootPath) => {
  const name = path.basename(rootPath) || rootPath;
  const tree = buildTree(rootPath, name);
  if (!tree) return { mode: 'empty' };
  return { mode: 'tree', tree };
});

// ── Persistence ──────────────────────────────────────────────────
const PROGRESS_FILE = path.join(app.getPath('userData'), 'pdf-progress.json');
ipcMain.handle('load-progress', () => {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); }
  catch { return {}; }
});
ipcMain.handle('save-progress', (e, data) => {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data), 'utf8'); }
  catch (err) { console.error('save-progress error:', err); }
});

const RECENT_FILE = path.join(app.getPath('userData'), 'recent-paths.json');
ipcMain.handle('load-recent', () => {
  try { return JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')); }
  catch { return []; }
});
ipcMain.handle('save-recent', (e, paths) => {
  try { fs.writeFileSync(RECENT_FILE, JSON.stringify(paths.slice(0,2)), 'utf8'); }
  catch {}
});

const STAR_FILE = path.join(app.getPath('userData'), 'pdf-starred.json');
ipcMain.handle('load-starred', () => {
  try { return JSON.parse(fs.readFileSync(STAR_FILE, 'utf8')); }
  catch { return {}; }
});
ipcMain.handle('save-starred', (e, data) => {
  try { fs.writeFileSync(STAR_FILE, JSON.stringify(data), 'utf8'); }
  catch (err) { console.error('save-starred error:', err); }
});

// ── Misc ─────────────────────────────────────────────────────────
ipcMain.handle('show-in-folder', (e, fp) => shell.showItemInFolder(fp));
ipcMain.handle('copy-to-clipboard', (e, text) => require('electron').clipboard.writeText(text));
ipcMain.handle('open-external', (e, fp) => shell.openPath(fp));

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.registerFileProtocol('localfile', (req, cb) => {
    cb({ path: decodeURIComponent(req.url.replace('localfile://', '')) });
  });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
