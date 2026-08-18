const { app, BrowserWindow, ipcMain, dialog, protocol, nativeTheme, shell, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');

nativeTheme.themeSource = 'dark';
let mainWindow;

// ── GPU / Hardware video decode flags — highest quality ──────────
// Chromium media pipeline flags
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-video-encode');
app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-gl', 'desktop');
// Color profile — sRGB is correct for standard (non-HDR) displays;
// forcing display-p3/HDR on an SDR panel washes out or oversaturates colors
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// Audio — larger buffer = fewer underruns/crackling; matches proven config
app.commandLine.appendSwitch('audio-buffer-size', '2048');
// Threading
app.commandLine.appendSwitch('video-threads', '8');
app.commandLine.appendSwitch('num-raster-threads', '4');
app.commandLine.appendSwitch('renderer-process-limit', '4');
// VA-API hardware decode (Linux/AMD/Intel)
app.commandLine.appendSwitch('enable-features', [
  'PlatformHEVCDecoderSupport',
  'VaapiVideoDecodeLinuxGL',
  'VaapiVideoDecoder',
  'VaapiVideoEncoder',
  'VaapiIgnoreDriverChecks',
  'UseMultiPlaneFormatForHardwareVideo',
  'CanvasOopRasterization',
].join(','));
app.commandLine.appendSwitch('disable-features',
  'UseChromeOSDirectVideoDecoder'
);

// ── Window state ─────────────────────────────────────────────────
const STATE_FILE = path.join(app.getPath('userData'), 'video-vault-window-state.json');
function loadWinState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { width: 1400, height: 880, maximized: false }; }
}
function saveWinState() {
  if (!mainWindow) return;
  try {
    const maximized = mainWindow.isMaximized();
    const b = maximized ? loadWinState() : mainWindow.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized }), 'utf8');
  } catch {}
}

ipcMain.on('window-minimize',   () => mainWindow?.minimize());
ipcMain.on('window-maximize',   () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('window-close',      () => mainWindow?.close());
ipcMain.on('toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow?.isFullScreen()));

function createWindow() {
  const ws = loadWinState();
  mainWindow = new BrowserWindow({
    width: ws.width || 1400, height: ws.height || 880,
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
      backgroundThrottling: false,
      offscreen: false,
      // High quality rendering
      enablePreferredSizeMode: false,
      disableHtmlFullscreenWindowResize: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (ws.maximized) mainWindow.maximize();
    mainWindow.show();
    mainWindow.webContents.setZoomFactor(1.0);
  });

  ['resize', 'move'].forEach(ev => mainWindow.on(ev, saveWinState));
  mainWindow.on('close', saveWinState);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Open folder dialog ───────────────────────────────────────────
ipcMain.handle('open-folder-dialog', async () => {
  try {
    const r = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Your Video Library Folder',
      buttonLabel: 'Select Folder',
    });
    if (r.canceled || !r.filePaths || r.filePaths.length === 0) return null;
    const p = r.filePaths[0];
    if (!p || typeof p !== 'string') return null;
    return p;
  } catch (err) {
    console.error('open-folder-dialog error:', err);
    return null;
  }
});

// ── File extensions ───────────────────────────────────────────────
const VIDEO_EXT = new Set([
  'mp4','mkv','avi','mov','wmv','flv','webm','m4v',
  'ts','m2ts','mpg','mpeg','3gp','ogv','rmvb','vob',
]);
const IMG_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','avif']);
const SUB_EXT = new Set(['srt','ass','ssa','vtt','sub']);

const getExt  = name => name.split('.').pop().toLowerCase();
const isVideo = name => VIDEO_EXT.has(getExt(name));
const isImage = name => IMG_EXT.has(getExt(name));

// ── Directory & file helpers ──────────────────────────────────────
function getDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a,b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  } catch { return []; }
}

function getVideos(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && isVideo(e.name))
      .map(e => {
        const fp = path.join(dir, e.name);
        try { return { filePath: fp, name: e.name, size: fs.statSync(fp).size }; }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a,b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  } catch { return []; }
}

function findThumb(dir) {
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    const names = ['thumb','poster','cover','folder','fanart','preview'];
    for (const n of names) {
      const m = files.find(f => f.isFile() && isImage(f.name) && f.name.toLowerCase().startsWith(n));
      if (m) return path.join(dir, m.name);
    }
    const any = files.find(f => f.isFile() && isImage(f.name));
    if (any) return path.join(dir, any.name);
  } catch {}
  return null;
}

function findSubtitle(dir, baseName) {
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    const base  = baseName.toLowerCase();
    const matches = files.filter(f =>
      f.isFile() && SUB_EXT.has(getExt(f.name)) && f.name.toLowerCase().startsWith(base)
    );
    if (matches.length) {
      const ar = matches.find(f => /\.(ar|ara|arabic)\./i.test(f.name));
      return path.join(dir, (ar || matches[0]).name);
    }
    const any = files.find(f => f.isFile() && SUB_EXT.has(getExt(f.name)));
    if (any) return path.join(dir, any.name);
  } catch {}
  return null;
}

// ── Collect all videos recursively ───────────────────────────────
function collectAllVideos(root, maxDepth = 6) {
  const results = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    getVideos(dir).forEach(f => results.push({ ...f, dir, dirName: path.basename(dir) }));
    getDirs(dir).forEach(sub => walk(sub.path, depth + 1));
  };
  walk(root, 0);
  return results;
}

function makeVideo(f, groupLabel) {
  const rawName = f.name.replace(/\.[^.]+$/, '');
  // Clean display name: strip YouTube IDs like [xYz123] at end
  const displayName = rawName.replace(/[\[（(][a-zA-Z0-9_\-]{6,12}[\]）)]\s*$/, '').trim() || rawName;
  // dir may be missing on rootVideos objects (from getVideos) — derive from filePath
  const dir     = f.dir || (f.filePath ? path.dirname(f.filePath) : null);
  const dirName = f.dirName || (dir ? path.basename(dir) : '');
  return {
    name:         f.name,
    displayName,
    filePath:     f.filePath,
    dir,
    dirName,
    size:         f.size,
    group:        groupLabel || null,
    // No thumbPath for individual videos — renderer extracts from the video file itself
    thumbPath:    null,
    subtitlePath: dir ? findSubtitle(dir, rawName) : null,
  };
}

// ── Scan root ─────────────────────────────────────────────────────
// Structure we expect:
//   root/
//     ChannelA/
//       SubFolder?/
//         video.mp4
//     ChannelB/
//       video.mp4
//   root/
//     video.mp4   ← flat collection
//
// Output modes:
//   'library'    → { channels: [{name, path, thumbPath, videos, groups}] }
//   'collection' → { collectionName, thumbPath, videos, groups }
//   'empty'

ipcMain.handle('scan-root', async (e, rootPath) => {
  // Debug: log exactly what we received
  console.log('[scan-root] received rootPath:', JSON.stringify(rootPath), 'type:', typeof rootPath);
  if (!rootPath || typeof rootPath !== 'string') {
    console.error('[scan-root] INVALID rootPath — caller stack:', new Error().stack);
    return { mode: 'empty' };
  }
  const rootThumb  = findThumb(rootPath);
  const rootVideos = getVideos(rootPath);
  const subDirs    = getDirs(rootPath);
  const allVideos  = collectAllVideos(rootPath);

  if (allVideos.length === 0) return { mode: 'empty' };

  // Flat root (no subdirs at all) → single collection
  if (subDirs.length === 0) {
    const videos = rootVideos.map(f => makeVideo(f, null));
    return {
      mode: 'collection',
      collectionName: path.basename(rootPath),
      thumbPath: rootThumb,
      videos,
      groups: [],
      total: videos.length,
    };
  }

  // Check if subdirs actually contain any videos
  const subDirVideoCount = allVideos.filter(f => f.dir !== rootPath).length;

  // Root has videos directly + subdirs either empty or non-video → flat collection
  if (rootVideos.length > 0 && subDirVideoCount === 0) {
    const videos = rootVideos.map(f => makeVideo(f, null));
    return {
      mode: 'collection',
      collectionName: path.basename(rootPath),
      thumbPath: rootThumb,
      videos,
      groups: [],
      total: videos.length,
    };
  }

  // Root has videos directly + subdirs also have videos → collection with groups
  if (rootVideos.length > 0 && subDirVideoCount > 0) {
    const videos = allVideos.map(f => {
      const rel   = path.relative(rootPath, f.dir);
      const group = rel && rel !== '.' ? rel : null;
      return makeVideo(f, group);
    });
    return {
      mode: 'collection',
      collectionName: path.basename(rootPath),
      thumbPath: rootThumb,
      videos,
      groups: [...new Set(videos.map(v => v.group).filter(Boolean))],
      total: videos.length,
    };
  }

  // Library: immediate subdirs = channels
  const channels = subDirs.map(channelDir => {
    // Use path separator to avoid false prefix matches (e.g. "Pop" matching "Pop_Dance")
    const chanPrefix = channelDir.path + path.sep;
    const chanVideos = allVideos.filter(f => f.dir === channelDir.path || f.dir.startsWith(chanPrefix));
    if (chanVideos.length === 0) return null;

    const chanThumb   = findThumb(channelDir.path) || rootThumb;
    const chanSubDirs = getDirs(channelDir.path);

    const videos = [];
    const groups = [];

    if (chanSubDirs.length > 0) {
      // Has sub-groups (playlists / series)
      chanSubDirs.forEach(groupDir => {
        const groupPrefix = groupDir.path + path.sep;
        const gVids = allVideos.filter(f => f.dir === groupDir.path || f.dir.startsWith(groupPrefix));
        gVids.forEach(f => videos.push(makeVideo(f, groupDir.name)));
        if (gVids.length > 0) groups.push(groupDir.name);
      });
      // Plus flat files directly in channelDir
      allVideos.filter(f => f.dir === channelDir.path)
        .forEach(f => videos.push(makeVideo(f, null)));
    } else {
      chanVideos.forEach(f => videos.push(makeVideo(f, null)));
    }

    if (videos.length === 0) return null;

    return {
      name:      channelDir.name,
      path:      channelDir.path,
      thumbPath: chanThumb,
      videos,
      groups:    [...new Set(groups)],
      total:     videos.length,
    };
  }).filter(Boolean);

  if (channels.length > 0) {
    return { mode: 'library', channels, total: allVideos.length };
  }

  // Fallback: flat collection with group labels from relative paths
  const videos = allVideos.map(f => {
    const rel   = path.relative(rootPath, f.dir);
    const group = rel && rel !== '.' ? rel : null;
    return makeVideo(f, group);
  });
  return {
    mode: 'collection',
    collectionName: path.basename(rootPath),
    thumbPath: rootThumb,
    videos,
    groups: [...new Set(videos.map(v => v.group).filter(Boolean))],
    total: videos.length,
  };
});

// ── Persistence ───────────────────────────────────────────────────
const PROGRESS_FILE = path.join(app.getPath('userData'), 'video-vault-progress.json');
ipcMain.handle('load-progress', () => {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return {}; }
});
ipcMain.handle('save-progress', (e, data) => {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data), 'utf8'); } catch {}
});

const RECENT_FILE = path.join(app.getPath('userData'), 'video-vault-recent.json');

// ── Startup: wipe corrupt recent file ────────────────────────────
try {
  const raw = JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8'));
  const isValid = Array.isArray(raw) && raw.every(
    r => r && typeof r === 'object' && typeof r.path === 'string' && r.path.startsWith('/')
  );
  if (!isValid) {
    console.log('[startup] recent file corrupt or old format — wiping:', JSON.stringify(raw));
    fs.writeFileSync(RECENT_FILE, '[]', 'utf8');
  }
} catch (e) {
  // File missing or unparseable — write clean slate
  try { fs.writeFileSync(RECENT_FILE, '[]', 'utf8'); } catch {}
}

ipcMain.handle('load-recent', () => {
  try {
    const raw = JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8'));
    if (!Array.isArray(raw)) {
      // Corrupt file — wipe it
      try { fs.writeFileSync(RECENT_FILE, '[]', 'utf8'); } catch {}
      return [];
    }
    // Normalize every entry — accept strings, {path}, {path,name}, reject anything else
    const normalized = raw
      .map(r => {
        if (typeof r === 'string' && r.length > 0)
          return { path: r, name: r.split('/').filter(Boolean).pop() || r };
        if (r !== null && typeof r === 'object') {
          // Extract path from any key that looks like an absolute path
          const p = (typeof r.path === 'string' && r.path.startsWith('/')) ? r.path
                  : Object.values(r).find(v => typeof v === 'string' && v.startsWith('/'));
          if (p) return { path: p, name: p.split('/').filter(Boolean).pop() || p };
        }
        return null;
      })
      .filter(Boolean)
      .slice(0, 3);
    // Always rewrite normalized form so corrupt data can never come back
    try { fs.writeFileSync(RECENT_FILE, JSON.stringify(normalized), 'utf8'); } catch {}
    return normalized;
  } catch {
    // Any parse error — wipe the file
    try { fs.writeFileSync(RECENT_FILE, '[]', 'utf8'); } catch {}
    return [];
  }
});
ipcMain.handle('save-recent', (e, paths) => {
  if (!Array.isArray(paths)) return;
  const safe = paths
    .filter(r => r && typeof r.path === 'string' && r.path.length > 0)
    .slice(0, 3);
  try { fs.writeFileSync(RECENT_FILE, JSON.stringify(safe), 'utf8'); } catch {}
});

// ── Subtitle loader (SRT / ASS → VTT) ────────────────────────────
function srtToVtt(text) {
  let vtt = 'WEBVTT\n\n';
  text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split(/\n{2,}/).forEach(block => {
    const lines = block.trim().split('\n');
    if (lines.length < 2) return;
    let i = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    const timeLine = lines[i];
    if (!timeLine?.includes('-->')) return;
    const body = lines.slice(i+1)
      .map(l => l.replace(/<font[^>]*>/gi,'').replace(/<\/font>/gi,'').replace(/\{[^}]*\}/g,''))
      .join('\n').trim();
    if (body) vtt += timeLine.replace(/,/g,'.') + '\n' + body + '\n\n';
  });
  return vtt;
}
function assToVtt(text) {
  let vtt = 'WEBVTT\n\n';
  const cvt = t => {
    const [h,m,sc] = t.split(':');
    const [s,cs]   = (sc||'0.00').split('.');
    return `${h.padStart(2,'0')}:${m.padStart(2,'0')}:${s.padStart(2,'0')}.${(cs||'00').padEnd(3,'0')}`;
  };
  text.replace(/\r\n/g,'\n').split('\n')
    .filter(l => l.startsWith('Dialogue:'))
    .forEach(line => {
      const p = line.slice('Dialogue:'.length).split(',');
      if (p.length < 10) return;
      const body = p.slice(9).join(',')
        .replace(/\{[^}]*\}/g,'').replace(/\\N/g,'\n').replace(/\\n/g,'\n').trim();
      if (body) vtt += `${cvt(p[1].trim())} --> ${cvt(p[2].trim())}\n${body}\n\n`;
    });
  return vtt;
}
ipcMain.handle('load-subtitle', (e, subPath) => {
  try {
    const ext = path.extname(subPath).toLowerCase();
    const raw = fs.readFileSync(subPath);
    let text;
    try { text = raw.toString('utf8'); } catch { text = raw.toString('latin1'); }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    let vtt;
    if      (ext === '.vtt')                   vtt = text;
    else if (ext === '.srt' || ext === '.sub') vtt = srtToVtt(text);
    else if (ext === '.ass' || ext === '.ssa') vtt = assToVtt(text);
    else                                       vtt = srtToVtt(text);
    return { ok: true, vtt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Misc IPC ──────────────────────────────────────────────────────
ipcMain.handle('show-in-folder',    (e, fp)   => shell.showItemInFolder(fp));
ipcMain.handle('copy-to-clipboard', (e, text) => clipboard.writeText(text));
ipcMain.handle('open-external',     (e, fp)   => shell.openPath(fp));

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.registerFileProtocol('localfile', (req, cb) => {
    cb({ path: decodeURIComponent(req.url.replace('localfile://', '')) });
  });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
