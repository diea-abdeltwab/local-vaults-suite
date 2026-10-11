// ════════════════════════════════════════════════════════════
// PDFs Vault — Renderer Process
// ════════════════════════════════════════════════════════════

// ── STATE ─────────────────────────────────────────────────────────
const ST = {
  rootTree: null,        // full scanned tree
  pathStack: [],          // array of folder nodes from root to current (breadcrumb)
  progress: {},           // { pdfPath: true }
  starred: {},            // { pdfPath: true }
  recentPaths: [],
  curPdfList: [],          // flat list of pdf nodes in current folder (for prev/next)
  curPdfIdx: -1,
  searchMode: false,
  htimer: null,
};

// ── DOM ───────────────────────────────────────────────────────────
const G = id => document.getElementById(id);

// ── SCREENS ───────────────────────────────────────────────────────
function showScreen(name) {
  ['S-browse','S-read'].forEach(id => G(id).classList.toggle('vis', id === name));
  const inBrowse = name === 'S-browse';
  G('searchBar').style.display  = inBrowse ? '' : 'none';
  G('starredBtn').style.display = inBrowse ? '' : 'none';
  G('tb-change').style.display  = name ? '' : 'none';
  G('counter').style.display    = inBrowse ? '' : 'none';
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
  try { ST.recentPaths = await window.api.loadRecent() || []; }
  catch { ST.recentPaths = []; }
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
  ST.recentPaths = ST.recentPaths.filter(r => r.path !== folderPath);
  ST.recentPaths.unshift({ path: folderPath, name, ts: Date.now() });
  ST.recentPaths = ST.recentPaths.slice(0, 2);
  window.api.saveRecent(ST.recentPaths).catch(console.error);
}

// ── UTIL ─────────────────────────────────────────────────────────
// Absolute path -> file:// URL with every segment encoded, so folder/file
// names containing  #  ?  %  or spaces still load correctly.
function fileUrl(p) { return 'file://' + p.split('/').map(encodeURIComponent).join('/'); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtSize(bytes) {
  if (!bytes) return '';
  const u = ['B','KB','MB','GB']; let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length-1) { n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
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
async function processPath(rootPath) {
  showLoad('Scanning folder structure…');
  setLoad(10);

  try { ST.progress = await window.api.loadProgress() || {}; } catch { ST.progress = {}; }
  try { ST.starred  = await window.api.loadStarred()  || {}; } catch { ST.starred  = {}; }

  let result;
  try { result = await window.api.scanRoot(rootPath); setLoad(70); }
  catch (err) { cancelLoad('⚠ Scan error: ' + err.message); return; }

  if (!result || result.mode === 'empty') {
    cancelLoad('⚠ No PDFs found in that folder'); return;
  }

  addToRecent(rootPath);
  setLoad(95);
  ST.rootTree = result.tree;
  ST.pathStack = [ST.rootTree];

  setLoad(100);
  setTimeout(() => { hideLoad(); renderBrowse(); }, 150);
}

// ── BREADCRUMBS ──────────────────────────────────────────────────
function renderCrumbs() {
  const bar = G('crumbBar');
  bar.innerHTML = '';
  ST.pathStack.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep'; sep.textContent = '›';
      bar.appendChild(sep);
    }
    const isLast = i === ST.pathStack.length - 1;
    const el = document.createElement('span');
    el.className = 'crumb' + (isLast ? ' last' : '');
    el.textContent = node.name;
    if (!isLast) el.onclick = () => { ST.pathStack = ST.pathStack.slice(0, i+1); renderBrowse(); };
    bar.appendChild(el);
  });
}

// ── PROGRESS HELPERS ─────────────────────────────────────────────
function countReadInFolder(folderNode) {
  let read = 0, total = 0;
  function walk(n) {
    if (n.type === 'pdf') { total++; if (ST.progress[n.path]) read++; }
    else n.children.forEach(walk);
  }
  walk(folderNode);
  return { read, total };
}

// ── BROWSE RENDER ────────────────────────────────────────────────
function renderBrowse() {
  ST.searchMode = false;
  G('searchBar').value = '';
  renderCrumbs();
  const cur = ST.pathStack[ST.pathStack.length - 1];
  const grid = G('itemGrid'); grid.innerHTML = '';
  grid.style.gridTemplateColumns = '';
  G('browseLabel').textContent = cur.name;

  const folders = cur.children.filter(c => c.type === 'folder');
  const pdfs    = cur.children.filter(c => c.type === 'pdf');

  G('counter').textContent = cur.totalPdfCount + ' PDFs';

  if (folders.length === 0 && pdfs.length === 0) {
    grid.innerHTML = '<div class="empty-hint">No PDFs here.</div>';
    showScreen('S-browse');
    return;
  }

  // Flat, tree-ordered list scoped to the *current* folder only, so reader
  // Prev/Next stays inside this course and stops at its last/first PDF
  // instead of spilling into sibling courses/folders.
  const flatPdfs = flattenPdfs(cur, []);

  folders.forEach(f => grid.appendChild(buildFolderCard(f)));
  pdfs.forEach(p => grid.appendChild(buildPdfCard(p, flatPdfs)));

  showScreen('S-browse');
}

function buildFolderCard(node) {
  const { read, total } = countReadInFolder(node);
  const pct = total ? Math.round(read/total*100) : 0;
  const allDone = total > 0 && read === total;
  const isLeafFolder = node.children.every(c => c.type === 'pdf'); // folder full of PDFs (likely a "course/module")
  const icon = isLeafFolder ? '📕' : '📂';

  const card = document.createElement('div'); card.className = 'fcard';
  card.innerHTML = `
    <div class="fcard-top">
      <div class="fcard-icon">${icon}</div>
      <div class="fcard-name" title="${esc(node.name)}">${esc(node.name)}</div>
    </div>
    <div class="fcard-meta">
      <span class="fcard-count">${node.totalPdfCount} PDF${node.totalPdfCount !== 1 ? 's' : ''}</span>
      <span class="fpill ${allDone ? 'done' : (read > 0 ? 'wip' : 'fresh')}">${allDone ? '✓ done' : (read > 0 ? pct + '%' : 'new')}</span>
    </div>
    <div class="fcard-prog"><div class="fcard-prog-f" style="width:${pct}%"></div></div>
  `;
  card.onclick = () => { ST.pathStack.push(node); renderBrowse(); };
  return card;
}

function buildPdfCard(node, siblingPdfs) {
  const isRead = !!ST.progress[node.path];
  const isStar = !!ST.starred[node.path];
  const card = document.createElement('div'); card.className = 'pcard' + (isRead ? ' read' : '');
  card.innerHTML = `
    ${isRead ? '<div class="pcard-dot"></div>' : ''}
    <div class="pcard-icon">📄</div>
    <div class="pcard-info">
      <div class="pcard-name" title="${esc(node.name)}">${esc(node.name.replace(/\.pdf$/i,''))}</div>
      <div class="pcard-meta">${fmtSize(node.size)}</div>
    </div>
    <div class="pcard-star ${isStar ? 'on' : ''}" title="Star">${isStar ? '★' : '☆'}</div>
  `;
  card.onclick = (e) => {
    if (e.target.classList.contains('pcard-star')) return;
    openReader(node, siblingPdfs);
  };
  card.querySelector('.pcard-star').onclick = (e) => {
    e.stopPropagation();
    toggleStar(node.path);
    const el = e.target;
    const on = el.classList.toggle('on');
    el.textContent = on ? '★' : '☆';
  };
  return card;
}

function toggleStar(pdfPath) {
  if (ST.starred[pdfPath]) delete ST.starred[pdfPath];
  else ST.starred[pdfPath] = true;
  window.api.saveStarred(ST.starred).catch(console.error);
}

// ── SEARCH (across whole tree) ───────────────────────────────────
let searchDebounce;
G('searchBar').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 180);
});
function flattenPdfs(node, acc) {
  if (node.type === 'pdf') { acc.push(node); return acc; }
  node.children.forEach(c => flattenPdfs(c, acc));
  return acc;
}
function runSearch() {
  const q = G('searchBar').value.trim().toLowerCase();
  if (!q) { ST.searchMode = false; renderBrowse(); return; }
  ST.searchMode = true;
  const all = flattenPdfs(ST.rootTree, []);
  const matches = all.filter(p => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  renderSearchResults(matches, `Search: "${q}"`);
}
function renderSearchResults(list, label) {
  G('browseLabel').textContent = label;
  G('crumbBar').innerHTML = '';
  const grid = G('itemGrid'); grid.innerHTML = '';
  grid.style.gridTemplateColumns = '1fr';
  G('counter').textContent = list.length + ' results';
  if (!list.length) {
    grid.innerHTML = '<div class="empty-hint">No matches found.</div>';
    showScreen('S-browse');
    return;
  }
  list.forEach(p => {
    const rel = p.path.replace(ST.rootTree.path, '').replace(/^\//,'');
    const el = document.createElement('div');
    el.className = 'sres-item';
    el.innerHTML = `
      <span class="sres-icon">📄</span>
      <div class="sres-info">
        <div class="sres-name">${esc(p.name.replace(/\.pdf$/i,''))}</div>
        <div class="sres-path">${esc(rel)}</div>
      </div>`;
    el.onclick = () => openReader(p, list);
    grid.appendChild(el);
  });
  showScreen('S-browse');
}

// ── STARRED VIEW ─────────────────────────────────────────────────
G('starredBtn').onclick = () => {
  const all = flattenPdfs(ST.rootTree, []);
  const starred = all.filter(p => ST.starred[p.path]);
  renderSearchResults(starred, '★ Starred PDFs');
};

// ── READER ────────────────────────────────────────────────────────
function openReader(pdfNode, siblingList) {
  ST.curPdfList = siblingList && siblingList.length ? siblingList : [pdfNode];
  ST.curPdfIdx  = ST.curPdfList.findIndex(p => p.path === pdfNode.path);
  if (ST.curPdfIdx === -1) { ST.curPdfList = [pdfNode]; ST.curPdfIdx = 0; }

  ST.progress[pdfNode.path] = true;
  window.api.saveProgress(ST.progress).catch(console.error);

  renderReader();
}

function renderReader() {
  const node = ST.curPdfList[ST.curPdfIdx];
  const pdfName = node.name.replace(/\.pdf$/i,'');
  G('rTitle').textContent = node.courseName ? (node.courseName + ' — ' + pdfName) : pdfName;
  // Open with the thumbnail sidebar collapsed: more room to read, and the viewer no
  // longer renders a thumbnail for every page (heavy for big image-based PDFs).
  // The ☰ button in the viewer brings it back whenever you want it.
  G('pdfFrame').src = fileUrl(node.path) + '#navpanes=0';

  G('rPrev').disabled = ST.curPdfIdx <= 0;
  G('rNext').disabled = ST.curPdfIdx >= ST.curPdfList.length - 1;

  const isStar = !!ST.starred[node.path];
  G('rStar').textContent = isStar ? '★' : '☆';
  G('rStar').classList.toggle('on', isStar);

  showScreen('S-read');
}

G('rPrev').onclick = () => {
  if (ST.curPdfIdx > 0) {
    ST.curPdfIdx--;
    const node = ST.curPdfList[ST.curPdfIdx];
    ST.progress[node.path] = true;
    window.api.saveProgress(ST.progress).catch(console.error);
    renderReader();
  }
};
G('rNext').onclick = () => {
  if (ST.curPdfIdx < ST.curPdfList.length - 1) {
    ST.curPdfIdx++;
    const node = ST.curPdfList[ST.curPdfIdx];
    ST.progress[node.path] = true;
    window.api.saveProgress(ST.progress).catch(console.error);
    renderReader();
  }
};
G('rBackBtn').onclick = () => {
  G('pdfFrame').src = '';
  if (ST.searchMode) { showScreen('S-browse'); renderBrowse(); }
  else renderBrowse();
};
G('rStar').onclick = () => {
  const node = ST.curPdfList[ST.curPdfIdx];
  toggleStar(node.path);
  const on = !!ST.starred[node.path];
  G('rStar').textContent = on ? '★' : '☆';
  G('rStar').classList.toggle('on', on);
};
G('rExternal').onclick = () => {
  const node = ST.curPdfList[ST.curPdfIdx];
  if (node) window.api.openExternal(node.path);
};
G('rShowFolder').onclick = () => {
  const node = ST.curPdfList[ST.curPdfIdx];
  window.api.showInFolder(node.path).catch(console.error);
};

// ── KEYBOARD ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (G('S-read').classList.contains('vis')) {
    if (e.target.tagName === 'INPUT') return;
    if      (e.key === 'ArrowRight' || e.key === 'n') G('rNext').click();
    else if (e.key === 'ArrowLeft'  || e.key === 'p') G('rPrev').click();
    else if (e.key === 'Escape') G('rBackBtn').click();
    else if (e.key === 'f' || e.key === 'F') window.api.winFs();
  } else {
    if (e.key === 'Escape' && document.activeElement === G('searchBar')) {
      G('searchBar').value = ''; G('searchBar').blur(); renderBrowse();
    }
  }
});

// ── RESET ─────────────────────────────────────────────────────────
function reset() {
  ST.rootTree = null; ST.pathStack = []; ST.curPdfList = []; ST.curPdfIdx = -1;
  G('searchBar').value = '';
  G('crumbBar').innerHTML = '';
  G('itemGrid').innerHTML = '';
  G('welcome').classList.remove('hidden');
  showScreen(null);
  renderRecent();
}

// ── INIT ──────────────────────────────────────────────────────────
loadAndRenderRecent();
