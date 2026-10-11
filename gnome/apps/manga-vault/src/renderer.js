// ════════════════════════════════════════════════════════════
// Manga Vault — Renderer Process
// ════════════════════════════════════════════════════════════

// ── STATE ─────────────────────────────────────────────────────────
const ST = {
  mode: null,
  library: [],
  curManga: null,
  curChapKey: null,
  progress: {},
  lastChap: {},
  recentPaths: [],   // max 2 entries [{path, name, ts}]
  htimer: null,
  lbZoomed: false,
  pdfThumbCache: {},   // pdfPath -> localfile:// thumbnail url
  scanToken: 0,        // bumped on every new scan / reset → stale results are ignored
  scanCtx: null,       // { token, incoming, uiStarted, fromCache, cached }
  readToken: 0,        // same idea for the chapter reader
};

// ── DOM ───────────────────────────────────────────────────────────
const G = id => document.getElementById(id);

// Absolute path -> file:// URL with every segment encoded, so folder/file
// names containing  #  ?  %  or spaces still load correctly.
function fileUrl(p) { return 'file://' + p.split('/').map(encodeURIComponent).join('/'); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── SCREENS ───────────────────────────────────────────────────────
function showScreen(name) {
  ['S-lib','S-chap','S-read'].forEach(id =>
    G(id).classList.toggle('vis', id === name)
  );
  const inLib = name === 'S-lib';
  G('searchBar').style.display = inLib ? '' : 'none';
  G('sortSel').style.display   = inLib ? '' : 'none';
  G('tb-change').style.display = name  ? '' : 'none';
  G('counter').style.display   = inLib ? '' : 'none';
}

// ── TOAST ─────────────────────────────────────────────────────────
let toastT;
function showToast(msg, ms = 2200) {
  const t = G('toast'); t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}

// ── LOADING ───────────────────────────────────────────────────────
function showLoad(msg) {
  G('dzMain').style.display    = 'none';
  G('loadState').style.display = 'block';
  G('loadMsg').textContent     = msg || 'Loading…';
  G('progFill').style.width    = '5%';
}
function setLoad(pct) { G('progFill').style.width = pct + '%'; }
function hideLoad() {
  G('dzMain').style.display    = '';
  G('loadState').style.display = 'none';
  G('welcome').classList.add('hidden');
}
function cancelLoad(msg) {
  G('dzMain').style.display    = '';
  G('loadState').style.display = 'none';
  G('welcome').classList.remove('hidden');
  if (msg) showToast(msg);
}

// ── RECENT PATHS ─────────────────────────────────────────────────
async function loadAndRenderRecent() {
  try {
    ST.recentPaths = await window.api.loadRecent() || [];
  } catch { ST.recentPaths = []; }
  renderRecent();
}

function renderRecent() {
  const wrap = G('recentPaths');
  wrap.innerHTML = '';
  if (!ST.recentPaths.length) return;
  ST.recentPaths.forEach(r => {
    const el = document.createElement('div');
    el.className = 'recent-item';
    el.innerHTML = `
      <span class="recent-icon">📁</span>
      <div class="recent-info">
        <div class="recent-name">${esc(r.name)}</div>
        <div class="recent-path">${esc(r.path)}</div>
      </div>
      <span class="recent-arrow">→</span>`;
    el.onclick = () => processPath(r.path);
    wrap.appendChild(el);
  });
}

function addToRecent(folderPath) {
  const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
  // remove if already exists
  ST.recentPaths = ST.recentPaths.filter(r => r.path !== folderPath);
  // add to front
  ST.recentPaths.unshift({ path: folderPath, name, ts: Date.now() });
  // keep only 2
  ST.recentPaths = ST.recentPaths.slice(0, 2);
  window.api.saveRecent(ST.recentPaths).catch(console.error);
}

// ── WINDOW CONTROLS ───────────────────────────────────────────────
G('wc').onclick  = () => window.api.winClose();
G('wm').onclick  = () => window.api.winMin();
G('wx').onclick  = () => window.api.winMax();
G('tb-fs').onclick     = () => window.api.winFs();
G('tb-change').onclick = reset;

// ── OPEN FOLDER ───────────────────────────────────────────────────
G('openBtn').onclick = openFolderDialog;

async function openFolderDialog() {
  try {
    const p = await window.api.openFolder();
    if (p) processPath(p);
  } catch (err) {
    console.error('openFolder error:', err);
    showToast('⚠ Could not open folder: ' + err.message);
  }
}

// Drag & drop
const dz = G('dropzone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', async e => {
  e.preventDefault(); dz.classList.remove('over');
  const files = Array.from(e.dataTransfer.files || []);
  for (const f of files) { const fp = window.api.pathForFile(f); if (fp) { processPath(fp); return; } }
  showToast('⚠ Drop a folder, not a file');
});

// ── PROCESS PATH ─────────────────────────────────────────────────
// Compact series from the scanner → renderer object. `ch` = [[name, kind], …]
//   kind 0 image folder · 1 PDF volume · 2 loose images inside the series folder
// `chapters` (full objects) is only built when a series is actually opened.
const baseName = n => n.slice(n.lastIndexOf('/') + 1);

// A series can have image chapters AND PDF volumes. Keep them in two groups
// (each in numeric order) so prev/next walks through one group, then the other.
// Which group comes first is your choice (button in the chapter list, remembered).
function volumesFirst() { try { return localStorage.getItem('mv.volumesFirst') === '1'; } catch { return false; } }
function groupChapters(list) {
  const imgs = list.filter(c => !c.isPDF), pdfs = list.filter(c => c.isPDF);
  const cmp = (a, b) => a.num - b.num || a.name.localeCompare(b.name, 'en', { numeric: true });
  imgs.sort(cmp); pdfs.sort(cmp);
  return volumesFirst() ? [...pdfs, ...imgs] : [...imgs, ...pdfs];
}

function hydrate(m) {
  let cache = null;
  Object.defineProperty(m, 'chapters', {
    enumerable: false, configurable: true,
    set(v) { cache = v; },
    get() { return cache || (cache = groupChapters(m.ch.map(([name, kind]) =>
      kind === 1 ? { name, path: m.path, num: extractNum(baseName(name)), isPDF: true,  pdfPath: m.path + '/' + name }
    : kind === 2 ? { name, path: m.path, num: 0,                 isPDF: false }
    :              { name, path: m.path + '/' + name, num: extractNum(name), isPDF: false }))); },
  });
  return m;
}

function onScanBatch(d) {
  const ctx = ST.scanCtx;
  if (!ctx || d.seq !== ctx.token) return;
  ctx.incoming.push(...d.mangas);
  if (ctx.fromCache) return;                       // cached view is already on screen; swap when the scan ends
  if (!ctx.uiStarted) {                            // first results → show the library right away
    ctx.uiStarted = true;
    ST.mode = 'library'; ST.library = [];
    hideLoad(); showScreen('S-lib'); G('mangaGrid').innerHTML = '';
  }
  const fresh = d.mangas.map(hydrate);
  ST.library.push(...fresh);
  appendCards(fresh);
  scanLabel(d.done, d.total);
}

function onScanProgress(d) {
  const ctx = ST.scanCtx;
  if (!ctx || d.seq !== ctx.token) return;
  if (!ctx.uiStarted) {
    setLoad(10 + Math.round(80 * d.done / Math.max(1, d.total)));
    G('loadMsg').textContent = `Scanning… ${d.done} / ${d.total}`;
  } else scanLabel(d.done, d.total);
}

function scanLabel(done, total) {
  if (!ST.scanCtx || !ST.scanCtx.scanning) return;
  G('libLabel').textContent = `${ST.library.length} Series · scanning ${done}/${total}…`;
  G('counter').textContent  = ST.library.length + ' manga';
}

window.api.onScanBatch(onScanBatch);
window.api.onScanProgress(onScanProgress);

async function processPath(rootPath) {
  const token = ++ST.scanToken;
  const ctx = ST.scanCtx = { token, incoming: [], uiStarted: false, fromCache: false, cached: null, scanning: true };
  showLoad('Scanning folder structure…');
  setLoad(8);

  try { ST.progress = await window.api.loadProgress() || {}; }
  catch { ST.progress = {}; }

  // 1) instant start from the last scan of this folder (if any)
  try { ctx.cached = await window.api.getScanCache(rootPath); } catch {}
  if (token !== ST.scanToken) return;
  if (ctx.cached && ctx.cached.mangas && ctx.cached.mangas.length) {
    ctx.fromCache = ctx.uiStarted = true;
    ST.mode = 'library';
    ST.library = ctx.cached.mangas.map(hydrate);
    addToRecent(rootPath);
    hideLoad(); buildLibraryUI();
    G('libLabel').textContent = ST.library.length + ' Series · checking for changes…';
  }

  // 2) real scan — runs in a worker thread; batches AND the final result arrive as
  //    ordered events (see onScanDone), so the end can never be handled before the data.
  ctx.rootPath = rootPath;
  window.api.scanRoot(rootPath, token).catch(err => {
    if (token === ST.scanToken) cancelLoad('⚠ Scan error: ' + err.message);
  });
}

window.api.onScanDone(function (d) {
  const ctx = ST.scanCtx;
  if (!ctx || d.seq !== ctx.token) return;
  finishScan(ctx, d.result);
});

function finishScan(ctx, result) {
  const rootPath = ctx.rootPath;
  ctx.scanning = false;

  if (result.mode === 'error') { cancelLoad('⚠ Scan error: ' + result.message); return; }
  if (!result || result.mode === 'empty') {
    if (ctx.fromCache) { showToast('⚠ That folder is now empty'); return; }
    cancelLoad('⚠ No manga/images found in that folder'); return;
  }

  if (result.mode === 'library') {
    if (ctx.fromCache) {
      if (result.sig !== ctx.cached.sig) {          // something changed on disk → swap in the fresh data
        ST.library = ctx.incoming.map(hydrate);
        if (G('S-lib').classList.contains('vis')) renderGrid();
        showToast('Library updated');
      } else if (G('S-lib').classList.contains('vis')) renderGrid();   // restores the normal label
    } else {
      addToRecent(rootPath);
      renderGrid();                                  // final pass: applies the chosen sort/filter
    }
    return;
  }

  addToRecent(rootPath);
  ST.mode = result.mode;

  if (result.mode === 'manga') {
    const manga = hydrate(result.manga);
    manga.path = rootPath;
    ST.library = [manga]; ST.curManga = manga;
    setLoad(100);
    setTimeout(() => { hideLoad(); openChapList(manga); }, 120);

  } else if (result.mode === 'chapter') {
    const pseudo = hydrate({
      name: result.chapterName, path: rootPath, ch: [[result.chapterName, 2]],
      coverPath: result.cover || null, isPDFManga: false,
    });
    ST.library = [pseudo]; ST.curManga = pseudo;
    setLoad(100);
    setTimeout(() => { hideLoad(); openReader(pseudo.chapters[0]); }, 120);
  }
}

// ── PDF COVER THUMBNAILS ─────────────────────────────────────────
// Renders the actual first page of a manga's first PDF as its cover art,
// swapping in for the generic "PDF Volumes" placeholder once ready.
function firstPDFPath(manga) {
  const c = manga.ch.find(x => x[1] === 1);
  return c ? manga.path + '/' + c[0] : null;
}

async function applyPDFCoverImage(manga, coverEl, phEl) {
  const pdfPath = firstPDFPath(manga);
  if (!pdfPath) return;

  const swapIn = url => {
    if (!coverEl.isConnected) return; // grid re-rendered before we finished
    const img = document.createElement('img');
    img.className = 'mcover-img';
    img.loading = 'lazy';
    img.src = url;
    img.onload = () => { if (phEl) phEl.style.display = 'none'; };
    img.onerror = () => { img.remove(); };
    coverEl.insertBefore(img, coverEl.firstChild);
  };

  if (ST.pdfThumbCache[pdfPath]) { swapIn(ST.pdfThumbCache[pdfPath]); return; }

  try {
    const url = await window.api.getPdfThumb(pdfPath);
    if (url) { ST.pdfThumbCache[pdfPath] = url; swapIn(url); }
  } catch (err) { console.error('pdf thumbnail error:', err); }
}

// ── LIBRARY UI ───────────────────────────────────────────────────
function readCount(manga) {
  let n = 0;
  for (const c of manga.ch) if (ST.progress[manga.name + '::' + c[0]]) n++;
  return n;
}
function getSorted() {
  const q = (G('searchBar').value || '').toLowerCase();
  let list = q ? ST.library.filter(m => m.name.toLowerCase().includes(q)) : [...ST.library];
  const s = G('sortSel').value;
  if (s === 'az')   list.sort((a,b) => a.name.localeCompare(b.name));
  if (s === 'za')   list.sort((a,b) => b.name.localeCompare(a.name));
  if (s === 'most') list.sort((a,b) => readCount(b) - readCount(a));
  if (s === 'prog') list.sort((a,b) => {
    const pa = a.ch.length ? readCount(a)/a.ch.length : 0;
    const pb = b.ch.length ? readCount(b)/b.ch.length : 0;
    return pb - pa;
  });
  return list;
}

function buildLibraryUI() {
  renderGrid();
  showScreen('S-lib');
  G('counter').textContent = ST.library.length + ' manga';
}

// Covers (and PDF covers) are only loaded when their card is near the screen,
// so a library with thousands of series doesn't decode thousands of images
// or spawn thousands of PDF renders at once.
const coverIO = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const el = en.target;
    coverIO.unobserve(el);
    const fn = el._loadCover; el._loadCover = null;
    if (fn) fn();
  }
}, { root: null, rootMargin: '1800px 0px' });

function makeCard(manga) {
  const total   = manga.ch.length;
  const rn      = readCount(manga);
  const pct     = total ? Math.round(rn / total * 100) : 0;
  const allDone = rn === total && total > 0;
  const card    = document.createElement('div'); card.className = 'mcard';

  const cover = document.createElement('div'); cover.className = 'mcover';
  function showPh() {
    const ph = document.createElement('div'); ph.className = 'mcover-ph';
    ph.textContent = (manga.name.replace(/[^a-zA-Z0-9]/g,'').slice(0,3)||'?').toUpperCase();
    cover.appendChild(ph);
  }
  if (manga.isPDFManga) {
    const ph = document.createElement('div'); ph.className = 'mcover-pdf';
    ph.innerHTML = '<div class="mcover-pdf-icon">📕</div><div class="mcover-pdf-label">PDF Volumes</div>';
    cover.appendChild(ph);
    const pdfBadge = document.createElement('div'); pdfBadge.className = 'pdf-badge';
    pdfBadge.textContent = 'PDF'; cover.appendChild(pdfBadge);
    cover._loadCover = () => applyPDFCoverImage(manga, cover, ph);
    coverIO.observe(cover);
  } else if (manga.coverPath) {
    cover._loadCover = () => {
      const img = document.createElement('img'); img.className = 'mcover-img';
      img.decoding = 'async'; img.loading = 'lazy';
      img.onerror = () => { img.remove(); showPh(); };
      img.src = fileUrl(manga.coverPath);
      cover.insertBefore(img, cover.firstChild);
    };
    coverIO.observe(cover);
  } else showPh();

  const badge = document.createElement('div'); badge.className = 'mbadge';
  badge.textContent = total + ' ch'; cover.appendChild(badge);
  const ov = document.createElement('div'); ov.className = 'moverlay';
  ov.innerHTML = '<span>Open →</span>'; cover.appendChild(ov);
  const pb = document.createElement('div'); pb.className = 'mprog';
  const pf = document.createElement('div'); pf.className = 'mprog-f'; pf.style.width = pct + '%';
  pb.appendChild(pf); cover.appendChild(pb);

  const info = document.createElement('div'); info.className = 'minfo';
  const pc = allDone ? 'done' : rn > 0 ? 'wip' : 'fresh';
  const pl = allDone ? '✓ Done' : rn > 0 ? pct + '%' : 'New';
  info.innerHTML = `
    <div class="mname" title="${esc(manga.name)}">${esc(manga.name)}</div>
    <div class="mmeta">
      <span class="mmeta-l">${rn}/${total} read</span>
      <span class="mpill ${pc}">${pl}</span>
    </div>`;
  card.appendChild(cover); card.appendChild(info);
  card.onclick = () => openChapList(manga);
  return card;
}

// add cards for newly scanned series without rebuilding the whole grid
function appendCards(list) {
  const grid = G('mangaGrid');
  const frag = document.createDocumentFragment();
  for (const m of list) frag.appendChild(makeCard(m));
  grid.appendChild(frag);
}

function renderGrid() {
  const list = getSorted();
  const q = G('searchBar').value || '';
  G('libLabel').textContent = list.length + (q ? ' (filtered)' : '') + ' Series';
  G('counter').textContent  = list.length + ' / ' + ST.library.length;
  const grid = G('mangaGrid'); grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const m of list) frag.appendChild(makeCard(m));
  grid.appendChild(frag);
}

let searchT;
G('searchBar').addEventListener('input',  () => { clearTimeout(searchT); searchT = setTimeout(renderGrid, 160); });
G('sortSel').addEventListener('change',   () => renderGrid());

// ── CHAPTER LIST ─────────────────────────────────────────────────
function openChapList(manga) {
  ST.curManga = manga;
  const total = manga.ch.length;
  const rn    = readCount(manga);
  const pct   = total ? Math.round(rn / total * 100) : 0;
  G('chapTitle').textContent = manga.name;
  G('chapSub').textContent   = `${total} chapters · ${rn} read · ${pct}%`;
  const ci = G('chapCover');
  if (manga.coverPath) {
    ci.src = fileUrl(manga.coverPath); ci.style.display = '';
  } else if (manga.isPDFManga) {
    const pdfPath = firstPDFPath(manga);
    if (pdfPath && ST.pdfThumbCache[pdfPath]) { ci.src = ST.pdfThumbCache[pdfPath]; ci.style.display = ''; }
    else {
      ci.style.display = 'none';
      if (pdfPath) {
        window.api.getPdfThumb(pdfPath).then(url => {
          if (!url) return;
          ST.pdfThumbCache[pdfPath] = url;
          if (ST.curManga === manga) { ci.src = url; ci.style.display = ''; }
        }).catch(console.error);
      }
    }
  } else ci.style.display = 'none';

  // continue banner
  const slot = G('continueSlot'); slot.innerHTML = '';
  const lastKey = ST.lastChap[manga.name];
  if (lastKey) {
    const lastCh = manga.chapters.find(c => c.name === lastKey);
    if (lastCh) {
      const b = document.createElement('div'); b.className = 'continue-wrap';
      b.innerHTML = `
        <span class="continue-icon">▶</span>
        <div class="continue-info">
          <div class="continue-lbl">Continue Reading</div>
          <div class="continue-ch">${lastCh.isPDF ? esc(baseName(lastCh.name).replace(/\.pdf$/i,'')) : 'Chapter ' + (lastCh.num || extractNum(lastCh.name))}</div>
        </div>
        <span class="continue-arrow">→</span>`;
      b.onclick = () => openReader(lastCh);
      slot.appendChild(b);
    }
  }

  const grid = G('chapGrid'); grid.innerHTML = '';
  const pageEls = [];                                   // filled in below, asynchronously
  const nImg = manga.chapters.filter(c => !c.isPDF).length, nPdf = manga.chapters.length - nImg;
  const mixed = nImg > 0 && nPdf > 0;
  let lastGroup = null;
  manga.chapters.forEach(ch => {
    if (mixed && lastGroup !== ch.isPDF) {               // section header ("Chapters" / "PDF volumes")
      const h = document.createElement('div'); h.className = 'chap-group';
      h.innerHTML = `<span>${ch.isPDF ? '📕 PDF Volumes · ' + nPdf : '🖼 Chapters · ' + nImg}</span>`;
      if (lastGroup === null) {
        const sw = document.createElement('button'); sw.className = 'chap-swap'; sw.textContent = '⇅ swap order';
        sw.title = 'Show the other group first'; 
        sw.onclick = () => {
          try { localStorage.setItem('mv.volumesFirst', volumesFirst() ? '0' : '1'); } catch {}
          manga.chapters = groupChapters(manga.chapters);
          openChapList(manga);
        };
        h.appendChild(sw);
      }
      grid.appendChild(h); lastGroup = ch.isPDF;
    }
    const rid    = manga.name + '::' + ch.name;
    const isRead = !!ST.progress[rid];
    const isCur  = ch.name === lastKey;
    const el = document.createElement('div');
    el.className = 'ci' + (isRead ? ' read' : '') + (isCur ? ' cur' : '');
    el.innerHTML =
      (isRead ? '<div class="ci-dot"></div>' : '') +
      (isCur  ? '<div class="ci-curdot"></div>' : '') +
      `<div class="ci-num">${ch.isPDF ? 'VOL' : 'CH'} ${ch.num || extractNum(baseName(ch.name))}</div>` +
      `<div class="ci-pg">${ch.isPDF ? 'PDF' : (ch.pages != null ? ch.pages + ' pages' : '…')}</div>`;
    el.onclick = () => openReader(ch);
    grid.appendChild(el);
    if (!ch.isPDF && ch.pages == null) pageEls.push([ch, el]);
  });
  showScreen('S-chap');
  fillPageCounts(manga, pageEls);
}

// "N pages" labels, counted in the background in small chunks (never blocks the UI).
// Scanning no longer opens every chapter folder, so folders that turn out to hold
// no images (extras, stray folders…) are dropped here, when the series is opened.
async function fillPageCounts(manga, pairs) {
  let dropped = 0;
  for (let i = 0; i < pairs.length; i += 60) {
    if (ST.curManga !== manga) return;
    const chunk = pairs.slice(i, i + 60);
    let counts;
    try { counts = await window.api.countPages(chunk.map(([ch]) => ch.path)); } catch { return; }
    chunk.forEach(([ch, el], k) => {
      ch.pages = counts[k];
      if (counts[k] > 0) { if (el.isConnected) el.querySelector('.ci-pg').textContent = counts[k] + ' pages'; }
      else { ch.empty = true; dropped++; if (el.isConnected) el.style.display = 'none'; }
    });
  }
  if (dropped && ST.curManga === manga) {
    const keep = new Set(manga.chapters.filter(c => c.empty).map(c => c.name));
    manga.chapters = manga.chapters.filter(c => !c.empty);        // reader prev/next skip them too
    manga.ch = manga.ch.filter(c => !keep.has(c[0]));
    const total = manga.ch.length, rn = readCount(manga), pct = total ? Math.round(rn / total * 100) : 0;
    G('chapSub').textContent = `${total} chapters · ${rn} read · ${pct}%`;
  }
}

G('chapBackBtn').onclick = () => {
  if (ST.mode === 'library') { renderGrid(); showScreen('S-lib'); }
  else reset();
};
G('readAllBtn').onclick = () => {
  if (ST.curManga?.chapters?.length) openReader(ST.curManga.chapters[0]);
};

// ── READER ────────────────────────────────────────────────────────
function extractNum(s) { const m = s.match(/\d+/); return m ? parseInt(m[0]) : 0; }

function getChapIdx() {
  if (!ST.curManga) return -1;
  return ST.curManga.chapters.findIndex(c => c.name === ST.curChapKey);
}
function updateNavBtns() {
  const idx = getChapIdx();
  G('rPrev').disabled = idx <= 0;
  G('rNext').disabled = !ST.curManga || idx >= ST.curManga.chapters.length - 1;
}

async function openReader(ch) {
  ST.curChapKey = ch.name;
  const manga   = ST.curManga;
  if (manga) {
    ST.progress[manga.name + '::' + ch.name] = true;
    ST.lastChap[manga.name] = ch.name;
    window.api.saveProgress(ST.progress).catch(console.error);
  }

  updateNavBtns();

  // ── PDF mode ──────────────────────────────────────────────
  if (ch.isPDF) {
    G('rTitle').textContent = (manga?.name || '') + ' — ' + baseName(ch.name).replace(/\.pdf$/i,'');
    G('rPages').textContent = 'PDF';
    G('rProgF').style.width = '100%';

    // PDF: use rscroll directly as iframe container
    const rscroll = G('rScroll');
    rscroll.innerHTML = '';
    rscroll.style.display = 'block';
    rscroll.style.padding = '0';

    // Replace strip with a proper flex container for PDF
    const pdfWrap = document.createElement('div');
    pdfWrap.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';

    const notice = document.createElement('div');
    notice.className = 'pdf-toolbar-notice';
    notice.innerHTML = '📄 PDF — <span>Ctrl+scroll to zoom</span> · Right-click on page to open with system viewer';
    pdfWrap.appendChild(notice);

    const iframe = document.createElement('iframe');
    iframe.className = 'pdf-frame';
    iframe.style.cssText = 'flex:1;min-height:0;width:100%;border:none;';
    iframe.src = fileUrl(ch.pdfPath);
    iframe.title = ch.name;
    pdfWrap.appendChild(iframe);

    rscroll.appendChild(pdfWrap);

    G('widthSel').style.display = 'none';
    G('toTop').classList.remove('on');
    showScreen('S-read');
    return;
  }

  // ── Image mode ────────────────────────────────────────────
  const token = ++ST.readToken;
  const rscroll = G('rScroll');
  rscroll.style.display = '';
  rscroll.style.padding = '';
  rscroll.innerHTML = '<div id="strip" class="strip"></div>';

  G('widthSel').style.display = '';
  G('rTitle').textContent = (manga?.name || '') + ' — Ch.' + (ch.num || extractNum(ch.name));
  G('rPages').textContent = '…';
  G('rProgF').style.width = '0%';

  const strip = document.getElementById('strip');
  strip.className = 'strip';
  const wv = G('widthSel').value; if (wv) strip.classList.add(wv);
  rscroll.scrollTop = 0;
  showScreen('S-read');

  const names = await window.api.listImages(ch.path);       // page list is read only now, for this chapter
  if (token !== ST.readToken) return;                        // user already moved on
  ch.pages = names.length;
  G('rPages').textContent = names.length + ' pages';

  pageIO.disconnect();
  const frag = document.createDocumentFragment();
  names.forEach((name, idx) => {
    const el = document.createElement('img');
    // Reserve space until the real size is known (otherwise every not-yet-loaded
    // page is 0px tall and the browser would load the whole chapter at once).
    el.style.aspectRatio = '2 / 3';
    el.decoding = 'async';
    el.alt = 'Page ' + (idx + 1);
    el.onload  = () => { el.style.aspectRatio = ''; };
    el.onerror = () => { el.style.opacity = '.1'; };
    el.addEventListener('contextmenu', e => { e.preventDefault(); openLightbox(el.src); });
    const url = fileUrl(ch.path + '/' + name);
    if (idx < 6) {                                   // first pages: immediately, high priority
      if (idx < 3) el.setAttribute('fetchpriority', 'high');
      el.src = url;
    } else {                                         // the rest: loaded well BEFORE they scroll into view
      el.dataset.src = url;
      pageIO.observe(el);
    }
    frag.appendChild(el);
  });
  strip.appendChild(frag);
  prefetchNextChapter(ch);
}

// Pages start loading ~6 screens ahead, so by the time you scroll to them they are
// already decoded (native loading="lazy" only starts ~1 screen ahead = visible delay).
const pageIO = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const el = en.target; pageIO.unobserve(el);
    if (el.dataset.src) { el.src = el.dataset.src; delete el.dataset.src; }
  }
}, { root: G('rScroll'), rootMargin: '7000px 0px' });

// quietly warm up the first pages of the next chapter
let prefetchTimer;
function prefetchNextChapter(ch) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    const m = ST.curManga; if (!m) return;
    const list = m.chapters, i = list.indexOf(ch);
    const next = i >= 0 ? list.slice(i + 1).find(c => !c.isPDF && !c.empty) : null;
    if (!next) return;
    try {
      const names = await window.api.listImages(next.path);
      names.slice(0, 4).forEach(n => { const im = new Image(); im.decoding = 'async'; im.src = fileUrl(next.path + '/' + n); });
    } catch {}
  }, 2500);
}

G('rPrev').onclick = () => {
  const idx = getChapIdx();
  if (idx > 0) openReader(ST.curManga.chapters[idx - 1]);
};
G('rNext').onclick = () => {
  const idx = getChapIdx();
  if (ST.curManga && idx >= 0 && idx < ST.curManga.chapters.length - 1)
    openReader(ST.curManga.chapters[idx + 1]);
};
G('rBackBtn').onclick = () => {
  if (ST.curManga) openChapList(ST.curManga);
  else if (ST.mode === 'library') { renderGrid(); showScreen('S-lib'); }
  else reset();
};
G('widthSel').onchange = () => {
  const s = document.getElementById('strip');
  if (!s) return; // PDF mode — no strip
  s.className = 'strip';
  const v = G('widthSel').value; if (v) s.classList.add(v);
};

const rsc = G('rScroll');
rsc.addEventListener('scroll', () => {
  G('toTop').classList.toggle('on', rsc.scrollTop > 500);
  const tot = rsc.scrollHeight - rsc.clientHeight;
  // Don't update progress bar in PDF mode (iframe handles its own scroll)
  const curCh = ST.curManga?.chapters?.find(c => c.name === ST.curChapKey);
  if (!curCh?.isPDF) {
    G('rProgF').style.width = (tot > 0 ? Math.round(rsc.scrollTop / tot * 100) : 100) + '%';
  }
  clearTimeout(ST.htimer);
  if (rsc.scrollTop > 80)
    ST.htimer = setTimeout(() => G('rbar').classList.add('hide'), 2500);
  else
    G('rbar').classList.remove('hide');
}, { passive: true });

G('S-read').addEventListener('mousemove', () => {
  G('rbar').classList.remove('hide');
  clearTimeout(ST.htimer);
  if (rsc.scrollTop > 80)
    ST.htimer = setTimeout(() => G('rbar').classList.add('hide'), 2800);
});
G('toTop').onclick = () => rsc.scrollTo({ top: 0, behavior: 'smooth' });
rsc.addEventListener('dblclick', () => window.api.winFs());

// ── LIGHTBOX ──────────────────────────────────────────────────────
const lb = G('lightbox'), lbImg = G('lb-img');
function openLightbox(src) {
  lbImg.src = src; ST.lbZoomed = false;
  lbImg.classList.remove('zoomed'); lbImg.style.transform = '';
  lb.classList.add('on');
}
function closeLightbox() { lb.classList.remove('on'); lbImg.src = ''; }
G('lb-close').onclick = closeLightbox;
lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
lbImg.addEventListener('click', e => {
  if (ST.lbZoomed) {
    ST.lbZoomed = false; lbImg.classList.remove('zoomed');
    lbImg.style.transform = ''; lbImg.style.transformOrigin = '';
  } else {
    ST.lbZoomed = true; lbImg.classList.add('zoomed');
    const r = lbImg.getBoundingClientRect();
    lbImg.style.transformOrigin = `${((e.clientX-r.left)/r.width*100).toFixed(1)}% ${((e.clientY-r.top)/r.height*100).toFixed(1)}%`;
    lbImg.style.transform = 'scale(2.5)';
  }
});

// ── KEYBOARD ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (lb.classList.contains('on')) { if (e.key === 'Escape') closeLightbox(); return; }
  if (G('S-read').classList.contains('vis')) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if      (e.key === 'ArrowRight' || e.key === 'n') G('rNext').click();
    else if (e.key === 'ArrowLeft'  || e.key === 'p') G('rPrev').click();
    else if (e.key === 'Escape') G('rBackBtn').click();
    else if (e.key === 'Home') rsc.scrollTo({ top: 0, behavior: 'smooth' });
    else if (e.key === 'End')  rsc.scrollTo({ top: rsc.scrollHeight, behavior: 'smooth' });
    else if (e.key === 'f' || e.key === 'F') window.api.winFs();
  }
});

// ── RESET ─────────────────────────────────────────────────────────
function reset() {
  ST.scanToken++; ST.readToken++; ST.scanCtx = null;
  window.api.cancelScan().catch(() => {});
  ST.mode = null; ST.library = []; ST.curManga = null; ST.curChapKey = null;
  G('searchBar').value = '';
  // Restore rscroll to clean state (in case PDF mode left it dirty)
  const rscroll = G('rScroll');
  rscroll.style.display = '';
  rscroll.style.padding = '';
  rscroll.innerHTML = '<div id="strip" class="strip"></div>';
  G('widthSel').style.display = '';
  G('rbar').classList.remove('hide');
  G('toTop').classList.remove('on');
  G('rProgF').style.width = '0%';
  ['S-lib','S-chap','S-read'].forEach(id => G(id).classList.remove('vis'));
  G('welcome').classList.remove('hidden');
  showScreen(null);
  renderRecent();
}

// ── INIT ──────────────────────────────────────────────────────────
loadAndRenderRecent();
