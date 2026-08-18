const { app, BrowserWindow, ipcMain, dialog, protocol, nativeTheme, shell, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');

nativeTheme.themeSource = 'dark';
let mainWindow;

// ── GPU / Hardware video & audio quality flags ───────────────────
// Core GPU acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');

// Hardware video decode
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-video-encode');

// Enable features — video hardware decode + audio pipeline fixes
app.commandLine.appendSwitch('enable-features', [
  'VaapiVideoDecoder',
  'VaapiVideoEncoder',
  'VaapiVideoDecodeLinuxGL',
  'VaapiIgnoreDriverChecks',
  'CanvasOopRasterization',
  'PlatformHEVCDecoderSupport',
  'AudioServiceOutOfProcess',  // audio in separate OS process = less CPU contention = no crackle
].join(','));

app.commandLine.appendSwitch('disable-features', [
  'UseChromeOSDirectVideoDecoder',
  // NOTE: do NOT disable MediaSessionService — needed for OS media controls
].join(','));

// GPU memory & rendering
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-memory-buffer-video-frames');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('use-gl', 'desktop');

// Audio-specific flags — prevent resampling artifacts & crackling
app.commandLine.appendSwitch('audio-buffer-size', '2048');    // larger buffer = fewer underruns
// Color profile
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// ── Window state ─────────────────────────────────────────────────
const STATE_FILE = path.join(app.getPath('userData'), 'music-window-state.json');
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

// ── Window IPC (registered once at module load) ──────────────────
ipcMain.on('window-minimize',   () => mainWindow?.minimize());
ipcMain.on('window-maximize',   () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('window-close',      () => mainWindow?.close());
ipcMain.on('toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()));

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
      // Hardware acceleration
      backgroundThrottling: false,
      offscreen: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
    // Enable high-DPI / Retina rendering
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
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Your Music Library Folder',
    buttonLabel: 'Select Folder',
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── File extension sets ──────────────────────────────────────────
const AUDIO_EXT = new Set([
  'm4a','mp3','flac','wav','ogg','opus','aac',
  'wma','aiff','alac','ape','dsf','m4b','mka',
]);
const CLIP_EXT = new Set([
  'mp4','mkv','avi','mov','wmv','flv','webm',
  'm4v','ts','m2ts','mpg','mpeg','3gp','ogv',
]);
const IMG_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','avif']);
const SUB_EXT = new Set(['srt','ass','ssa','vtt','sub']);

const getExt  = name => name.split('.').pop().toLowerCase();
const isAudio = name => AUDIO_EXT.has(getExt(name));
const isClip  = name => CLIP_EXT.has(getExt(name));
const isMedia = name => isAudio(name) || isClip(name);
const isImage = name => IMG_EXT.has(getExt(name));

// ── Directory helpers ─────────────────────────────────────────────
function getDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a,b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  } catch { return []; }
}

function getMediaFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && isMedia(e.name))
      .map(e => {
        const fp = path.join(dir, e.name);
        try {
          return { filePath: fp, name: e.name, size: fs.statSync(fp).size, isClip: isClip(e.name), isAudio: isAudio(e.name) };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a,b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  } catch { return []; }
}

function findCover(dir) {
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    const names = ['cover','folder','poster','thumb','front','artwork','album'];
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
    // Prefer exact base-name match, then Arabic variant, then any subtitle
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

// ── Collect all media recursively ────────────────────────────────
function collectAllMedia(root, maxDepth = 6) {
  const results = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    getMediaFiles(dir).forEach(f => results.push({ ...f, dir, dirName: path.basename(dir) }));
    getDirs(dir).forEach(sub => walk(sub.path, depth + 1));
  };
  walk(root, 0);
  return results;
}

function makeTrack(f, albumLabel) {
  const rawName = f.name.replace(/\.[^.]+$/, '');
  return {
    name:         f.name,
    displayName:  rawName,
    filePath:     f.filePath,
    dir:          f.dir,
    dirName:      f.dirName || path.basename(f.dir),
    size:         f.size,
    album:        albumLabel || null,
    isClip:       !!f.isClip,
    isAudio:      !!f.isAudio,
    coverPath:    findCover(f.dir),
    subtitlePath: f.isClip ? findSubtitle(f.dir, rawName) : null,
  };
}

// ── Scan root ────────────────────────────────────────────────────
ipcMain.handle('scan-root', async (e, rootPath) => {
  const cover     = findCover(rootPath);
  const rootMedia = getMediaFiles(rootPath);
  const subDirs   = getDirs(rootPath);
  const allMedia  = collectAllMedia(rootPath);

  if (allMedia.length === 0) return { mode: 'empty' };

  const totalAudio = allMedia.filter(f => f.isAudio).length;
  const totalClips = allMedia.filter(f => f.isClip).length;

  // Flat root with no subdirs → single collection
  if (rootMedia.length > 0 && subDirs.length === 0) {
    return {
      mode: 'collection',
      collectionName: path.basename(rootPath),
      coverPath: cover,
      tracks: rootMedia.map(f => makeTrack(f, null)),
      albums: [],
      totalAudio, totalClips,
    };
  }

  if (subDirs.length === 0) return { mode: 'empty' };

  // Library: subdirs = artists/genres, their subdirs = albums
  // Fix: use path separator to avoid prefix collision (e.g. /Music/Pop vs /Music/Pop2)
  const sep = path.sep;
  const artists = subDirs.map(artistDir => {
    const aPath   = artistDir.path.endsWith(sep) ? artistDir.path : artistDir.path + sep;
    const artistMedia = allMedia.filter(f =>
      f.dir === artistDir.path || f.dir.startsWith(aPath)
    );
    if (artistMedia.length === 0) return null;

    const artistCover   = findCover(artistDir.path);
    const artistSubDirs = getDirs(artistDir.path);
    const tracks = [];
    const albums = [];

    if (artistSubDirs.length > 0) {
      artistSubDirs.forEach(albumDir => {
        const albPath    = albumDir.path.endsWith(sep) ? albumDir.path : albumDir.path + sep;
        const albumMedia = allMedia.filter(f => f.dir === albumDir.path || f.dir.startsWith(albPath));
        albumMedia.forEach(f => tracks.push(makeTrack(f, albumDir.name)));
        if (albumMedia.length > 0) albums.push(albumDir.name);
      });
      allMedia.filter(f => f.dir === artistDir.path)
        .forEach(f => tracks.push(makeTrack(f, null)));
    } else {
      artistMedia.forEach(f => tracks.push(makeTrack(f, null)));
    }

    if (tracks.length === 0) return null;

    return {
      name:       artistDir.name,
      path:       artistDir.path,
      coverPath:  artistCover || cover,
      tracks,
      albums:     [...new Set(albums)],
      totalAudio: tracks.filter(t => t.isAudio).length,
      totalClips: tracks.filter(t => t.isClip).length,
    };
  }).filter(Boolean);

  if (artists.length > 0) {
    return { mode: 'library', artists, totalAudio, totalClips };
  }

  // Fallback flat collection with relative-path albums
  const tracks = allMedia.map(f => {
    const rel   = path.relative(rootPath, f.dir);
    const album = rel && rel !== '.' ? rel : null;
    return makeTrack(f, album);
  });
  return {
    mode: 'collection',
    collectionName: path.basename(rootPath),
    coverPath: cover,
    tracks,
    albums: [...new Set(tracks.map(t => t.album).filter(Boolean))],
    totalAudio, totalClips,
  };
});

// ── Persistence ──────────────────────────────────────────────────
const PROGRESS_FILE = path.join(app.getPath('userData'), 'music-progress.json');
ipcMain.handle('load-progress', () => {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return {}; }
});
ipcMain.handle('save-progress', (e, data) => {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data), 'utf8'); } catch {}
});

const RECENT_FILE = path.join(app.getPath('userData'), 'music-recent.json');
ipcMain.handle('load-recent', () => {
  try { return JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')); } catch { return []; }
});
ipcMain.handle('save-recent', (e, paths) => {
  try { fs.writeFileSync(RECENT_FILE, JSON.stringify(paths.slice(0,3)), 'utf8'); } catch {}
});

// ── Subtitle converter  SRT / ASS → WebVTT ───────────────────────
function srtToVtt(text) {
  let vtt = 'WEBVTT\n\n';
  const normalized = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  normalized.split(/\n{2,}/).forEach(block => {
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
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    let vtt;
    if      (ext === '.vtt')                  vtt = text;
    else if (ext === '.srt' || ext === '.sub') vtt = srtToVtt(text);
    else if (ext === '.ass' || ext === '.ssa') vtt = assToVtt(text);
    else                                       vtt = srtToVtt(text);
    return { ok: true, vtt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Misc IPC ─────────────────────────────────────────────────────
ipcMain.handle('show-in-folder',    (e, fp)   => shell.showItemInFolder(fp));
ipcMain.handle('copy-to-clipboard', (e, text) => clipboard.writeText(text));
ipcMain.handle('open-external',     (e, fp)   => shell.openPath(fp));

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.registerFileProtocol('localfile', (req, cb) => {
    cb({ path: decodeURIComponent(req.url.replace('localfile://','')) });
  });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
