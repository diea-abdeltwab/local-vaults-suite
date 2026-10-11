const { app, BrowserWindow, ipcMain, dialog, protocol, nativeTheme, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

nativeTheme.themeSource = 'dark';
let mainWindow;

// ── GPU / codec / quality flags ──────────────────────────────────
// Must be called before app is ready
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-video-encode');
app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-gl', 'desktop');
// Audio quality
app.commandLine.appendSwitch('audio-buffer-size', '2048');
// VA-API hardware decoding — Intel/AMD on Linux
app.commandLine.appendSwitch('enable-features', [
  'PlatformHEVCDecoderSupport',   // H.265/HEVC
  'VaapiVideoDecodeLinuxGL',       // VA-API + OpenGL
  'VaapiVideoDecoder',             // VA-API decoder
  'VaapiVideoEncoder',             // VA-API encoder
  'VaapiIgnoreDriverChecks',       // ignore old driver warnings
  'UseMultiPlaneFormatForHardwareVideo', // better HW video format
  'CanvasOopRasterization',        // GPU canvas rasterization
  'EnableDrDc',                    // Display compositor on GPU thread
].join(','));
app.commandLine.appendSwitch('disable-features', [
  'UseChromeOSDirectVideoDecoder', // conflicts with VA-API on desktop Linux
].join(','));
// Correct color profile — sRGB is right for standard monitors
// display-p3 causes color shift on non-P3 displays
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
    backgroundColor: '#000000',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      zoomFactor: 1.0,
      backgroundThrottling: false,   // no throttling when window not focused
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
    title: 'Select Your Movies / Series / Anime Library',
    buttonLabel: 'Select Folder',
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── Video / subtitle / image extensions ─────────────────────────
const VIDEO_EXT = new Set([
  'mp4','mkv','avi','mov','wmv','flv','webm','m4v',
  'ts','m2ts','mpg','mpeg','3gp','ogv','rmvb','vob'
]);
const SUB_EXT   = new Set(['srt','ass','ssa','vtt','sub','idx','sup']);
const IMG_EXT   = new Set(['jpg','jpeg','png','gif','webp','bmp','avif']);

function getExt(name) { return name.split('.').pop().toLowerCase(); }
function isVideo(name) { return VIDEO_EXT.has(getExt(name)); }
function isSub(name)   { return SUB_EXT.has(getExt(name)); }
function isImage(name) { return IMG_EXT.has(getExt(name)); }

// Return subtitle files in the same dir as a video, PLUS any Subs/ subfolder
function getSubtitles(dir) {
  try {
    let subs = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && isSub(e.name))
      .map(e => ({ name: e.name, filePath: path.join(dir, e.name), ext: getExt(e.name) }));

    // Also scan common subs subdirectories
    const subDirNames = ['Subs','Subs.','Subtitles','subs','subtitles'];
    for (const sd of subDirNames) {
      const subDir = path.join(dir, sd);
      try {
        const extra = fs.readdirSync(subDir, { withFileTypes: true })
          .filter(e => e.isFile() && isSub(e.name))
          .map(e => ({ name: e.name, filePath: path.join(subDir, e.name), ext: getExt(e.name) }));
        subs = subs.concat(extra);
      } catch {}
    }

    return subs.sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}

// Get the first image found in a directory (for episode poster)
function getFirstImage(dir) {
  try {
    const f = fs.readdirSync(dir, { withFileTypes: true })
      .find(e => e.isFile() && isImage(e.name));
    return f ? path.join(dir, f.name) : null;
  } catch { return null; }
}

function extractNum(s) {
  // Try to find episode/season number patterns: S01E02, E02, 2x05, or plain number
  const ep  = s.match(/[Ee](\d{1,3})/);  if (ep)  return parseInt(ep[1]);
  const num = s.match(/\d+/);             if (num) return parseInt(num[0]);
  return 0;
}

// ── Helpers ──────────────────────────────────────────────────────
function getDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
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
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}

function getImages(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && isImage(e.name))
      .map(e => path.join(dir, e.name))
      .sort();
  } catch { return []; }
}

// Find best poster/cover image in a directory
function findPoster(dir) {
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    // Priority: poster.*, cover.*, folder.*, thumb.*, fanart.* then any image
    const priority = ['poster','cover','folder','thumb','fanart','backdrop'];
    for (const pname of priority) {
      const match = files.find(f =>
        f.isFile() && isImage(f.name) &&
        f.name.toLowerCase().startsWith(pname)
      );
      if (match) return path.join(dir, match.name);
    }
    // Fall back to any image
    const any = files.find(f => f.isFile() && isImage(f.name));
    if (any) return path.join(dir, any.name);
  } catch {}
  return null;
}

// ── SCAN ROOT ────────────────────────────────────────────────────
// Strategy: recursively walk the tree.
// A "video dir" is any directory that contains ≥1 video file directly.
// We collect all video dirs, attach subtitles found in the same dir,
// then figure out the hierarchy (library vs single title).
//
// Subtitle matching: any .srt/.ass/.vtt/.sub in the same folder as the
// video is attached to every video in that folder (user picks at runtime).

// Deep-collect all video files under a root, preserving dir structure.
// Returns [{filePath, name, size, dir, dirName, depth}]
function collectAllVideos(root, maxDepth = 6) {
  const results = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    const vids = getVideos(dir);
    vids.forEach(v => results.push({ ...v, dir, dirName: path.basename(dir), depth }));
    getDirs(dir).forEach(sub => walk(sub.path, depth + 1));
  }
  walk(root, 0);
  return results;
}

// Build an episode object from a video file
function makeEp(v, seasonLabel) {
  return {
    name:       v.name,
    filePath:   v.filePath,
    dir:        v.dir,
    dirName:    v.dirName || path.basename(v.dir),   // ← subfolder name = episode label
    num:        extractNum(v.name),
    size:       v.size,
    season:     seasonLabel || null,
    subtitles:  getSubtitles(v.dir),
    epPoster:   getFirstImage(v.dir),                // ← image from same subfolder
  };
}

ipcMain.handle('scan-root', async (e, rootPath) => {
  const poster   = findPoster(rootPath);
  const rootVids = getVideos(rootPath);
  const subDirs  = getDirs(rootPath);

  // ── Case F: videos directly in root → single title
  if (rootVids.length > 0 && subDirs.length === 0) {
    const episodes = rootVids.map(v => makeEp({ ...v, dir: rootPath }, null));
    return {
      mode: 'title',
      titleName: path.basename(rootPath),
      posterPath: poster,
      type: episodes.length === 1 ? 'movie' : 'series',
      episodes,
      seasons: [],
    };
  }

  if (subDirs.length === 0) return { mode: 'empty' };

  // Collect ALL videos in the tree
  const allVids = collectAllVideos(rootPath);
  if (allVids.length === 0) return { mode: 'empty' };

  // ── Depth-0 vids = videos directly in rootPath
  const depth0 = allVids.filter(v => v.dir === rootPath);
  // ── Depth-1 vids = videos inside immediate subdirs
  const depth1Dirs = new Set(subDirs.map(d => d.path));
  const depth1 = allVids.filter(v => depth1Dirs.has(v.dir));

  // ── Heuristic: is this a LIBRARY (multiple titles) or a SINGLE TITLE?
  // Library: immediate subdirs are titles (movies or series)
  // Single title: root itself is the show/movie

  // Count how many immediate subdirs contain videos (at any depth)
  const subDirVideoCount = subDirs.filter(d => {
    return allVids.some(v => v.dir.startsWith(d.path));
  }).length;

  // If only 1 subdir has videos and it's not a season-named dir → probably library of 1
  // If most subdirs are "Season X" style → single title with seasons
  const seasonNamedCount = subDirs.filter(d => {
    const l = d.name.toLowerCase();
    return l.startsWith('season') || l.startsWith('s0') || l.startsWith('s1') ||
           l.startsWith('serie') || /^s\d{1,2}$/i.test(d.name);
  }).length;

  const isSeasonStructure = seasonNamedCount >= subDirs.length * 0.5;

  // ── SINGLE TITLE with seasons ─────────────────────────────────
  if (isSeasonStructure) {
    const episodes = [];
    subDirs.forEach(seasonDir => {
      // videos at any depth under this season dir
      allVids.filter(v => v.dir.startsWith(seasonDir.path))
        .forEach(v => episodes.push(makeEp(v, seasonDir.name)));
    });
    depth0.forEach(v => episodes.push(makeEp(v, null)));
    if (episodes.length > 0) {
      return {
        mode: 'title',
        titleName: path.basename(rootPath),
        posterPath: poster,
        type: 'series',
        episodes,
        seasons: [...new Set(episodes.map(e => e.season).filter(Boolean))],
      };
    }
  }

  // ── LIBRARY detection ────────────────────────────────────────
  // Each immediate subdir = one title (movie or series)
  const titlesFromSubDirs = subDirs.map(titleDir => {
    const titleVids = allVids.filter(v => v.dir.startsWith(titleDir.path));
    if (titleVids.length === 0) return null;

    // Sub-subdirs of this title = potential seasons
    const titleSubDirs = getDirs(titleDir.path);
    const titleSeasonDirs = titleSubDirs.filter(d => {
      const l = d.name.toLowerCase();
      return l.startsWith('season') || l.startsWith('s0') || l.startsWith('s1') ||
             l.startsWith('serie') || /^s\d{1,2}$/i.test(d.name);
    });

    let episodes = [];
    let seasons  = [];

    if (titleSeasonDirs.length > 0) {
      // Has seasons
      titleSeasonDirs.forEach(sd => {
        allVids.filter(v => v.dir.startsWith(sd.path))
          .forEach(v => episodes.push(makeEp(v, sd.name)));
      });
      // Also grab flat vids directly in titleDir
      titleVids.filter(v => v.dir === titleDir.path)
        .forEach(v => episodes.push(makeEp(v, null)));
      seasons = [...new Set(episodes.map(e => e.season).filter(Boolean))];
    } else if (titleSubDirs.length > 0) {
      // Has subdirs but not season-named → treat each subdir as a group/season
      titleSubDirs.forEach(sd => {
        allVids.filter(v => v.dir.startsWith(sd.path))
          .forEach(v => episodes.push(makeEp(v, sd.name)));
      });
      titleVids.filter(v => v.dir === titleDir.path)
        .forEach(v => episodes.push(makeEp(v, null)));
      seasons = [...new Set(episodes.map(e => e.season).filter(Boolean))];
    } else {
      // Flat — videos directly in titleDir
      titleVids.forEach(v => episodes.push(makeEp(v, null)));
    }

    if (episodes.length === 0) return null;

    const isMovie = episodes.length === 1 ||
      (titleVids.length <= 2 && seasons.length === 0);

    // For movies, pick the largest file as the main video
    if (isMovie) {
      episodes = [episodes.reduce((a,b) => (a.size||0) > (b.size||0) ? a : b)];
      episodes[0].num = 1;
    }

    return {
      name: titleDir.name,
      path: titleDir.path,
      posterPath: findPoster(titleDir.path) || poster,
      type: isMovie ? 'movie' : 'series',
      episodes,
      seasons,
    };
  }).filter(Boolean);

  if (titlesFromSubDirs.length > 0) return { mode: 'library', titles: titlesFromSubDirs };

  // ── Fallback: treat root as single flat title ─────────────────
  if (allVids.length > 0) {
    const episodes = allVids.map(v => {
      // Use relative path from root as season label when nested
      const rel = path.relative(rootPath, v.dir);
      const season = rel && rel !== '.' ? rel : null;
      return makeEp(v, season);
    });
    return {
      mode: 'title',
      titleName: path.basename(rootPath),
      posterPath: poster,
      type: episodes.length === 1 ? 'movie' : 'series',
      episodes,
      seasons: [...new Set(episodes.map(e => e.season).filter(Boolean))],
    };
  }

  return { mode: 'empty' };
});

// ── Persistence ──────────────────────────────────────────────────
const PROGRESS_FILE = path.join(app.getPath('userData'), 'cinema-progress.json');
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
  try { fs.writeFileSync(RECENT_FILE, JSON.stringify(paths.slice(0,3)), 'utf8'); }
  catch {}
});

// ── Misc ─────────────────────────────────────────────────────────
ipcMain.handle('show-in-folder', (e, fp) => shell.showItemInFolder(fp));
ipcMain.handle('copy-to-clipboard', (e, text) => require('electron').clipboard.writeText(text));
ipcMain.handle('open-external', (e, fp) => shell.openPath(fp));

// ── External player launcher ─────────────────────────────────────
// Tries mpv → vlc → xdg-open in order. Returns {player, pid} or {error}.
const { spawn } = require('child_process');
ipcMain.handle('launch-external', (e, { filePath, subPath }) => {
  return new Promise(resolve => {
    // Build mpv args
    const mpvArgs = ['--fs', '--keep-open=yes'];
    if (subPath) mpvArgs.push(`--sub-file=${subPath}`);
    mpvArgs.push(filePath);

    // Try mpv first
    const mpv = spawn('mpv', mpvArgs, { detached: true, stdio: 'ignore' });
    mpv.on('error', () => {
      // mpv not found → try vlc
      const vlcArgs = ['--fullscreen'];
      if (subPath) vlcArgs.push(`--sub-file=${subPath}`);
      vlcArgs.push(filePath);
      const vlc = spawn('vlc', vlcArgs, { detached: true, stdio: 'ignore' });
      vlc.on('error', () => {
        // vlc not found → xdg-open (no sub support)
        const xdg = spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' });
        xdg.on('error', err => resolve({ error: err.message }));
        xdg.on('spawn', () => { xdg.unref(); resolve({ player: 'xdg-open', pid: xdg.pid }); });
      });
      vlc.on('spawn', () => { vlc.unref(); resolve({ player: 'vlc', pid: vlc.pid }); });
    });
    mpv.on('spawn', () => { mpv.unref(); resolve({ player: 'mpv', pid: mpv.pid }); });
  });
});

// ── Subtitle → VTT converter ──────────────────────────────────────
// Converts .srt / .ass / .ssa to a data: URI VTT string so Chromium
// can render it natively without touching the original files.
ipcMain.handle('subtitle-to-vtt', (e, filePath) => {
  try {
    // Read as buffer first to handle BOM and encoding issues
    const buf = fs.readFileSync(filePath);
    // Strip UTF-8 BOM if present
    const hasBOM = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    // Try UTF-8 first; if replacement chars appear, it might be Windows-1256
    let raw = buf.slice(hasBOM ? 3 : 0).toString('utf8');
    // Heuristic: if many replacement chars (U+FFFD) → try latin1 (best we can do without iconv)
    if ((raw.match(/\ufffd/g) || []).length > 5) {
      raw = buf.slice(hasBOM ? 3 : 0).toString('latin1');
    }
    const ext = filePath.split('.').pop().toLowerCase();

    if (ext === 'vtt') {
      // Already VTT — return as data URI
      return 'data:text/vtt;charset=utf-8,' + encodeURIComponent(raw);
    }

    if (ext === 'srt') {
      // SRT → VTT
      let vtt = 'WEBVTT\n\n';
      const blocks = raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split(/\n\n+/);
      for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;
        // Skip the numeric index line
        let i = 0;
        if (/^\d+$/.test(lines[0].trim())) i = 1;
        if (i >= lines.length) continue;
        // Time line: 00:00:01,000 --> 00:00:04,000
        const timeLine = lines[i].replace(/,/g, '.');
        if (!timeLine.includes('-->')) continue;
        const text = lines.slice(i + 1).join('\n')
          // Strip ASS-style tags
          .replace(/\{[^}]*\}/g, '')
          // Strip HTML-ish tags except <i><b><u>
          .replace(/<(?!\/?[ibu]>)[^>]*>/gi, '');
        vtt += timeLine + '\n' + text + '\n\n';
      }
      return 'data:text/vtt;charset=utf-8,' + encodeURIComponent(vtt);
    }

    if (ext === 'ass' || ext === 'ssa') {
      // ASS/SSA → VTT
      let vtt = 'WEBVTT\n\n';
      const lines = raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
      // Find [Events] section and Dialogue lines
      // Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      let formatCols = null;
      for (const line of lines) {
        if (line.startsWith('Format:') && !formatCols) {
          formatCols = line.replace('Format:','').split(',').map(s => s.trim().toLowerCase());
        }
        if (!line.startsWith('Dialogue:')) continue;
        const parts = line.replace('Dialogue:','').split(',');
        if (!formatCols || parts.length < formatCols.length) continue;
        const si = formatCols.indexOf('start');
        const ei = formatCols.indexOf('end');
        const ti = formatCols.indexOf('text');
        if (si < 0 || ei < 0 || ti < 0) continue;
        const start = assTime(parts[si].trim());
        const end   = assTime(parts[ei].trim());
        // text may contain commas — rejoin remaining parts
        const rawText = parts.slice(ti).join(',')
          .replace(/\{[^}]*\}/g,'')   // remove ASS tags like {\an8}
          .replace(/\\N/g,'\n')
          .replace(/\\n/g,'\n')
          .trim();
        if (!rawText) continue;
        vtt += `${start} --> ${end}\n${rawText}\n\n`;
      }
      return 'data:text/vtt;charset=utf-8,' + encodeURIComponent(vtt);
    }

    return null; // unsupported format
  } catch (err) {
    console.error('subtitle-to-vtt error:', err);
    return null;
  }
});

function assTime(t) {
  // ASS time: H:MM:SS.cc  →  VTT: HH:MM:SS.mmm
  const m = t.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  if (!m) return '00:00:00.000';
  const h = m[1].padStart(2,'0');
  const mm = m[2]; const ss = m[3];
  const ms = (parseInt(m[4]) * 10).toString().padStart(3,'0');
  return `${h}:${mm}:${ss}.${ms}`;
}

// ── App lifecycle ──────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.registerFileProtocol('localfile', (req, cb) => {
    cb({ path: decodeURIComponent(req.url.replace('localfile://', '')) });
  });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
