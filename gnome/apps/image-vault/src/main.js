'use strict';
const { app, ipcMain, dialog, nativeTheme, shell, clipboard } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
const C    = require('./common');
const { mediaDims } = require('./dims');
const { probeFile } = require('./probe');

nativeTheme.themeSource = 'dark';
let mainWindow = null;

const MEDIA_EXTS = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','jfif','avif','heic','heif','webm','mp4']);

// ── dialogs ──────────────────────────────────────────────────────
ipcMain.handle('open-folder-dialog', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('open-file-dialog', async () => {
  if (!mainWindow) return [];
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images & Videos', extensions: [...MEDIA_EXTS] }],
  });
  return r.canceled ? [] : r.filePaths;
});

// ── scan (worker thread: the window never freezes, progress is reported) ──
let scanWorker = null;
ipcMain.handle('scan-folder', (e, folderPath) => new Promise((resolve) => {
  if (scanWorker) { scanWorker.terminate(); scanWorker = null; }
  const w = new Worker(path.join(__dirname, 'scan-worker.js'), { workerData: { root: folderPath } });
  scanWorker = w;
  let done = false;
  const finish = (items) => { if (done) return; done = true; if (scanWorker === w) scanWorker = null; resolve(items); };
  w.on('message', (msg) => {
    if (msg.type === 'progress') { if (!e.sender.isDestroyed()) e.sender.send('scan-progress', { count: msg.count }); }
    else if (msg.type === 'done') finish(msg.items);
  });
  w.on('error', () => finish([]));
  w.on('exit', () => finish([]));
}));

ipcMain.handle('show-in-folder',    (e, p)    => shell.showItemInFolder(p));
ipcMain.handle('open-path',        (e, p)    => shell.openPath(p));        // system viewer
ipcMain.handle('probe-file',       (e, p)    => probeFile(p));              // why can't this file be shown?
ipcMain.handle('copy-to-clipboard', (e, text) => { clipboard.writeText(String(text)); });

// ── pixel sizes from file headers (no full decode of every picture) ──
ipcMain.handle('get-dims', async (e, files) => {
  const out = new Array(files.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < files.length) { const i = next++; out[i] = await mediaDims(files[i]); }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return out;
});

// ── thumbnail cache ──────────────────────────────────────────────
// The grid shows small cached thumbnails instead of decoding full-size
// photos while you scroll. Originals are only opened in the lightbox.
const THUMB_DIR = path.join(app.getPath('userData'), 'thumbs');
const thumbFile = key => path.join(THUMB_DIR, key.slice(0, 2), key + '.jpg');

ipcMain.handle('thumb-get', (e, filePath, mtime, size, width) => {
  const key = crypto.createHash('md5').update(`${filePath}|${mtime}|${size}|${width}`).digest('hex');
  const f = thumbFile(key);
  return { key, url: fs.existsSync(f) ? C.fileUrlFor(f) : null };
});

ipcMain.handle('thumb-get-many', (e, list) => list.map(([filePath, mtime, size, width]) => {
  const key = crypto.createHash('md5').update(`${filePath}|${mtime}|${size}|${width}`).digest('hex');
  const f = thumbFile(key);
  return { key, url: fs.existsSync(f) ? C.fileUrlFor(f) : null };
}));

ipcMain.handle('thumb-save', async (e, key, buf) => {
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  const f = thumbFile(key);
  try {
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    await fs.promises.writeFile(tmp, Buffer.from(buf));
    await fs.promises.rename(tmp, f);
    return C.fileUrlFor(f);
  } catch { return null; }
});

// keep the cache under ~1.5 GB (oldest first) — runs in the background at startup
async function trimThumbCache(limit = 1.5 * 1024 ** 3) {
  try {
    const files = [];
    for (const d of await fs.promises.readdir(THUMB_DIR)) {
      const dir = path.join(THUMB_DIR, d);
      for (const n of await fs.promises.readdir(dir)) {
        try { const st = await fs.promises.stat(path.join(dir, n)); files.push({ p: path.join(dir, n), s: st.size, t: st.atimeMs || st.mtimeMs }); } catch {}
      }
    }
    let total = files.reduce((n, f) => n + f.s, 0);
    if (total <= limit) return;
    files.sort((a, b) => a.t - b.t);
    for (const f of files) { if (total <= limit * 0.8) break; await fs.promises.unlink(f.p).catch(() => {}); total -= f.s; }
  } catch {}
}

// ── persistence ──────────────────────────────────────────────────
ipcMain.handle('load-favorites', ()          => C.readJson(C.userFile('favorites.json'), []));
ipcMain.handle('save-favorites', (e, favs)   => C.writeJson(C.userFile('favorites.json'), favs));
ipcMain.handle('load-recent',    ()          => C.readJson(C.userFile('recent.json'), []));
ipcMain.handle('save-recent',    (e, paths)  => C.writeJson(C.userFile('recent.json'), paths.slice(0, 2)));

// ── lifecycle ────────────────────────────────────────────────────
if (C.singleInstance(() => mainWindow)) {
  C.boot('image-vault', () => {
    mainWindow = C.createMainWindow({ width: 1440, height: 920, minWidth: 800, minHeight: 600 });
    setTimeout(trimThumbCache, 15000);
  });
}
