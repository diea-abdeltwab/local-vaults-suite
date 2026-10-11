// ════════════════════════════════════════════════════════════
// Code Vault — Renderer Process
// ════════════════════════════════════════════════════════════

const HLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/';

// ── STATE ─────────────────────────────────────────────────────────
const ST = {
  rootTree: null,
  pathStack: [],
  pathIndex: {},
  starred: {},
  visited: {},
  recentPaths: [],
  curCodeList: [],
  curIdx: -1,
  curNode: null,
  curRawContent: '',
  curTruncated: false,
  curSize: 0,
  searchMode: false,
  contentSearchMode: false,
  wrap: false,
  mdMode: 'render',
};

// ── DOM ───────────────────────────────────────────────────────────
const G = id => document.getElementById(id);

// ── SCREENS ───────────────────────────────────────────────────────
function showScreen(name) {
  ['S-browse','S-view','S-stats'].forEach(id => G(id).classList.toggle('vis', id === name));
  const inBrowse = name === 'S-browse';
  const hasVault = !!name;
  G('tbSearchGroup').style.display = inBrowse ? '' : 'none';
  G('tbDiv1').style.display = inBrowse ? '' : 'none';
  G('tbToolsGroup').style.display = hasVault ? '' : 'none';
  G('tbDiv2').style.display = hasVault ? '' : 'none';
  G('counter').style.display   = inBrowse ? '' : 'none';
  G('tb-change').style.display = hasVault ? '' : 'none';
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
      <span class="recent-icon">🗂️</span>
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
  ST.recentPaths = ST.recentPaths.slice(0, 3);
  window.api.saveRecent(ST.recentPaths).catch(console.error);
}

// ── UTIL ─────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function plural(n, word, pluralWord) { return n + ' ' + (n === 1 ? word : (pluralWord || word + 's')); }
function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B','KB','MB','GB']; let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length-1) { n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}
function relPath(p) {
  if (!ST.rootTree) return p;
  const root = ST.rootTree.path;
  return p.startsWith(root) ? p.slice(root.length).replace(/^\//,'') : p;
}
function joinPath(dir, rel) {
  if (/^\//.test(rel)) return rel;
  const parts = dir.split('/').filter(Boolean);
  rel.split('/').forEach(p => {
    if (p === '..') parts.pop();
    else if (p === '.' || p === '') { /* skip */ }
    else parts.push(p);
  });
  return '/' + parts.join('/');
}

const LANG_ABBR = {
  'JavaScript':'JS','TypeScript':'TS','JSX':'JSX','TSX':'TSX','Python':'PY','Python Stub':'PYI',
  'Jupyter Notebook':'NB','Java':'JAVA','Kotlin':'KT','Kotlin Script':'KTS','Scala':'SC','Groovy':'GRV',
  'Gradle':'GRD','C':'C','C Header':'H','C++':'C++','C++ Header':'HPP','C#':'C#','C# Script':'CSX',
  'Go':'GO','Rust':'RS','Swift':'SWF','Objective-C':'OBJC','Objective-C++':'OBJC','Zig':'ZIG','Nim':'NIM',
  'D':'D','V':'V','Assembly':'ASM','Ruby':'RB','Ruby ERB':'ERB','PHP':'PHP','Lua':'LUA','Perl':'PL',
  'Perl Module':'PM','R':'R','Julia':'JL','Dart':'DART','Elixir':'EX','Elixir Script':'EXS','Erlang':'ERL',
  'Haskell':'HS','Clojure':'CLJ','ClojureScript':'CLJS','F#':'FS','F# Script':'FSX','VB.NET':'VB',
  'Shell':'SH','Bash':'BASH','Zsh':'ZSH','Fish':'FISH','PowerShell':'PS1','PowerShell Module':'PSM',
  'Batch':'BAT','HTML':'HTML','XML':'XML','SVG':'SVG','CSS':'CSS','SCSS':'SCSS','Sass':'SASS','LESS':'LESS',
  'JSON':'JSON','JSON5':'JS5','YAML':'YML','TOML':'TOML','INI':'INI','Config':'CFG','Env':'ENV',
  'Properties':'PROP','GraphQL':'GQL','Protocol Buffers':'PB','SQL':'SQL','PostgreSQL':'SQL','SQL DDL':'DDL',
  'Markdown':'MD','MDX':'MDX','reStructuredText':'RST','LaTeX':'TEX','Text':'TXT','Log':'LOG','CSV':'CSV',
  'TSV':'TSV','Diff':'DIFF','Patch':'PATCH','Makefile':'MAKE','Dockerfile':'DOCK','CMake':'CMK',
  'Project File':'PROJ','Solution':'SLN','Git Ignore':'GIT','Git Attributes':'GIT','Editor Config':'CFG',
  'NPM Config':'NPM','Apache Config':'CONF','Vue':'VUE','Svelte':'SVL','Rakefile':'RAKE','Gemfile':'GEM',
  'Procfile':'PROC','License':'LIC',
};
function langAbbr(lang) { return LANG_ABBR[lang] || (lang || '?').slice(0,4).toUpperCase(); }

const ASSET_ICONS = {
  png:'🖼️',jpg:'🖼️',jpeg:'🖼️',gif:'🖼️',webp:'🖼️',bmp:'🖼️',ico:'🖼️',avif:'🖼️',svg:'🖼️',
  pdf:'📕', docx:'📄',doc:'📄', pptx:'📊',ppt:'📊', xlsx:'📈',xls:'📈',
  zip:'🗜️',rar:'🗜️','7z':'🗜️',tar:'🗜️',gz:'🗜️',
  dll:'⚙️',so:'⚙️',dylib:'⚙️',exe:'⚙️',bin:'⚙️',pdb:'⚙️',cache:'⚙️',bak:'⚙️',suo:'⚙️',user:'⚙️',
  mp3:'🎵',wav:'🎵',flac:'🎵', mp4:'🎬',mov:'🎬',avi:'🎬',mkv:'🎬',
  ttf:'🔤',otf:'🔤',woff:'🔤',woff2:'🔤',
  db:'🗄️',sqlite:'🗄️',dacpac:'🗄️',
};

// Which in-app previewer handles a given asset extension
const ASSET_KIND_MAP = {};
['png','jpg','jpeg','gif','webp','bmp','ico','avif','svg'].forEach(e => ASSET_KIND_MAP[e] = 'image');
['pdf'].forEach(e => ASSET_KIND_MAP[e] = 'pdf');
['mp3','wav','flac','ogg','m4a','aac'].forEach(e => ASSET_KIND_MAP[e] = 'audio');
['mp4','mov','avi','mkv','webm','m4v'].forEach(e => ASSET_KIND_MAP[e] = 'video');
['ttf','otf','woff','woff2'].forEach(e => ASSET_KIND_MAP[e] = 'font');
['docx'].forEach(e => ASSET_KIND_MAP[e] = 'docx');
['xlsx','xls'].forEach(e => ASSET_KIND_MAP[e] = 'xlsx');
function assetKind(ext) { return ASSET_KIND_MAP[ext] || 'unsupported'; }
const ASSET_LABELS = { image:'Image', pdf:'PDF Document', audio:'Audio', video:'Video', font:'Font', docx:'Word Document', xlsx:'Spreadsheet', unsupported:'Binary File' };
const ASSET_COLORS = { image:'sky', pdf:'red', audio:'green', video:'mauve', font:'yellow', docx:'blue', xlsx:'green', unsupported:'subtext0' };

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
  showLoad('Scanning folder for source files…');
  setLoad(10);

  try { ST.starred = await window.api.loadStarred() || {}; } catch { ST.starred = {}; }
  try { ST.visited = await window.api.loadVisited() || {}; } catch { ST.visited = {}; }

  let result;
  try { result = await window.api.scanRoot(rootPath); setLoad(70); }
  catch (err) { cancelLoad('⚠ Scan error: ' + err.message); return; }

  if (!result || result.mode === 'empty') {
    cancelLoad('⚠ No files found in that folder'); return;
  }

  addToRecent(rootPath);
  setLoad(90);
  ST.rootTree = result.tree;
  ST.pathStack = [ST.rootTree];
  buildPathIndex();

  setLoad(100);
  setTimeout(() => { hideLoad(); renderBrowse(); }, 150);
}

function flattenCode(node, acc) {
  if (node.type === 'code') { acc.push(node); return acc; }
  if (node.type === 'folder') node.children.forEach(c => flattenCode(c, acc));
  return acc;
}
function flattenAssets(node, acc) {
  if (node.type === 'asset') { acc.push(node); return acc; }
  if (node.type === 'folder') node.children.forEach(c => flattenAssets(c, acc));
  return acc;
}
function buildPathIndex() {
  const idx = {};
  flattenCode(ST.rootTree, []).forEach(n => idx[n.path] = n);
  flattenAssets(ST.rootTree, []).forEach(n => idx[n.path] = n);
  ST.pathIndex = idx;
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
    el.textContent = (i === 0 ? '🗂️ ' : '') + node.name;
    if (!isLast) el.onclick = () => { ST.pathStack = ST.pathStack.slice(0, i+1); renderBrowse(); };
    bar.appendChild(el);
  });
}

// ── LANGUAGE COLOR PREVIEW ────────────────────────────────────────
const langColorCache = new WeakMap();
function topLangColors(node) {
  if (langColorCache.has(node)) return langColorCache.get(node);
  const set = new Set();
  (function walk(n) {
    if (n.type === 'code') set.add(n.color);
    else if (n.type === 'folder') n.children.forEach(walk);
  })(node);
  const arr = Array.from(set).slice(0, 5);
  langColorCache.set(node, arr);
  return arr;
}

// ── BROWSE RENDER ────────────────────────────────────────────────
function renderBrowse() {
  ST.searchMode = false;
  ST.contentSearchMode = false;
  G('searchBar').value = '';
  G('contentSearchBtn').classList.remove('on');
  renderCrumbs();
  const cur = ST.pathStack[ST.pathStack.length - 1];
  const grid = G('itemGrid'); grid.innerHTML = ''; grid.style.gridTemplateColumns = '';
  const agrid = G('assetGrid'); agrid.innerHTML = '';
  G('browseLabel').textContent = cur.name;
  G('counter').textContent = plural(cur.totalCodeCount, 'code file');

  const folders = cur.children.filter(c => c.type === 'folder');
  const codes   = cur.children.filter(c => c.type === 'code');
  const assets  = cur.children.filter(c => c.type === 'asset');

  if (!folders.length && !codes.length && !assets.length) {
    grid.innerHTML = '<div class="empty-hint">Empty folder.</div>';
    showScreen('S-browse');
    return;
  }

  // Prev/Next navigation is scoped to exactly the files visible in THIS
  // folder — it should never silently cross into a sibling or child folder.
  folders.forEach(f => grid.appendChild(buildFolderCard(f)));
  codes.forEach(c => grid.appendChild(buildCodeCard(c, codes)));

  if (assets.length) {
    const lbl = document.createElement('div');
    lbl.className = 'sec-label'; lbl.style.gridColumn = '1/-1';
    lbl.textContent = `Other Files (${assets.length})`;
    agrid.appendChild(lbl);
    assets.forEach(a => agrid.appendChild(buildAssetCard(a, assets)));
  }

  showScreen('S-browse');
}

function buildFolderCard(node) {
  const colors = topLangColors(node);
  const icon = node.totalCodeCount === 0 ? '🗃️' : '📁';
  const card = document.createElement('div'); card.className = 'fcard';
  card.innerHTML = `
    <div class="fcard-top">
      <div class="fcard-icon">${icon}</div>
      <div class="fcard-name">${esc(node.name)}</div>
    </div>
    <div class="fcard-meta">
      <span class="fcard-count">${node.totalCodeCount} file${node.totalCodeCount !== 1 ? 's' : ''}${node.totalAssetCount ? ` · ${node.totalAssetCount} other` : ''}</span>
      <span class="fcard-langs">${colors.map(c => `<span class="lang-dot bg-${c}"></span>`).join('')}</span>
    </div>`;
  card.onclick = () => { ST.pathStack.push(node); renderBrowse(); };
  return card;
}

function buildCodeCard(node, siblingList) {
  const isVisited = !!ST.visited[node.path];
  const isStar = !!ST.starred[node.path];
  const card = document.createElement('div'); card.className = 'ccard' + (isVisited ? ' visited' : '');
  card.innerHTML = `
    ${isVisited ? '<div class="ccard-dot"></div>' : ''}
    <div class="ccard-icon bg-${node.color}">${langAbbr(node.lang)}</div>
    <div class="ccard-info">
      <div class="ccard-name">${esc(node.name)}</div>
      <div class="ccard-meta">${esc(node.lang)} · ${fmtSize(node.size)}</div>
    </div>
    <div class="ccard-star ${isStar ? 'on' : ''}" title="Star">${isStar ? '★' : '☆'}</div>`;
  card.onclick = (e) => { if (e.target.classList.contains('ccard-star')) return; openViewer(node, siblingList); };
  card.querySelector('.ccard-star').onclick = (e) => {
    e.stopPropagation();
    toggleStar(node.path);
    const on = e.target.classList.toggle('on');
    e.target.textContent = on ? '★' : '☆';
  };
  return card;
}

function buildAssetCard(node, siblingList) {
  const icon = ASSET_ICONS[node.ext] || '📦';
  const card = document.createElement('div'); card.className = 'acard';
  card.innerHTML = `
    <div class="acard-icon">${icon}</div>
    <div class="acard-info">
      <div class="acard-name">${esc(node.name)}</div>
      <div class="acard-meta">${fmtSize(node.size)}</div>
    </div>`;
  card.onclick = () => openViewer(node, siblingList);
  return card;
}

function toggleStar(p) {
  if (ST.starred[p]) delete ST.starred[p]; else ST.starred[p] = true;
  window.api.saveStarred(ST.starred).catch(console.error);
}

// ── SEARCH ────────────────────────────────────────────────────────
let searchDebounce;
G('searchBar').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 220);
});
G('contentSearchBtn').onclick = () => {
  ST.contentSearchMode = !ST.contentSearchMode;
  G('contentSearchBtn').classList.toggle('on', ST.contentSearchMode);
  if (G('searchBar').value.trim()) runSearch();
  else showToast(ST.contentSearchMode ? 'In-file search on — type to search file contents' : 'In-file search off');
};

async function runSearch() {
  const q = G('searchBar').value.trim();
  if (!q) { ST.searchMode = false; renderBrowse(); return; }
  ST.searchMode = true;
  G('crumbBar').innerHTML = '';
  const grid = G('itemGrid');
  G('assetGrid').innerHTML = '';

  if (ST.contentSearchMode) {
    grid.innerHTML = '<div class="empty-hint">Searching file contents…</div>';
    grid.style.gridTemplateColumns = '1fr';
    showScreen('S-browse');
    let results = [];
    try { results = await window.api.searchContent({ rootPath: ST.rootTree.path, query: q, maxResults: 150 }); }
    catch (err) { grid.innerHTML = '<div class="empty-hint">⚠ Search failed: ' + esc(err.message) + '</div>'; return; }
    if (G('searchBar').value.trim() !== q) return; // stale
    renderContentResults(results, `In-file: "${q}"`);
  } else {
    const all = flattenCode(ST.rootTree, []);
    const ql = q.toLowerCase();
    const matches = all.filter(n => n.name.toLowerCase().includes(ql) || n.path.toLowerCase().includes(ql));
    renderSearchResults(matches, `Search: "${q}"`);
  }
}

function renderSearchResults(list, label) {
  G('browseLabel').textContent = label;
  G('crumbBar').innerHTML = '';
  const grid = G('itemGrid'); grid.innerHTML = ''; grid.style.gridTemplateColumns = '1fr';
  G('assetGrid').innerHTML = '';
  G('counter').textContent = plural(list.length, 'result');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-hint">No matches found.</div>';
    showScreen('S-browse');
    return;
  }
  list.forEach(n => {
    const el = document.createElement('div'); el.className = 'sres-item';
    el.innerHTML = `
      <div class="sres-icon bg-${n.color}">${langAbbr(n.lang)}</div>
      <div class="sres-info">
        <div class="sres-name">${esc(n.name)}</div>
        <div class="sres-path">${esc(relPath(n.path))}</div>
      </div>`;
    el.onclick = () => openViewer(n, list);
    grid.appendChild(el);
  });
  showScreen('S-browse');
}

function renderContentResults(list, label) {
  G('browseLabel').textContent = label;
  const grid = G('itemGrid'); grid.innerHTML = ''; grid.style.gridTemplateColumns = '1fr';
  G('counter').textContent = plural(list.length, 'match', 'matches');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-hint">No matches found in file contents.</div>';
    return;
  }
  const q = G('searchBar').value.trim();
  const qEsc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let hlRe = null;
  try { hlRe = new RegExp('(' + qEsc + ')', 'ig'); } catch { hlRe = null; }
  list.forEach(r => {
    const node = ST.pathIndex[r.path];
    const el = document.createElement('div'); el.className = 'sres-item';
    const color = node ? node.color : 'subtext0';
    const abbr = node ? langAbbr(node.lang) : '?';
    let lineHtml = esc(r.lineText);
    if (hlRe) lineHtml = lineHtml.replace(hlRe, m => `<b>${m}</b>`);
    el.innerHTML = `
      <div class="sres-icon bg-${color}">${abbr}</div>
      <div class="sres-info">
        <div class="sres-name">${esc(r.name)} <span style="color:var(--overlay0);font-weight:400;">:${r.lineNo}</span></div>
        <div class="sres-path">${esc(relPath(r.path))}</div>
        <div class="sres-line">${lineHtml}</div>
      </div>`;
    el.onclick = () => { if (node) openViewer(node, [node]); else showToast('File no longer indexed — try rescanning'); };
    grid.appendChild(el);
  });
}

// ── STARRED ───────────────────────────────────────────────────────
G('starredBtn').onclick = () => {
  const all = flattenCode(ST.rootTree, []);
  const starred = all.filter(n => ST.starred[n.path]);
  renderSearchResults(starred, '★ Starred Files');
};

// ── STATS ─────────────────────────────────────────────────────────
G('statsBtn').onclick = async () => {
  showScreen('S-stats');
  G('statCards').innerHTML = '<div class="empty-hint">Computing…</div>';
  G('langBars').innerHTML = '';
  let stats;
  try { stats = await window.api.computeStats(ST.rootTree.path); }
  catch (err) { G('statCards').innerHTML = '⚠ ' + esc(err.message); return; }
  renderStats(stats);
};
function renderStats(stats) {
  const cards = G('statCards'); cards.innerHTML = '';
  const items = [
    { label: 'Code Files',  val: stats.totalFiles.toLocaleString() },
    { label: 'Total Lines', val: stats.totalLines.toLocaleString() },
    { label: 'Languages',   val: Object.keys(stats.byLang).length },
    { label: 'Total Size',  val: fmtSize(stats.totalSize) },
    { label: 'Other Files', val: stats.totalAssets.toLocaleString() },
  ];
  items.forEach(it => {
    const c = document.createElement('div'); c.className = 'stat-card';
    c.innerHTML = `<div class="stat-num">${it.val}</div><div class="stat-label">${it.label}</div>`;
    cards.appendChild(c);
  });
  const bars = G('langBars'); bars.innerHTML = '';
  const langs = Object.entries(stats.byLang).sort((a, b) => b[1].lines - a[1].lines);
  const maxLines = langs.length ? langs[0][1].lines : 1;
  langs.forEach(([lang, d]) => {
    const row = document.createElement('div'); row.className = 'lang-bar-row';
    const pct = maxLines ? Math.max(3, Math.round(d.lines / maxLines * 100)) : 0;
    row.innerHTML = `
      <div class="lang-bar-name">${esc(lang)}</div>
      <div class="lang-bar-track"><div class="lang-bar-fill bg-${d.color}" style="width:${pct}%"></div></div>
      <div class="lang-bar-val">${d.lines.toLocaleString()} ln · ${d.files}f</div>`;
    bars.appendChild(row);
  });
  if (!langs.length) bars.innerHTML = '<div class="empty-hint">No code files found.</div>';
}

// ── SYNTAX HIGHLIGHTING (dynamic language loading) ────────────────
const loadedLangs = new Set();
function ensureLanguageLoaded(alias) {
  return new Promise(resolve => {
    if (!window.hljs) return resolve(false);
    if (!alias || alias === 'plaintext') return resolve(false);
    if (hljs.getLanguage(alias)) return resolve(true);
    if (loadedLangs.has(alias)) return resolve(!!hljs.getLanguage(alias));
    loadedLangs.add(alias);
    const s = document.createElement('script');
    s.src = HLJS_CDN + alias + '.min.js';
    s.onload = () => resolve(!!hljs.getLanguage(alias));
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

// ── CODE VIEWER BODY ───────────────────────────────────────────────
function buildCodeBody(node, content) {
  const wrapDiv = document.createElement('div'); wrapDiv.className = 'code-wrap';
  const lines = content.split('\n');
  const gutter = document.createElement('div'); gutter.className = 'gutter';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i++) {
    const d = document.createElement('div'); d.textContent = String(i + 1); frag.appendChild(d);
  }
  gutter.appendChild(frag);
  const pane = document.createElement('div'); pane.className = 'code-pane' + (ST.wrap ? ' wrap' : '');
  const pre = document.createElement('pre'); const code = document.createElement('code');
  pre.appendChild(code); pane.appendChild(pre);
  wrapDiv.appendChild(gutter); wrapDiv.appendChild(pane);

  const alias = node.hljs || 'plaintext';
  code.textContent = content;
  ensureLanguageLoaded(alias).then(ok => {
    try {
      if (ok && window.hljs && hljs.getLanguage(alias)) {
        code.innerHTML = hljs.highlight(content, { language: alias }).value;
        code.className = 'hljs language-' + alias;
      }
    } catch { /* leave as plain text */ }
  });
  return wrapDiv;
}
function buildTruncNote(size) {
  const d = document.createElement('div'); d.className = 'trunc-note';
  d.textContent = `⚠ File is large — showing first 4 MB of ${fmtSize(size)}. Use the 📁 button above to open the full file in your own editor.`;
  return d;
}

// ── MARKDOWN RENDERING (lightweight, no external deps) ─────────────
function resolveMdAsset(url, baseDir) {
  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:')) return url;
  return 'file://' + encodeURI(joinPath(baseDir, url.replace(/^\.\//, '')));
}
function mdToHtml(src, baseDir) {
  const codeBlocks = [];
  src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    codeBlocks.push({ lang, code });
    return `\u0000CB${codeBlocks.length - 1}\u0000`;
  });

  // Preserve raw inline HTML (common in notebook/README sources: <img>, <br>, <a>)
  // before the general escape pass, otherwise it would show up as literal text.
  const rawTags = [];
  const stash = html => { rawTags.push(html); return `\u0000HT${rawTags.length - 1}\u0000`; };
  const imgTag = (url, alt, widthAttr) => {
    const resolved = resolveMdAsset(url, baseDir);
    const style = widthAttr ? ` style="max-width:${widthAttr}px;width:100%;"` : '';
    return `<img alt="${esc(alt || '')}" src="${resolved}"${style} onerror="window.__vaultImgErr(this)">`;
  };
  src = src.replace(/<img\s+[^>]*>/gi, m => {
    const srcM = m.match(/src\s*=\s*["']([^"']+)["']/i);
    const altM = m.match(/alt\s*=\s*["']([^"']*)["']/i);
    const widM = m.match(/width\s*=\s*["']?(\d+)/i);
    return stash(imgTag(srcM ? srcM[1] : '', altM ? altM[1] : '', widM ? widM[1] : null));
  });
  src = src.replace(/<br\s*\/?>/gi, () => stash('<br>'));
  src = src.replace(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, text) =>
    stash(`<a href="#" data-href="${esc(href)}">${esc(text)}</a>`));
  // Raw <code>...</code> (copy-pasted from a web page) — style it like our own inline code
  src = src.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (m, inner) => stash(`<code>${esc(inner)}</code>`));
  // Common inline formatting tags — pass through as-is rather than escaping to literal text
  ['strong', 'b', 'em', 'i', 'u', 'sub', 'sup', 'mark', 'small'].forEach(tag => {
    src = src.replace(new RegExp(`</?${tag}(\\s[^>]*)?>`, 'gi'), m => stash(m));
  });
  // Non-semantic wrapper tags (often just anchor-id wrappers like <span id="11">…</span>
  // used for internal doc navigation) — drop the tag but keep its text content.
  src = src.replace(/<\/?(span|div|font)(\s[^>]*)?>/gi, '');

  src = esc(src);
  src = src
    .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>');
  src = src.replace(/^&gt; ?(.*)$/gm, '<blockquote>$1</blockquote>');
  src = src.replace(/^(-{3,}|\*{3,})$/gm, '<hr>');
  src = src
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code: GFM-style double-backtick spans first (``code``, used when the
  // code itself might contain a backtick), then plain single-backtick spans.
  // Applied per-list-item here (list items are always single-line so this is safe).
  // For ordinary paragraph text, inline code is instead applied per-paragraph
  // further down (see applyInlineCode below) — allowing a code span to
  // legitimately cross line breaks within ONE paragraph (e.g. a multi-line shell
  // command wrapped in a single pair of backticks) while keeping any stray
  // unmatched backtick from corrupting anything beyond that one paragraph.
  const applyInlineCode = str => str
    .replace(/``([^`]+?)``/g, '<code>$1</code>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  src = src.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => imgTag(url, alt, null));
  src = src.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => `<a href="#" data-href="${esc(url)}">${text}</a>`);
  src = src.replace(/^(?:- |\* )(.*)$/gm, (m, txt) => `<li class="ul">${applyInlineCode(txt)}</li>`);
  src = src.replace(/^\d+[.)]\s+(.*)$/gm, (m, txt) => `<li class="ol">${applyInlineCode(txt)}</li>`);
  src = src.replace(/(<li class="(?:ul|ol)">[\s\S]*?<\/li>\n?)+/g, m => {
    const tag = /class="ol"/.test(m) ? 'ol' : 'ul';
    const hadNL = /\n$/.test(m);
    const body = m.replace(/\n$/, '').replace(/ class="(?:ul|ol)"/g, '');
    return `<${tag}>${body}</${tag}>` + (hadNL ? '\n' : '');
  });

  // Group consecutive plain-text lines into a single paragraph (joined with <br>),
  // only starting a new paragraph after an actual blank line — matching how
  // Markdown/Jupyter really renders it. Previously every single line got wrapped
  // in its own <p>, which is what made dense notes look chopped up with a big
  // gap after every line.
  const lines = src.split('\n');
  const blocks = [];
  let para = [];
  const isBlockLevel = line => /^\s*\u0000CB\d+\u0000\s*$/.test(line) || /^\s*<\/?\s*(h\d|ul|ol|li|blockquote|hr|pre|img)/.test(line);
  const flush = () => {
    if (!para.length) return;
    const joined = para.join('\u0001');
    const coded = applyInlineCode(joined);
    blocks.push('<p>' + coded.split('\u0001').join('<br>\n') + '</p>');
    para = [];
  };
  for (const line of lines) {
    if (/^\s*$/.test(line)) { flush(); continue; }
    if (isBlockLevel(line)) { flush(); blocks.push(line); continue; }
    para.push(line);
  }
  flush();
  src = blocks.join('\n');

  src = src.replace(/\u0000HT(\d+)\u0000/g, (m, idx) => rawTags[idx]);
  src = src.replace(/\u0000CB(\d+)\u0000/g, (m, idx) => {
    const { lang, code } = codeBlocks[idx];
    return `<pre><code class="language-${esc(lang || 'plaintext')}">${esc(code)}</code></pre>`;
  });
  return src;
}
window.__vaultImgErr = function (el) {
  const span = document.createElement('span');
  span.style.cssText = 'color:var(--overlay0);font-size:.78rem;display:inline-block;padding:4px 0;';
  span.textContent = '⚠ Image not found: ' + (el.getAttribute('alt') || el.getAttribute('src') || '');
  el.replaceWith(span);
};
function wireMarkdownLinks(container, baseDir) {
  container.querySelectorAll('pre code[class^="language-"]').forEach(el => {
    const alias = (el.className.replace('language-', '') || 'plaintext').trim();
    ensureLanguageLoaded(alias).then(() => { try { hljs.highlightElement(el); } catch {} });
  });
  container.querySelectorAll('a[data-href]').forEach(a => {
    a.onclick = (e) => {
      e.preventDefault();
      const href = a.getAttribute('data-href');
      if (/^https?:\/\//.test(href) || href.startsWith('mailto:')) { window.api.openUrl(href); return; }
      // Local relative link — try to resolve to a file already in this vault
      // and open it in-app; we never hand links off to an external app.
      const full = joinPath(baseDir, href.replace(/^\.\//, '').split('#')[0]);
      const target = ST.pathIndex[full];
      if (target) openViewer(target, [target]);
      else showToast('File not found in this vault: ' + href);
    };
  });
}
function buildMarkdownBody(node, content) {
  const baseDir = node.path.slice(0, node.path.lastIndexOf('/'));
  const div = document.createElement('div'); div.className = 'md-render';
  div.innerHTML = mdToHtml(content, baseDir);
  wireMarkdownLinks(div, baseDir);
  return div;
}

// ── BINARY ASSET PREVIEWS (images / pdf / audio / video / fonts / docx / xlsx) ──
// Everything below renders in-app via a 'file://' URL or an in-memory
// conversion — nothing is ever handed off to an external app.
function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function localFileUrl(p) { return 'file://' + encodeURI(p); }

function buildImageBody(node) {
  const wrap = document.createElement('div'); wrap.className = 'asset-media';
  const img = document.createElement('img');
  img.src = localFileUrl(node.path);
  img.alt = node.name;
  img.onerror = () => { wrap.className = 'unsupported-note'; wrap.innerHTML = `<div class="aicon">🖼️</div><div class="un-name">${esc(node.name)}</div><div class="un-meta">Could not load this image.</div>`; };
  wrap.appendChild(img);
  return wrap;
}
function buildPdfBody(node) {
  const iframe = document.createElement('iframe');
  iframe.className = 'pdf-frame';
  iframe.src = localFileUrl(node.path);
  iframe.title = node.name;
  return iframe;
}
function buildAudioBody(node) {
  const wrap = document.createElement('div'); wrap.className = 'asset-media';
  const audio = document.createElement('audio');
  audio.controls = true; audio.src = localFileUrl(node.path); audio.style.width = '420px';
  wrap.appendChild(audio);
  return wrap;
}
function buildVideoBody(node) {
  const wrap = document.createElement('div'); wrap.className = 'asset-media';
  const video = document.createElement('video');
  video.controls = true; video.src = localFileUrl(node.path);
  wrap.appendChild(video);
  return wrap;
}
let fontPreviewCounter = 0;
function buildFontBody(node) {
  fontPreviewCounter++;
  const family = 'vaultFontPreview' + fontPreviewCounter;
  const fmt = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' }[node.ext] || 'truetype';
  const wrap = document.createElement('div'); wrap.className = 'font-preview';
  const style = document.createElement('style');
  style.textContent = `@font-face{font-family:'${family}';src:url('${localFileUrl(node.path)}') format('${fmt}');font-display:swap;}`;
  wrap.appendChild(style);
  const alphabet = document.createElement('div');
  alphabet.className = 'fp-alphabet'; alphabet.style.fontFamily = family;
  alphabet.textContent = 'AaBbCcDdEeFfGg 0123456789';
  wrap.appendChild(alphabet);
  [32, 22, 16, 13].forEach(size => {
    const block = document.createElement('div'); block.className = 'fp-size';
    const label = document.createElement('div'); label.className = 'fp-label'; label.textContent = size + 'px';
    const sample = document.createElement('div'); sample.className = 'fp-sample';
    sample.style.fontFamily = family; sample.style.fontSize = size + 'px';
    sample.textContent = 'The quick brown fox jumps over the lazy dog — 0123456789';
    block.appendChild(label); block.appendChild(sample);
    wrap.appendChild(block);
  });
  return wrap;
}
function buildUnsupportedBody(node) {
  const wrap = document.createElement('div'); wrap.className = 'unsupported-note';
  wrap.innerHTML = `
    <div class="aicon">${ASSET_ICONS[node.ext] || '📦'}</div>
    <div class="un-name">${esc(node.name)}</div>
    <div class="un-meta">${esc((node.ext || 'file').toUpperCase())} · ${fmtSize(node.size)} — no inline preview available for this file type yet.</div>
    <button class="un-btn" id="unRevealBtn">📁 Reveal in file manager</button>`;
  wrap.querySelector('#unRevealBtn').onclick = () => window.api.showInFolder(node.path).catch(() => {});
  return wrap;
}
function buildDocxBody(node) {
  const wrap = document.createElement('div'); wrap.className = 'docx-render';
  wrap.innerHTML = '<div style="color:#666;">Loading document…</div>';
  (async () => {
    try {
      const res = await window.api.readFileBinary(node.path);
      if (!res.ok) throw new Error(res.error);
      const buf = b64ToArrayBuffer(res.base64);
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      wrap.innerHTML = result.value || '<i>(empty document)</i>';
      wrap.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        a.removeAttribute('href');
        a.style.cursor = 'pointer';
        a.style.color = '#1a56db';
        a.onclick = (e) => {
          e.preventDefault();
          if (/^https?:\/\//.test(href) || href.startsWith('mailto:')) window.api.openUrl(href);
          else showToast('Link not available: ' + href);
        };
      });
    } catch (err) {
      wrap.className = 'unsupported-note';
      wrap.innerHTML = `
        <div class="aicon">📄</div>
        <div class="un-name">${esc(node.name)}</div>
        <div class="un-meta">Could not preview this Word document: ${esc(err.message)}</div>
        <button class="un-btn" id="unRevealBtnDx">📁 Reveal in file manager</button>`;
      wrap.querySelector('#unRevealBtnDx').onclick = () => window.api.showInFolder(node.path).catch(() => {});
    }
  })();
  return wrap;
}
function buildXlsxBody(node) {
  const wrap = document.createElement('div'); wrap.className = 'xlsx-render';
  wrap.innerHTML = '<div class="empty-hint">Loading spreadsheet…</div>';
  (async () => {
    try {
      const res = await window.api.readFileBinary(node.path);
      if (!res.ok) throw new Error(res.error);
      const data = new Uint8Array(b64ToArrayBuffer(res.base64));
      const workbook = XLSX.read(data, { type: 'array' });
      if (!workbook.SheetNames.length) { wrap.innerHTML = '<div class="empty-hint">No sheets found.</div>'; return; }
      wrap.innerHTML = '';
      const MAX_ROWS = 500;
      const tabs = document.createElement('div'); tabs.className = 'xlsx-tabs';
      const tableWrap = document.createElement('div'); tableWrap.className = 'xlsx-table-wrap';
      const note = document.createElement('div'); note.className = 'xlsx-note';
      function renderSheet(name) {
        const ws = workbook.Sheets[name];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
        const truncated = json.length > MAX_ROWS;
        const rows = truncated ? json.slice(0, MAX_ROWS) : json;
        let html = '<table class="xlsx-table">';
        rows.forEach((row, i) => {
          const tag = i === 0 ? 'th' : 'td';
          html += '<tr>' + row.map(cell => `<${tag}>${esc(cell != null ? String(cell) : '')}</${tag}>`).join('') + '</tr>';
        });
        html += '</table>';
        tableWrap.innerHTML = html;
        note.textContent = truncated ? `Showing first ${MAX_ROWS} of ${json.length} rows.` : `${json.length} rows.`;
      }
      workbook.SheetNames.forEach((name, i) => {
        const tab = document.createElement('div'); tab.className = 'xlsx-tab' + (i === 0 ? ' on' : '');
        tab.textContent = name;
        tab.onclick = () => { tabs.querySelectorAll('.xlsx-tab').forEach(t => t.classList.remove('on')); tab.classList.add('on'); renderSheet(name); };
        tabs.appendChild(tab);
      });
      if (workbook.SheetNames.length > 1) wrap.appendChild(tabs);
      wrap.appendChild(tableWrap);
      wrap.appendChild(note);
      renderSheet(workbook.SheetNames[0]);
    } catch (err) {
      wrap.className = 'unsupported-note';
      wrap.innerHTML = `
        <div class="aicon">📈</div>
        <div class="un-name">${esc(node.name)}</div>
        <div class="un-meta">Could not preview this spreadsheet: ${esc(err.message)}</div>
        <button class="un-btn" id="unRevealBtnXl">📁 Reveal in file manager</button>`;
      wrap.querySelector('#unRevealBtnXl').onclick = () => window.api.showInFolder(node.path).catch(() => {});
    }
  })();
  return wrap;
}

// ── JUPYTER NOTEBOOK RENDERING ──────────────────────────────────────
function buildNotebookBody(node, rawContent) {
  let nb;
  try { nb = JSON.parse(rawContent); }
  catch {
    const d = document.createElement('div'); d.className = 'asset-note';
    d.innerHTML = '<div class="aicon">⚠️</div>Could not parse notebook JSON.';
    return d;
  }
  const wrap = document.createElement('div'); wrap.className = 'nb-wrap';
  const baseDir = node.path.slice(0, node.path.lastIndexOf('/'));
  const cells = nb.cells || [];

  cells.forEach((cell, idx) => {
    const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    const div = document.createElement('div');
    if (cell.cell_type === 'markdown') {
      div.className = 'nb-cell markdown';
      div.innerHTML = `<div class="md-render" style="padding:0;max-width:none;">${mdToHtml(src, baseDir)}</div>`;
    } else if (cell.cell_type === 'code') {
      div.className = 'nb-cell code';
      const execN = cell.execution_count != null ? cell.execution_count : ' ';
      div.innerHTML = `<div class="nb-cell-head">In [${execN}]</div><div class="nb-cell-body"><pre><code class="nb-code-${idx}"></code></pre></div>`;
      const bodyEl = div.querySelector('.nb-cell-body');
      (cell.outputs || []).forEach(out => {
        let outDiv = null;
        if (out.output_type === 'error') {
          outDiv = document.createElement('div'); outDiv.className = 'nb-out err';
          outDiv.textContent = (out.traceback || []).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
        } else if (out.data && out.data['image/png']) {
          outDiv = document.createElement('div'); outDiv.className = 'nb-out-img';
          const img = document.createElement('img');
          img.src = 'data:image/png;base64,' + String(out.data['image/png']).replace(/\n/g, '');
          outDiv.appendChild(img);
        } else if (out.data && out.data['text/plain']) {
          outDiv = document.createElement('div'); outDiv.className = 'nb-out';
          const t = out.data['text/plain'];
          outDiv.textContent = Array.isArray(t) ? t.join('') : t;
        } else if (out.text) {
          outDiv = document.createElement('div'); outDiv.className = 'nb-out';
          outDiv.textContent = Array.isArray(out.text) ? out.text.join('') : out.text;
        }
        if (outDiv) bodyEl.appendChild(outDiv);
      });
    } else {
      div.className = 'nb-cell code';
      div.innerHTML = `<div class="nb-cell-body"><pre>${esc(src)}</pre></div>`;
    }
    wrap.appendChild(div);
  });

  ensureLanguageLoaded('python').then(() => {
    wrap.querySelectorAll('[class^="nb-code-"]').forEach(el => {
      const m = el.className.match(/nb-code-(\d+)/);
      const cellIdx = m ? parseInt(m[1], 10) : -1;
      if (cellIdx < 0 || !cells[cellIdx]) return;
      const src = Array.isArray(cells[cellIdx].source) ? cells[cellIdx].source.join('') : (cells[cellIdx].source || '');
      try {
        if (window.hljs && hljs.getLanguage('python')) { el.innerHTML = hljs.highlight(src, { language: 'python' }).value; el.classList.add('hljs'); }
      } catch {}
    });
  });
  wireMarkdownLinks(wrap, baseDir);
  return wrap;
}

// ── VIEWER ────────────────────────────────────────────────────────
async function openViewer(node, siblingList) {
  ST.curCodeList = siblingList && siblingList.length ? siblingList : [node];
  ST.curIdx = ST.curCodeList.findIndex(n => n.path === node.path);
  if (ST.curIdx === -1) { ST.curCodeList = [node]; ST.curIdx = 0; }
  showScreen('S-view');
  await loadAndRenderCurrent();
}

function updateViewerChrome(node) {
  G('vTitle').innerHTML = `${esc(node.name)} <span class="vpath">— ${esc(relPath(node.path))}</span>`;
  const pill = G('vPill');
  const isCode = node.type === 'code';
  if (isCode) {
    pill.textContent = node.lang; pill.className = 'vpill bg-' + node.color;
  } else {
    const kind = assetKind(node.ext);
    pill.textContent = ASSET_LABELS[kind] || 'File';
    pill.className = 'vpill bg-' + (ASSET_COLORS[kind] || 'subtext0');
  }
  G('vPrev').disabled = ST.curIdx <= 0;
  G('vNext').disabled = ST.curIdx >= ST.curCodeList.length - 1;
  const isStar = !!ST.starred[node.path];
  G('vStar').textContent = isStar ? '★' : '☆';
  G('vStar').classList.toggle('on', isStar);
  const isHtmlFile = node.ext === 'html' || node.ext === 'htm';
  const isSvgFile = node.ext === 'svg';
  const showMdToggle = isCode && (node.hljs === 'markdown' || node.notebook || isHtmlFile || isSvgFile);
  G('vMdToggle').style.display = showMdToggle ? '' : 'none';
  G('vMdToggle').textContent = ST.mdMode === 'render' ? '👁 Render' : '📄 Raw';
  G('vWrap').style.display = isCode ? '' : 'none';
  G('vWrap').classList.toggle('on', ST.wrap);
  G('vCopy').style.display = isCode ? '' : 'none';
}

async function loadAndRenderCurrent() {
  const node = ST.curCodeList[ST.curIdx];
  ST.curNode = node;
  ST.mdMode = (node.hljs === 'markdown' || node.notebook) ? 'render' : 'raw';
  ST.visited[node.path] = true;
  window.api.saveVisited(ST.visited).catch(() => {});
  updateViewerChrome(node);
  G('viewBody').innerHTML = '';

  if (node.type === 'asset') {
    const kind = assetKind(node.ext);
    let body;
    if      (kind === 'image') body = buildImageBody(node);
    else if (kind === 'pdf')   body = buildPdfBody(node);
    else if (kind === 'audio') body = buildAudioBody(node);
    else if (kind === 'video') body = buildVideoBody(node);
    else if (kind === 'font')  body = buildFontBody(node);
    else if (kind === 'docx')  body = buildDocxBody(node);
    else if (kind === 'xlsx')  body = buildXlsxBody(node);
    else                       body = buildUnsupportedBody(node);
    G('viewBody').appendChild(body);
    return;
  }

  G('viewBody').innerHTML = '<div class="empty-hint">Loading…</div>';
  let res;
  try { res = await window.api.readFile(node.path); }
  catch (err) { G('viewBody').innerHTML = `<div class="asset-note"><div class="aicon">⚠️</div>Could not read file: ${esc(err.message)}</div>`; return; }
  if (!res || !res.ok) {
    G('viewBody').innerHTML = `<div class="asset-note"><div class="aicon">⚠️</div>Could not read file${res && res.error ? ': ' + esc(res.error) : ''}.</div>`;
    return;
  }
  ST.curRawContent = res.content;
  ST.curTruncated = res.truncated;
  ST.curSize = res.size;
  rerenderBody();
}

function rerenderBody() {
  const node = ST.curNode;
  const body = G('viewBody'); body.innerHTML = '';
  if (ST.curTruncated) body.appendChild(buildTruncNote(ST.curSize));
  const isHtmlFile = node.ext === 'html' || node.ext === 'htm';
  const isSvgFile = node.ext === 'svg';
  if (node.notebook && ST.mdMode === 'render') body.appendChild(buildNotebookBody(node, ST.curRawContent));
  else if (node.hljs === 'markdown' && ST.mdMode === 'render') body.appendChild(buildMarkdownBody(node, ST.curRawContent));
  else if (isHtmlFile && ST.mdMode === 'render') body.appendChild(buildHtmlPreviewBody(node));
  else if (isSvgFile && ST.mdMode === 'render') body.appendChild(buildSvgPreviewBody(node));
  else body.appendChild(buildCodeBody(node, ST.curRawContent));
}
function buildHtmlPreviewBody(node) {
  const iframe = document.createElement('iframe');
  iframe.className = 'html-preview-frame';
  iframe.src = localFileUrl(node.path);
  iframe.title = node.name;
  return iframe;
}
function buildSvgPreviewBody(node) {
  const wrap = document.createElement('div'); wrap.className = 'asset-media';
  const img = document.createElement('img');
  img.src = localFileUrl(node.path);
  img.alt = node.name;
  img.style.background = '#fff';
  img.style.borderRadius = '8px';
  wrap.appendChild(img);
  return wrap;
}

G('vPrev').onclick = () => { if (ST.curIdx > 0) { ST.curIdx--; loadAndRenderCurrent(); } };
G('vNext').onclick = () => { if (ST.curIdx < ST.curCodeList.length - 1) { ST.curIdx++; loadAndRenderCurrent(); } };
G('vBackBtn').onclick = () => { showScreen('S-browse'); renderBrowse(); };
G('vWrap').onclick = () => { ST.wrap = !ST.wrap; G('vWrap').classList.toggle('on', ST.wrap); rerenderBody(); };
G('vMdToggle').onclick = () => {
  ST.mdMode = ST.mdMode === 'render' ? 'raw' : 'render';
  G('vMdToggle').textContent = ST.mdMode === 'render' ? '👁 Render' : '📄 Raw';
  rerenderBody();
};
G('vCopy').onclick = async () => {
  try { await window.api.copyClip(ST.curRawContent || ''); showToast('Copied to clipboard'); }
  catch { showToast('Copy failed'); }
};
G('vStar').onclick = () => {
  const node = ST.curNode; if (!node) return;
  toggleStar(node.path);
  const on = !!ST.starred[node.path];
  G('vStar').textContent = on ? '★' : '☆';
  G('vStar').classList.toggle('on', on);
};
G('vShowFolder').onclick = () => { if (ST.curNode) window.api.showInFolder(ST.curNode.path).catch(() => {}); };

// ── KEYBOARD ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (G('S-view').classList.contains('vis')) {
    if (e.target.tagName === 'INPUT') return;
    if      (e.key === 'ArrowRight' || e.key === 'n') G('vNext').click();
    else if (e.key === 'ArrowLeft'  || e.key === 'p') G('vPrev').click();
    else if (e.key === 'Escape') G('vBackBtn').click();
    else if (e.key === 'w' || e.key === 'W') { if (ST.curNode && ST.curNode.type === 'code') G('vWrap').click(); }
    else if (e.key === 'f' || e.key === 'F') window.api.winFs();
  } else {
    if (e.key === 'Escape' && document.activeElement === G('searchBar')) {
      G('searchBar').value = ''; G('searchBar').blur(); renderBrowse();
    }
  }
});

// ── RESET ─────────────────────────────────────────────────────────
function reset() {
  ST.rootTree = null; ST.pathStack = []; ST.pathIndex = {};
  ST.curCodeList = []; ST.curIdx = -1; ST.curNode = null;
  G('searchBar').value = '';
  G('crumbBar').innerHTML = '';
  G('itemGrid').innerHTML = ''; G('assetGrid').innerHTML = '';
  G('welcome').classList.remove('hidden');
  showScreen(null);
  loadAndRenderRecent();
}

// ── INIT ──────────────────────────────────────────────────────────
loadAndRenderRecent();
