'use strict';
const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, clipboard } = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');
const C      = require('./common');

nativeTheme.themeSource = 'dark';
let mainWindow = null;

// ── Open folder dialog ───────────────────────────────────────────
ipcMain.handle('open-folder-dialog', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Manga Library or Manga Folder',
    buttonLabel: 'Select Folder',
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── Library scan (worker thread, streamed, cached) ───────────────
// The scan itself lives in scan-worker.js. Running it here froze the whole
// app (and made the desktop show "not responding") on big libraries.
const IMG_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','jfif','avif']);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

let scanWorker = null;
let scanSeq = 0;

function cacheFileFor(root) {
  const key = crypto.createHash('md5').update(root).digest('hex');
  return path.join(app.getPath('userData'), 'library-cache', key + '.json');
}

async function writeJsonAsync(file, data) {
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.promises.rename(tmp, file);
  } catch (err) { console.error('cache write failed:', err.message); }
}

// Last scan result for this folder, so reopening a huge library is instant
// (a fresh scan then runs in the background and updates it).
ipcMain.handle('get-scan-cache', async (e, root) => {
  try { return JSON.parse(await fs.promises.readFile(cacheFileFor(root), 'utf8')); }
  catch { return null; }
});

ipcMain.handle('cancel-scan', () => {
  if (scanWorker) { scanWorker.terminate(); scanWorker = null; }
});

ipcMain.handle('scan-root', (e, rootPath, token) => new Promise((resolve) => {
  if (scanWorker) { scanWorker.terminate(); scanWorker = null; }   // a newer scan replaces the old one
  const seq = token || ++scanSeq;          // the renderer's own token, so it can ignore stale results
  const sender = e.sender;
  const worker = new Worker(path.join(__dirname, 'scan-worker.js'), { workerData: { root: rootPath } });
  scanWorker = worker;
  const all = [];
  let settled = false;
  const send = (channel, payload) => { if (!sender.isDestroyed()) sender.send(channel, { seq, ...payload }); };
  const finish = (result) => {
    if (settled) return; settled = true;
    if (scanWorker === worker) scanWorker = null;
    // The result goes out on the same channel as the batches, so it can never
    // overtake them (invoke replies and send() are NOT ordered relative to each other).
    if (result.mode !== 'cancelled') send('scan-done', { result });
    resolve({ ...result, seq });
  };

  worker.on('message', (msg) => {
    if (msg.type === 'batch') {
      all.push(...msg.mangas);
      send('scan-batch', { mangas: msg.mangas, done: msg.done, total: msg.total });
    } else if (msg.type === 'progress') {
      send('scan-progress', { done: msg.done, total: msg.total });
    } else if (msg.type === 'done') {
      const r = msg.result;
      if (r.mode === 'library') {
        const sig = all.length + ':' + all.reduce((n, m) => n + m.ch.length, 0);
        writeJsonAsync(cacheFileFor(rootPath), { root: rootPath, savedAt: Date.now(), sig, mangas: all });
        finish({ mode: 'library', total: all.length, sig });
      } else finish(r);
    }
  });
  worker.on('error', (err) => finish({ mode: 'error', message: err.message }));
  worker.on('exit', () => finish({ mode: 'cancelled' }));
}));

// Page list of ONE chapter folder — listed only when the chapter is opened.
ipcMain.handle('list-images', async (e, dir) => {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter(en => en.isFile() && en.name.charCodeAt(0) !== 46 && IMG_EXT.has(en.name.split('.').pop().toLowerCase()))
      .map(en => en.name)
      .sort((a, b) => collator.compare(a, b));
  } catch { return []; }
});

// Page counts for several chapter folders (parallel async reads; slow disks are latency-bound).
ipcMain.handle('count-pages', async (e, dirs) => {
  const one = async (dir) => {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      let n = 0;
      for (const en of entries) {
        if (en.isFile() && en.name.charCodeAt(0) !== 46 && IMG_EXT.has(en.name.split('.').pop().toLowerCase())) n++;
      }
      return n;
    } catch { return 0; }
  };
  const out = new Array(dirs.length);
  let next = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (next < dirs.length) { const i = next++; out[i] = await one(dirs[i]); }
  }));
  return out;
});

// ── PDF cover thumbnails ────────────────────────────────────────────
// Renders the first page of a PDF to a cached PNG so PDF-volume series
// can show a real cover instead of a generic placeholder.
// Thumbnails are rendered one at a time (a queue) so opening a library with
// many PDF series doesn't spawn dozens of hidden windows at once.
let thumbQueue = Promise.resolve();

// true when the captured bitmap has real content (not one flat colour)
function hasContent(image) {
  const { width, height } = image.getSize();
  if (!width || !height) return false;
  const bmp = image.toBitmap();                 // BGRA
  let min = 255, max = 0;
  for (let y = Math.floor(height * 0.1); y < height * 0.9; y += 7) {
    for (let x = Math.floor(width * 0.1); x < width * 0.9; x += 7) {
      const i = (y * width + x) * 4;
      const lum = (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
  }
  return max - min > 25;
}

// Fast path: poppler's pdftoppm (ships with Fedora Workstation). Reliable and
// needs no hidden browser window. Falls through to the viewer capture if absent.
function pdftoppmThumb(pdfPath, outPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const prefix = outPath.replace(/\.png$/, '');
    execFile('pdftoppm',
      ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to-x', '480', '-scale-to-y', '-1', pdfPath, prefix],
      { timeout: 20000 },
      (err) => err ? reject(err) : resolve());
  });
}

function renderPdfThumb(pdfPath, outPath) {
  return new Promise(async (resolve, reject) => {
    const thumbWin = new BrowserWindow({
      width: 480, height: 680, show: false,
      webPreferences: { plugins: true, contextIsolation: true, sandbox: true },
    });
    const kill = () => { try { thumbWin.destroy(); } catch {} };
    try {
      await thumbWin.loadURL(pathToFileURL(pdfPath).toString());
      // poll until the built-in PDF viewer has really painted the first page
      let image = null;
      for (let i = 0; i < 25; i++) {                       // up to ~10 s
        await new Promise(res => setTimeout(res, 400));
        const shot = await thumbWin.webContents.capturePage();
        if (hasContent(shot)) { image = shot; break; }
      }
      if (!image) throw new Error('PDF did not render in time (no cover cached)');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, image.resize({ width: 480 }).toPNG());
      resolve();
    } catch (err) { reject(err); }
    finally { kill(); }
  });
}

ipcMain.handle('get-pdf-thumbnail', (e, pdfPath) => {
  const job = thumbQueue.then(async () => {
    try {
      const stat = fs.statSync(pdfPath);
      const key  = crypto.createHash('md5').update(pdfPath + '::' + stat.mtimeMs).digest('hex');
      const outPath = path.join(app.getPath('userData'), 'pdf-thumbnails', key + '.png');
      if (!fs.existsSync(outPath)) {
        try { await pdftoppmThumb(pdfPath, outPath); }
        catch { await renderPdfThumb(pdfPath, outPath); }
      }
      return C.fileUrlFor(outPath);
    } catch (err) {
      console.error('get-pdf-thumbnail error:', err.message);
      return null;
    }
  });
  thumbQueue = job.catch(() => {});
  return job;
});

// ── Persistence ──────────────────────────────────────────────────
ipcMain.handle('load-progress', ()         => C.readJson(C.userFile('manga-progress.json'), {}));
ipcMain.handle('save-progress', (e, data)  => C.writeJson(C.userFile('manga-progress.json'), data));
ipcMain.handle('load-recent',   ()         => C.readJson(C.userFile('recent-paths.json'), []));
ipcMain.handle('save-recent',   (e, paths) => C.writeJson(C.userFile('recent-paths.json'), paths.slice(0, 2)));

// ── Misc ─────────────────────────────────────────────────────────
ipcMain.handle('show-in-folder',    (e, fp)   => shell.showItemInFolder(fp));
ipcMain.handle('copy-to-clipboard', (e, text) => { clipboard.writeText(String(text)); });

// ── App lifecycle ─────────────────────────────────────────────────
if (C.singleInstance(() => mainWindow)) {
  C.boot('manga-vault', () => {
    mainWindow = C.createMainWindow({ width: 1400, height: 880, minWidth: 760, minHeight: 560, plugins: true });
  });
}
