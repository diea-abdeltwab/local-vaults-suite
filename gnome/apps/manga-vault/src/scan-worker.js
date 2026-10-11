'use strict';
// ═══════════════════════════════════════════════════════════════
//  Library scanner — runs in a worker thread so the Electron main
//  process (which owns the window) is NEVER blocked. If the main
//  process stops answering, the desktop shows "App is not responding".
//
//  FAST by design (slow / network / NTFS disks are latency-bound):
//   • a series costs only TWO directory reads: its own folder, plus the
//     first chapter folder to find a cover. Chapter folders are NOT opened
//     one by one (the old scan opened every chapter of every series).
//   • many series are read in parallel (a pool of async reads).
//   • results are streamed to the UI in alphabetical order as they arrive.
//   • chapter folders are checked for pages only when a series is opened.
//
//  chapter tuple = [name, kind]   kind: 0 image folder · 1 PDF · 2 loose images in the series folder
// ═══════════════════════════════════════════════════════════════
const { parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const fsp  = fs.promises;

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'jfif', 'avif']);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(a, b);
const POOL = 24;                                           // series scanned in parallel

const baseName = n => n.slice(n.lastIndexOf('/') + 1);
function extractNum(s) { const m = baseName(s).match(/\d+/); return m ? parseInt(m[0], 10) : 0; }

// folders that usually hold PDF volumes ("PDF", "Volumes", "Tomes"…) are always looked into
const PDF_DIR = /^(pdfs?|volumes?|vols?|tomes?|books?|tankobons?|tankoubons?|collected|pdf volumes?)$/i;
// PDFs that live inside a sub-folder become volumes named "<folder>/<file>.pdf"
const pdfChapters = (dirName, sub) => sub.pdfs.map(p => ({ name: dirName + '/' + p, kind: 1, num: extractNum(p) }));

async function readDir(dir) {
  const out = { dirs: [], images: [], pdfs: [] };
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const n = e.name;
    if (n.charCodeAt(0) === 46) continue;                  // hidden files / macOS "._x.jpg" junk
    if (e.isDirectory()) { out.dirs.push(n); continue; }
    if (!e.isFile()) continue;
    const dot = n.lastIndexOf('.');
    if (dot < 0) continue;
    const ext = n.slice(dot + 1).toLowerCase();
    if (ext === 'pdf') out.pdfs.push(n);
    else if (IMG_EXT.has(ext)) out.images.push(n);
  }
  return out;
}

function firstOf(names) {                                  // smallest in natural order, no full sort
  let best = null;
  for (const n of names) if (best === null || byName(n, best) < 0) best = n;
  return best;
}

// One series entry. `top` can be passed when its folder was already read.
async function scanSeriesDir(dir, name, top) {
  top = top || await readDir(dir);
  const chapters = [];                                     // { name, kind, num }
  for (const p of top.pdfs) chapters.push({ name: p, kind: 1, num: extractNum(p) });
  for (const d of top.dirs) chapters.push({ name: d, kind: 0, num: extractNum(d) });

  let coverPath = null;
  if (chapters.length === 0 && top.images.length > 0) {    // one-shot: loose images right in the folder
    chapters.push({ name, kind: 2, num: 0 });
    coverPath = path.join(dir, firstOf(top.images));
  } else {
    // Folders named like "PDF"/"Volumes" are opened: their PDFs become volumes of this series
    // (a series can mix image chapters AND PDF volumes, side by side or in a sub-folder).
    for (const c of chapters.slice()) {
      if (c.kind === 0 && PDF_DIR.test(c.name)) {
        const sub = await readDir(path.join(dir, c.name));
        if (sub.pdfs.length) {
          chapters.push(...pdfChapters(c.name, sub));
          if (!sub.images.length) chapters.splice(chapters.indexOf(c), 1);
        }
      }
    }
    chapters.sort((a, b) => a.num - b.num || byName(a.name, b.name));
    // cover = first page of the first image chapter (try a few folders in case the first is empty)
    let tries = 0;
    for (const c of chapters) {
      if (c.kind !== 0) continue;
      if (++tries > 3) break;
      const sub = await readDir(path.join(dir, c.name));
      if (sub.images.length) { coverPath = path.join(dir, c.name, firstOf(sub.images)); break; }
      if (sub.pdfs.length) {                                 // a folder of PDFs under another name
        chapters.push(...pdfChapters(c.name, sub));
        chapters.splice(chapters.indexOf(c), 1);
      }
    }
    chapters.sort((a, b) => a.num - b.num || byName(a.name, b.name));
    if (!coverPath && chapters.some(c => c.kind === 0)) {
      // Unusual layout (first folders hold no images — nested categories, "extras" first,
      // PDFs in a folder with another name…): check every folder, like the original scanner did.
      const keep = [];
      for (const c of chapters) {
        if (c.kind === 1) { keep.push(c); continue; }
        const sub = await readDir(path.join(dir, c.name));
        if (sub.images.length) { keep.push(c); if (!coverPath) coverPath = path.join(dir, c.name, firstOf(sub.images)); }
        else if (sub.pdfs.length) keep.push(...pdfChapters(c.name, sub));
      }
      chapters.length = 0; chapters.push(...keep);
      chapters.sort((a, b) => a.num - b.num || byName(a.name, b.name));
      if (!chapters.some(c => c.kind === 0 || c.kind === 1) && top.images.length) {   // loose images, as before
        chapters.push({ name, kind: 2, num: 0 });
        coverPath = path.join(dir, firstOf(top.images));
      }
    }
    if (!coverPath && top.images.length) coverPath = path.join(dir, firstOf(top.images));   // e.g. cover.jpg next to PDFs
  }

  return {
    name, path: dir,
    ch: chapters.map(c => [c.name, c.kind]),
    coverPath,
    isPDFManga: chapters.length > 0 && chapters.every(c => c.kind === 1),
  };
}

// ── streaming, in order ──────────────────────────────────────────
let batch = [], lastFlush = Date.now(), emitted = 0;
function flush(done, total) {
  if (!batch.length) return;
  parentPort.postMessage({ type: 'batch', mangas: batch, done, total });
  batch = []; lastFlush = Date.now();
}

async function scanLibrary(root, dirNames) {
  const total = dirNames.length;
  const slots = new Array(total);                          // finished series, by index
  let started = 0, finished = 0, nextEmit = 0, count = 0;

  const emitReady = () => {
    while (nextEmit < total && slots[nextEmit] !== undefined) {
      const m = slots[nextEmit]; slots[nextEmit] = null; nextEmit++;
      if (m && m.ch.length > 0) { batch.push(m); count++; emitted++; }
    }
    if (batch.length >= 40 || (batch.length && Date.now() - lastFlush > 150)) flush(nextEmit, total);
    else parentPort.postMessage({ type: 'progress', done: nextEmit, total });
  };

  const worker = async () => {
    while (started < total) {
      const i = started++;
      let m = null;
      try { m = await scanSeriesDir(path.join(root, dirNames[i]), dirNames[i]); } catch {}
      slots[i] = m; finished++;
      emitReady();
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, total) }, worker));
  emitReady(); flush(total, total);
  return count;
}

// ── mode detection ───────────────────────────────────────────────
async function run(root) {
  const top = await readDir(root);
  top.dirs.sort(byName);

  if (top.dirs.length === 0) {
    if (top.images.length === 0 && top.pdfs.length === 0) return { mode: 'empty' };
    if (top.images.length > 0 && top.pdfs.length === 0) {
      return { mode: 'chapter', chapterName: path.basename(root), cover: path.join(root, firstOf(top.images)) };
    }
    const m = await scanSeriesDir(root, path.basename(root), top);
    if (m.ch.length === 0) return { mode: 'empty' };
    return { mode: 'manga', manga: m };
  }

  // is the root ONE manga (its subfolders are chapters) or a library (each subfolder is a manga)?
  const sample = await Promise.all(top.dirs.slice(0, 6).map(d => readDir(path.join(root, d))));
  let mangaLike = 0, chapterLike = 0;
  for (const s of sample) {
    if (s.dirs.length > 0 || s.pdfs.length > 0) mangaLike++;
    else if (s.images.length > 0) chapterLike++;
  }

  let triedLibrary = false;
  if (mangaLike >= chapterLike && mangaLike > 0) {
    triedLibrary = true;
    if (await scanLibrary(root, top.dirs) > 0) return { mode: 'library', total: emitted };
  }
  if (chapterLike > 0) {
    const m = await scanSeriesDir(root, path.basename(root), top);
    if (m.ch.length > 0) return { mode: 'manga', manga: m };
  }
  if (!triedLibrary && await scanLibrary(root, top.dirs) > 0) return { mode: 'library', total: emitted };
  return { mode: 'empty' };
}

run(workerData.root)
  .then(result => parentPort.postMessage({ type: 'done', result }))
  .catch(err => parentPort.postMessage({ type: 'done', result: { mode: 'error', message: String(err && err.message || err) } }));
