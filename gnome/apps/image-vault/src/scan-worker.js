'use strict';
// Folder scan for Image Vault, run in a worker thread so the window never
// freezes while a big library is being listed. Reports progress as it goes.
const { parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');

const MEDIA = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','jfif','avif','heic','heif','webm','mp4']);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const results = [];
let lastReport = Date.now();

function scanDir(dir, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const n = e.name;
    if (n.charCodeAt(0) === 46) continue;                       // hidden / "._x.jpg" junk
    const full = path.join(dir, n);
    if (e.isDirectory()) { scanDir(full, depth + 1); continue; }
    if (!e.isFile()) continue;
    const dot = n.lastIndexOf('.');
    if (dot < 0) continue;
    const ext = n.slice(dot + 1).toLowerCase();
    if (!MEDIA.has(ext)) continue;
    try {
      const st = fs.statSync(full);
      results.push({ filePath: full, name: n, size: st.size, mtime: st.mtimeMs, ext, isVideo: ext === 'webm' || ext === 'mp4' });
    } catch {}
    if (Date.now() - lastReport > 250) {
      lastReport = Date.now();
      parentPort.postMessage({ type: 'progress', count: results.length });
    }
  }
}

try {
  scanDir(workerData.root, 0);
  results.sort((a, b) => collator.compare(a.name, b.name));
  parentPort.postMessage({ type: 'done', items: results });
} catch (err) {
  parentPort.postMessage({ type: 'done', items: [], error: String(err && err.message || err) });
}
