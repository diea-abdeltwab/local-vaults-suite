const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { LANG_MAP, NAME_MAP } = require('./langmap.js');

nativeTheme.themeSource = 'dark';
let mainWindow;

// ── Performance flags ─────────────────────────────────────────────
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// ── Window state ─────────────────────────────────────────────────
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
function loadWinState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { width:1440, height:900, maximized:false }; }
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
    minWidth: 960, minHeight: 620,
    frame: false, titleBarStyle: 'hidden',
    backgroundColor: '#1e1e2e',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      zoomFactor: 1.0,
      plugins: true,   // needed for in-app PDF viewing
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

  if (!app._winControlsRegistered) {
    app._winControlsRegistered = true;
    ipcMain.on('window-minimize',   () => mainWindow?.minimize());
    ipcMain.on('window-maximize',   () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
    ipcMain.on('window-close',      () => mainWindow?.close());
    ipcMain.on('toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow?.isFullScreen()));
  }
}

// ── Open folder dialog ───────────────────────────────────────────
ipcMain.handle('open-folder-dialog', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Your Code Library / Repos Folder',
    buttonLabel: 'Select Folder',
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── File classification ──────────────────────────────────────────
// Directories we never descend into — heavy/noisy, never useful in a
// "code vault" browsing context.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv',
  'env', '.env', 'dist', 'build', 'out', '.idea', '.vscode', '.next',
  '.nuxt', 'target', 'bin', 'obj', '.gradle', '.mypy_cache', '.pytest_cache',
  '.tox', 'vendor', 'Pods', 'DerivedData', '.cache', 'coverage',
]);

function classify(name) {
  const lower = name.toLowerCase();
  if (NAME_MAP[lower]) return { kind: 'code', meta: NAME_MAP[lower] };
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const ext = lower.slice(dot + 1);
    if (LANG_MAP[ext]) return { kind: 'code', meta: LANG_MAP[ext], ext };
  }
  return { kind: 'asset', meta: null, ext: dot > 0 ? lower.slice(dot + 1) : '' };
}

// ── Recursive tree scan ───────────────────────────────────────────
// Node shapes:
//   folder: { type:'folder', name, path, children:[...], codeCount, assetCount, totalCodeCount }
//   code:   { type:'code', name, path, size, ext, lang, hljs, color, notebook:bool }
//   asset:  { type:'asset', name, path, size, ext }
function getEntries(dir) {
  try {
    // Note: dotfiles are intentionally kept (e.g. .eslintrc, .env, .nvmrc are
    // useful to browse). Noisy dot-directories are excluded via IGNORE_DIRS.
    return fs.readdirSync(dir, { withFileTypes: true })
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}

function buildTree(dirPath, dirName) {
  if (IGNORE_DIRS.has(dirName)) return null;
  const entries = getEntries(dirPath);

  const childFolders = [];
  const codeFiles = [];
  const assetFiles = [];

  for (const e of entries) {
    const fp = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      const sub = buildTree(fp, e.name);
      if (sub) childFolders.push(sub);
    } else if (e.isFile()) {
      let stat;
      try { stat = fs.statSync(fp); } catch { continue; }
      const { kind, meta, ext } = classify(e.name);
      if (kind === 'code') {
        codeFiles.push({
          type: 'code', name: e.name, path: fp, size: stat.size,
          ext: ext || '', lang: meta.lang, hljs: meta.hljs, color: meta.color,
          notebook: meta.kind === 'notebook',
        });
      } else {
        assetFiles.push({ type: 'asset', name: e.name, path: fp, size: stat.size, ext });
      }
    }
  }

  const children = [...childFolders, ...codeFiles, ...assetFiles];
  if (children.length === 0) return null; // prune empty branches

  const totalCodeCount = childFolders.reduce((s,c) => s + c.totalCodeCount, 0) + codeFiles.length;
  const totalAssetCount = childFolders.reduce((s,c) => s + c.totalAssetCount, 0) + assetFiles.length;

  return {
    type: 'folder', name: dirName, path: dirPath, children,
    codeCount: codeFiles.length, assetCount: assetFiles.length,
    totalCodeCount, totalAssetCount,
  };
}

ipcMain.handle('scan-root', async (e, rootPath) => {
  const name = path.basename(rootPath) || rootPath;
  const tree = buildTree(rootPath, name);
  if (!tree) return { mode: 'empty' };
  return { mode: 'tree', tree };
});

// ── Read file content (for viewer) ───────────────────────────────
const MAX_READ = 4 * 1024 * 1024; // 4MB cap
ipcMain.handle('read-file', async (e, filePath) => {
  try {
    const stat = await fsp.stat(filePath);
    const buf = await fsp.readFile(filePath, { encoding: null, flag: 'r' });
    const truncated = buf.length > MAX_READ;
    const slice = truncated ? buf.subarray(0, MAX_READ) : buf;
    // Strip BOM, decode utf8 (best effort)
    let text = slice.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return { ok: true, content: text, size: stat.size, truncated };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Read raw binary content as base64 (for in-app docx/xlsx preview) ─
const MAX_BINARY_READ = 30 * 1024 * 1024; // 30MB cap
ipcMain.handle('read-file-binary', async (e, filePath) => {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_BINARY_READ) {
      return { ok: false, error: `File too large to preview (${(stat.size / (1024*1024)).toFixed(1)} MB)` };
    }
    const buf = await fsp.readFile(filePath);
    return { ok: true, base64: buf.toString('base64'), size: stat.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Compute vault-wide stats (language breakdown, LOC) ───────────
const STATS_FILE_CAP = 1.5 * 1024 * 1024; // don't count lines for files over this
async function getEntriesAsync(dir) {
  try { return await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return []; }
}

ipcMain.handle('compute-stats', async (e, rootPath) => {
  const byLang = {}; // lang -> { files, lines, size, color }
  let totalFiles = 0, totalLines = 0, totalSize = 0, totalAssets = 0;

  async function walk(dir) {
    const entries = await getEntriesAsync(dir);
    for (const en of entries) {
      const fp = path.join(dir, en.name);
      if (en.isDirectory()) {
        if (IGNORE_DIRS.has(en.name)) continue;
        await walk(fp);
      } else if (en.isFile()) {
        let stat;
        try { stat = await fsp.stat(fp); } catch { continue; }
        const { kind, meta } = classify(en.name);
        if (kind !== 'code') { totalAssets++; continue; }
        totalFiles++;
        totalSize += stat.size;
        if (!byLang[meta.lang]) byLang[meta.lang] = { files: 0, lines: 0, size: 0, color: meta.color };
        byLang[meta.lang].files++;
        byLang[meta.lang].size += stat.size;
        if (stat.size <= STATS_FILE_CAP) {
          try {
            const content = await fsp.readFile(fp, 'utf8');
            const lines = content.length ? content.split('\n').length : 0;
            byLang[meta.lang].lines += lines;
            totalLines += lines;
          } catch {}
        }
      }
    }
  }
  await walk(rootPath);
  return { totalFiles, totalLines, totalSize, totalAssets, byLang };
});

// ── Filename + content search ─────────────────────────────────────
// Generation counter lets a fresh search invalidate any still-running
// previous one, so rapid keystrokes don't pile up wasted background work.
let searchGeneration = 0;
ipcMain.handle('search-content', async (e, { rootPath, query, maxResults }) => {
  const myGen = ++searchGeneration;
  const q = query.toLowerCase();
  const results = [];
  const cap = maxResults || 150;

  async function walk(dir) {
    if (myGen !== searchGeneration || results.length >= cap) return;
    const entries = await getEntriesAsync(dir);
    for (const en of entries) {
      if (myGen !== searchGeneration || results.length >= cap) return;
      const fp = path.join(dir, en.name);
      if (en.isDirectory()) {
        if (IGNORE_DIRS.has(en.name)) continue;
        await walk(fp);
      } else if (en.isFile()) {
        const { kind } = classify(en.name);
        if (kind !== 'code') continue;
        let stat;
        try { stat = await fsp.stat(fp); } catch { continue; }
        if (stat.size > STATS_FILE_CAP) continue;
        let content;
        try { content = await fsp.readFile(fp, 'utf8'); } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(q)) {
            results.push({ path: fp, name: en.name, lineNo: i + 1, lineText: lines[i].trim().slice(0, 200) });
            if (results.length >= cap) break;
          }
        }
      }
    }
  }
  await walk(rootPath);
  return myGen === searchGeneration ? results : [];
});

// ── Persistence ──────────────────────────────────────────────────
const STAR_FILE = path.join(app.getPath('userData'), 'code-starred.json');
ipcMain.handle('load-starred', () => {
  try { return JSON.parse(fs.readFileSync(STAR_FILE, 'utf8')); }
  catch { return {}; }
});
ipcMain.handle('save-starred', (e, data) => {
  try { fs.writeFileSync(STAR_FILE, JSON.stringify(data), 'utf8'); }
  catch (err) { console.error('save-starred error:', err); }
});

const RECENT_FILE = path.join(app.getPath('userData'), 'recent-paths.json');
ipcMain.handle('load-recent', () => {
  try { return JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')); }
  catch { return []; }
});
ipcMain.handle('save-recent', (e, paths) => {
  try { fs.writeFileSync(RECENT_FILE, JSON.stringify(paths.slice(0,3)), 'utf8'); }
  catch {}
});

const VISITED_FILE = path.join(app.getPath('userData'), 'code-visited.json');
ipcMain.handle('load-visited', () => {
  try { return JSON.parse(fs.readFileSync(VISITED_FILE, 'utf8')); }
  catch { return {}; }
});
ipcMain.handle('save-visited', (e, data) => {
  try { fs.writeFileSync(VISITED_FILE, JSON.stringify(data), 'utf8'); }
  catch (err) { console.error('save-visited error:', err); }
});

// ── Misc ─────────────────────────────────────────────────────────
ipcMain.handle('show-in-folder', (e, fp) => shell.showItemInFolder(fp));
ipcMain.handle('copy-to-clipboard', (e, text) => clipboard.writeText(text));
ipcMain.handle('open-url', (e, url) => shell.openExternal(url));

// ── App lifecycle ──────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
