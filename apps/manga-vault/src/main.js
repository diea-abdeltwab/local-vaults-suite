const { app, BrowserWindow, ipcMain, dialog, protocol, nativeTheme, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

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
    // Only save bounds when not maximized — maximized bounds are wrong
    const b = maximized ? loadWinState() : mainWindow.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized }), 'utf8');
  } catch {}
}

function createWindow() {
  const ws = loadWinState();
  mainWindow = new BrowserWindow({
    width: ws.width, height: ws.height,
    x: ws.x, y: ws.y,
    minWidth: 760, minHeight: 560,
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

  // Only register once
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
    title: 'Select Manga Library or Manga Folder',
    buttonLabel: 'Select Folder',
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── Scan root ────────────────────────────────────────────────────
const IMG_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','jfif','avif']);

function extractNum(s) { const m = s.match(/\d+/); return m ? parseInt(m[0]) : 0; }

function getImages(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && IMG_EXT.has(e.name.split('.').pop().toLowerCase()))
      .map(e => {
        const fp = path.join(dir, e.name);
        try { return { filePath: fp, name: e.name, size: fs.statSync(fp).size }; }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}

function getPDFs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
      .map(e => {
        const fp = path.join(dir, e.name);
        try { return { filePath: fp, name: e.name, size: fs.statSync(fp).size }; }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}

function getDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}

// Builds ONE manga entry from a folder, combining PDF volumes AND
// image-chapter subfolders together as a single, unified chapter list —
// this is what lets a series mix PDFs and normal chapters side by side.
function scanMangaDir(dir, name) {
  const pdfs    = getPDFs(dir);
  const subDirs = getDirs(dir);
  const chapters = [];

  pdfs.forEach(pdf => chapters.push({
    name: pdf.name, path: dir,
    num: extractNum(pdf.name),
    isPDF: true, pdfPath: pdf.filePath, images: [],
  }));

  let hasImageChapterDirs = false;
  subDirs.forEach(sd => {
    const imgs = getImages(sd.path);
    if (imgs.length > 0) {
      hasImageChapterDirs = true;
      chapters.push({
        name: sd.name, path: sd.path,
        num: extractNum(sd.name),
        isPDF: false, images: imgs,
      });
    }
  });

  // Only fall back to loose images directly in `dir` when there are no
  // proper chapter subfolders — avoids double counting.
  if (!hasImageChapterDirs) {
    const directImgs = getImages(dir);
    if (directImgs.length > 0) {
      chapters.push({
        name, path: dir, num: 0,
        isPDF: false, images: directImgs,
      });
    }
  }

  chapters.sort((a, b) => a.num - b.num || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));

  const imgChapter  = chapters.find(c => !c.isPDF && c.images.length > 0);
  const coverPath   = imgChapter ? imgChapter.images[0].filePath : null;
  const isPDFManga  = chapters.length > 0 && chapters.every(c => c.isPDF);

  return { name, path: dir, chapters, coverPath, isPDFManga };
}

// A folder "looks like a manga container" if it has its own chapter
// subfolders and/or PDF volumes directly inside it.
function looksLikeMangaFolder(dirPath) {
  return getDirs(dirPath).length > 0 || getPDFs(dirPath).length > 0;
}
// A folder "looks like a plain chapter" if it just has images and no
// further structure — i.e. it IS a chapter, not a manga.
function looksLikeChapterFolder(dirPath) {
  return getImages(dirPath).length > 0 && getDirs(dirPath).length === 0;
}

ipcMain.handle('scan-root', async (e, rootPath) => {
  const subDirs  = getDirs(rootPath);
  const rootImgs = getImages(rootPath);
  const rootPDFs = getPDFs(rootPath);

  // No subfolders at all — root is either a single loose-image chapter,
  // or a single PDF-volumes manga.
  if (subDirs.length === 0) {
    if (rootImgs.length === 0 && rootPDFs.length === 0) return { mode: 'empty' };
    if (rootImgs.length > 0 && rootPDFs.length === 0) {
      return { mode: 'chapter', chapterName: path.basename(rootPath), images: rootImgs };
    }
    const manga = scanMangaDir(rootPath, path.basename(rootPath));
    if (manga.chapters.length === 0) return { mode: 'empty' };
    return { mode: 'manga', mangaName: manga.name, chapters: manga.chapters, coverPath: manga.coverPath, isPDFManga: manga.isPDFManga };
  }

  // Subfolders exist — figure out whether they're chapters of ONE manga,
  // or each one is its OWN manga (a library).
  const sample = subDirs.slice(0, Math.min(6, subDirs.length));
  let mangaLike = 0, chapterLike = 0;
  for (const sd of sample) {
    if (looksLikeMangaFolder(sd.path)) mangaLike++;
    else if (looksLikeChapterFolder(sd.path)) chapterLike++;
  }

  if (mangaLike >= chapterLike && mangaLike > 0) {
    const mangas = subDirs
      .map(sd => scanMangaDir(sd.path, sd.name))
      .filter(m => m.chapters.length > 0);
    if (mangas.length > 0) return { mode: 'library', mangas };
  }

  if (chapterLike > 0) {
    const manga = scanMangaDir(rootPath, path.basename(rootPath));
    if (manga.chapters.length > 0) {
      return { mode: 'manga', mangaName: manga.name, chapters: manga.chapters, coverPath: manga.coverPath, isPDFManga: manga.isPDFManga };
    }
  }

  // Fallback — try treating every subfolder as its own manga regardless.
  const mangas = subDirs
    .map(sd => scanMangaDir(sd.path, sd.name))
    .filter(m => m.chapters.length > 0);
  if (mangas.length > 0) return { mode: 'library', mangas };

  return { mode: 'empty' };
});

// ── PDF cover thumbnails ────────────────────────────────────────────
// Renders the first page of a PDF to a cached PNG so PDF-volume series
// can show a real cover instead of a generic placeholder.
const THUMB_DIR = path.join(app.getPath('userData'), 'pdf-thumbnails');
try { fs.mkdirSync(THUMB_DIR, { recursive: true }); } catch {}

ipcMain.handle('get-pdf-thumbnail', async (e, pdfPath) => {
  try {
    const stat = fs.statSync(pdfPath);
    const key  = crypto.createHash('md5').update(pdfPath + '::' + stat.mtimeMs).digest('hex');
    const outPath = path.join(THUMB_DIR, key + '.png');
    if (fs.existsSync(outPath)) return 'localfile://' + outPath;

    const thumbWin = new BrowserWindow({
      width: 480, height: 680, show: false,
      webPreferences: { plugins: true, contextIsolation: true, sandbox: false },
    });

    try {
      await thumbWin.loadURL('file://' + encodeURI(pdfPath).replace(/#/g, '%23'));
      // Give the built-in PDF viewer a moment to actually paint the page
      await new Promise(res => setTimeout(res, 700));
      const image   = await thumbWin.webContents.capturePage();
      const resized = image.resize({ width: 480 });
      fs.writeFileSync(outPath, resized.toPNG());
    } finally {
      thumbWin.destroy();
    }
    return 'localfile://' + outPath;
  } catch (err) {
    console.error('get-pdf-thumbnail error:', err);
    return null;
  }
});

// ── Persistence ──────────────────────────────────────────────────
const PROGRESS_FILE = path.join(app.getPath('userData'), 'manga-progress.json');
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

// ── Misc ─────────────────────────────────────────────────────────
ipcMain.handle('show-in-folder', (e, fp) => shell.showItemInFolder(fp));
ipcMain.handle('copy-to-clipboard', (e, text) => require('electron').clipboard.writeText(text));

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.registerFileProtocol('localfile', (req, cb) => {
    cb({ path: decodeURIComponent(req.url.replace('localfile://', '')) });
  });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
