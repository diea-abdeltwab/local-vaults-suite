const { app, BrowserWindow, ipcMain, dialog, protocol, nativeTheme, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

nativeTheme.themeSource = 'dark';
let mainWindow;

// Window control IPC — registered once at module level, not inside createWindow
ipcMain.on('window-minimize',   () => mainWindow?.minimize());
ipcMain.on('window-maximize',   () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('window-close',      () => mainWindow?.close());
ipcMain.on('toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow?.isFullScreen()));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 800, minHeight: 600,
    frame: false, titleBarStyle: 'hidden',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

ipcMain.handle('open-folder-dialog', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('open-file-dialog', async () => {
  if (!mainWindow) return [];
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFiles','multiSelections'],
    filters: [{ name: 'Images & Videos', extensions: ['jpg','jpeg','png','gif','webp','bmp','svg','jfif','avif','webm','mp4'] }]
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('scan-folder', async (e, folderPath) => {
  const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','jfif','avif','webm','mp4']);
  const results = [];
  function scanDir(dir, depth=0) {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { scanDir(fullPath, depth+1); }
      else if (entry.isFile()) {
        const ext = entry.name.split('.').pop().toLowerCase();
        if (IMAGE_EXTS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            results.push({ filePath: fullPath, name: entry.name, size: stat.size, mtime: stat.mtimeMs, ext, isVideo: ext==='webm'||ext==='mp4' });
          } catch {}
        }
      }
    }
  }
  scanDir(folderPath);
  results.sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  return results;
});

ipcMain.handle('show-in-folder',   (e, p)    => shell.showItemInFolder(p));
ipcMain.handle('copy-to-clipboard',(e, text) => { require('electron').clipboard.writeText(text); });

// ── persistence ────────────────────────────────────────────────
const userData    = () => app.getPath('userData');
const FAVS_FILE   = () => path.join(userData(), 'favorites.json');
const RECENT_FILE = () => path.join(userData(), 'recent.json');

ipcMain.handle('load-favorites', () => { try { return JSON.parse(fs.readFileSync(FAVS_FILE(),'utf8')); } catch { return []; } });
ipcMain.handle('save-favorites', (e, favs)  => { fs.writeFileSync(FAVS_FILE(),   JSON.stringify(favs),          'utf8'); });
ipcMain.handle('load-recent',    ()         => { try { return JSON.parse(fs.readFileSync(RECENT_FILE(),'utf8')); } catch { return []; } });
ipcMain.handle('save-recent',    (e, paths) => { fs.writeFileSync(RECENT_FILE(),  JSON.stringify(paths.slice(0,2)),'utf8'); });

app.whenReady().then(() => {
  protocol.registerFileProtocol('localfile', (req, cb) => cb({ path: decodeURIComponent(req.url.replace('localfile://','')) }));
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
