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
};

// ── DOM ───────────────────────────────────────────────────────────
const G = id => document.getElementById(id);

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
        <div class="recent-name">${r.name}</div>
        <div class="recent-path">${r.path}</div>
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
  for (const f of files) { if (f.path) { processPath(f.path); return; } }
  showToast('⚠ Drop a folder, not a file');
});

// ── PROCESS PATH ─────────────────────────────────────────────────
async function processPath(rootPath) {
  showLoad('Scanning folder structure…');
  setLoad(10);

  try { ST.progress = await window.api.loadProgress() || {}; }
  catch { ST.progress = {}; }

  let result;
  try { result = await window.api.scanRoot(rootPath); setLoad(70); }
  catch (err) { cancelLoad('⚠ Scan error: ' + err.message); return; }

  if (!result || result.mode === 'empty') {
    cancelLoad('⚠ No manga/images found in that folder'); return;
  }

  addToRecent(rootPath);
  setLoad(95);
  ST.mode = result.mode;

  if (result.mode === 'library') {
    ST.library = result.mangas;
    setLoad(100);
    setTimeout(() => { hideLoad(); buildLibraryUI(); }, 150);

  } else if (result.mode === 'manga') {
    const manga = { name: result.mangaName, path: rootPath, chapters: result.chapters, coverPath: result.coverPath, isPDFManga: result.isPDFManga || false };
    ST.library = [manga]; ST.curManga = manga;
    setLoad(100);
    setTimeout(() => { hideLoad(); openChapList(manga); }, 150);

  } else if (result.mode === 'chapter') {
    const pseudo = {
      name: result.chapterName, path: rootPath,
      isPDFManga: false,
      chapters: [{ name: result.chapterName, path: rootPath, num: 0, isPDF: false, images: result.images }],
      coverPath: result.images[0]?.filePath || null,
    };
    ST.library = [pseudo]; ST.curManga = pseudo;
    setLoad(100);
    setTimeout(() => { hideLoad(); openReader(pseudo.chapters[0]); }, 150);
  }
}

// ── PDF COVER THUMBNAILS ─────────────────────────────────────────
// Renders the actual first page of a manga's first PDF as its cover art,
// swapping in for the generic "PDF Volumes" placeholder once ready.
function firstPDFPath(manga) {
  const c = manga.chapters.find(ch => ch.isPDF);
  return c ? c.pdfPath : null;
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
  return manga.chapters.filter(ch => ST.progress[manga.name + '::' + ch.name]).length;
}
function getSorted() {
  const q = (G('searchBar').value || '').toLowerCase();
  let list = q ? ST.library.filter(m => m.name.toLowerCase().includes(q)) : [...ST.library];
  const s = G('sortSel').value;
  if (s === 'az')   list.sort((a,b) => a.name.localeCompare(b.name));
  if (s === 'za')   list.sort((a,b) => b.name.localeCompare(a.name));
  if (s === 'most') list.sort((a,b) => readCount(b) - readCount(a));
  if (s === 'prog') list.sort((a,b) => {
    const pa = a.chapters.length ? readCount(a)/a.chapters.length : 0;
    const pb = b.chapters.length ? readCount(b)/b.chapters.length : 0;
    return pb - pa;
  });
  return list;
}

function buildLibraryUI() {
  renderGrid();
  showScreen('S-lib');
  G('counter').textContent = ST.library.length + ' manga';
}

function renderGrid() {
  const list = getSorted();
  const q = G('searchBar').value || '';
  G('libLabel').textContent = list.length + (q ? ' (filtered)' : '') + ' Series';
  G('counter').textContent  = list.length + ' / ' + ST.library.length;
  const grid = G('mangaGrid'); grid.innerHTML = '';

  list.forEach(manga => {
    const total   = manga.chapters.length;
    const rn      = readCount(manga);
    const pct     = total ? Math.round(rn / total * 100) : 0;
    const allDone = rn === total && total > 0;
    const card    = document.createElement('div'); card.className = 'mcard';

    const cover = document.createElement('div'); cover.className = 'mcover';
    if (manga.isPDFManga) {
      const ph = document.createElement('div'); ph.className = 'mcover-pdf';
      ph.innerHTML = '<div class="mcover-pdf-icon">📕</div><div class="mcover-pdf-label">PDF Volumes</div>';
      cover.appendChild(ph);
      const pdfBadge = document.createElement('div'); pdfBadge.className = 'pdf-badge';
      pdfBadge.textContent = 'PDF'; cover.appendChild(pdfBadge);
      applyPDFCoverImage(manga, cover, ph);
    } else if (manga.coverPath) {
      const img = document.createElement('img'); img.className = 'mcover-img';
      img.src = 'file://' + manga.coverPath; img.loading = 'lazy';
      img.onerror = showPh; cover.appendChild(img);
    } else showPh();
    function showPh() {
      const ph = document.createElement('div'); ph.className = 'mcover-ph';
      ph.textContent = (manga.name.replace(/[^a-zA-Z0-9]/g,'').slice(0,3)||'?').toUpperCase();
      cover.appendChild(ph);
    }
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
      <div class="mname" title="${manga.name}">${manga.name}</div>
      <div class="mmeta">
        <span class="mmeta-l">${rn}/${total} read</span>
        <span class="mpill ${pc}">${pl}</span>
      </div>`;
    card.appendChild(cover); card.appendChild(info);
    card.onclick = () => openChapList(manga);
    grid.appendChild(card);
  });
}

G('searchBar').addEventListener('input',  () => renderGrid());
G('sortSel').addEventListener('change',   () => renderGrid());

// ── CHAPTER LIST ─────────────────────────────────────────────────
function openChapList(manga) {
  ST.curManga = manga;
  const total = manga.chapters.length;
  const rn    = readCount(manga);
  const pct   = total ? Math.round(rn / total * 100) : 0;
  G('chapTitle').textContent = manga.name;
  G('chapSub').textContent   = `${total} chapters · ${rn} read · ${pct}%`;
  const ci = G('chapCover');
  if (manga.coverPath) {
    ci.src = 'file://' + manga.coverPath; ci.style.display = '';
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
          <div class="continue-ch">${lastCh.isPDF ? lastCh.name.replace('.pdf','') : 'Chapter ' + (lastCh.num || extractNum(lastCh.name))}</div>
        </div>
        <span class="continue-arrow">→</span>`;
      b.onclick = () => openReader(lastCh);
      slot.appendChild(b);
    }
  }

  const grid = G('chapGrid'); grid.innerHTML = '';
  manga.chapters.forEach(ch => {
    const rid    = manga.name + '::' + ch.name;
    const isRead = !!ST.progress[rid];
    const isCur  = ch.name === lastKey;
    const el = document.createElement('div');
    el.className = 'ci' + (isRead ? ' read' : '') + (isCur ? ' cur' : '');
    el.innerHTML =
      (isRead ? '<div class="ci-dot"></div>' : '') +
      (isCur  ? '<div class="ci-curdot"></div>' : '') +
      `<div class="ci-num">${ch.isPDF ? 'VOL' : 'CH'} ${ch.num || extractNum(ch.name)}</div>` +
      `<div class="ci-pg">${ch.isPDF ? 'PDF' : ch.images.length + ' pages'}</div>`;
    el.onclick = () => openReader(ch);
    grid.appendChild(el);
  });
  showScreen('S-chap');
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

function openReader(ch) {
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
    G('rTitle').textContent = (manga?.name || '') + ' — ' + ch.name.replace('.pdf','');
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
    iframe.src = 'file://' + ch.pdfPath;
    iframe.title = ch.name;
    pdfWrap.appendChild(iframe);

    rscroll.appendChild(pdfWrap);

    G('widthSel').style.display = 'none';
    G('toTop').classList.remove('on');
    showScreen('S-read');
    return;
  }

  // ── Image mode ────────────────────────────────────────────
  // Restore rscroll to normal state (in case we came from PDF mode)
  const rscroll = G('rScroll');
  rscroll.style.display = '';
  rscroll.style.padding = '';
  // Always rebuild strip cleanly when switching to image mode
  rscroll.innerHTML = '<div id="strip" class="strip"></div>';

  G('widthSel').style.display = '';
  G('rTitle').textContent = (manga?.name || '') + ' — Ch.' + (ch.num || extractNum(ch.name));
  G('rPages').textContent = ch.images.length + ' pages';
  G('rProgF').style.width = '0%';

  const strip = document.getElementById('strip');
  strip.innerHTML = '';
  strip.className = 'strip';
  const wv = G('widthSel').value; if (wv) strip.classList.add(wv);

  ch.images.forEach((imgData, idx) => {
    const el = document.createElement('img');
    el.src      = 'file://' + imgData.filePath;
    el.alt      = 'Page ' + (idx + 1);
    el.decoding = idx < 3 ? 'sync' : 'async';
    el.loading  = idx < 5 ? 'eager' : 'lazy';
    if (idx < 3) el.setAttribute('fetchpriority', 'high');
    el.onerror = () => { el.style.opacity = '.1'; el.style.minHeight = '40px'; };
    el.addEventListener('contextmenu', e => { e.preventDefault(); openLightbox(el.src); });
    strip.appendChild(el);
  });

  rscroll.scrollTop = 0;
  showScreen('S-read');
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
