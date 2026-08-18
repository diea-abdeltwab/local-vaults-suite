// ════════════════════════════════════════════════════════════
// Cinema Vault — Renderer Process
// ════════════════════════════════════════════════════════════

// ── STATE ─────────────────────────────────────────────────────────
const ST = {
  mode: null,
  library: [],
  curTitle: null,
  curEpKey: null,
  progress: {},
  lastEp: {},
  recentPaths: [],
  htimer: null,
  activeSeason: null,
  filterType: 'all',
  volume: 1,
  subInterval: null,
  toggleFs: null,
};

// ── DOM ───────────────────────────────────────────────────────────
const G = id => document.getElementById(id);

// ── PATH HELPER ───────────────────────────────────────────────────
const path = { basename: p => p ? p.split('/').filter(Boolean).pop() || p : '' };

// ── SCREENS ───────────────────────────────────────────────────────
function showScreen(name) {
  ['S-lib','S-ep','S-player'].forEach(id =>
    G(id).classList.toggle('vis', id === name)
  );
  const inLib = name === 'S-lib';
  G('searchBar').style.display   = inLib ? '' : 'none';
  G('sortSel').style.display     = inLib ? '' : 'none';
  G('filterRow').style.display   = inLib ? '' : 'none';
  G('tb-change').style.display   = name  ? '' : 'none';
  G('counter').style.display     = inLib ? '' : 'none';
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
  const wrap = G('recentPaths'); wrap.innerHTML = '';
  if (!ST.recentPaths.length) return;
  ST.recentPaths.forEach(r => {
    const el = document.createElement('div');
    el.className = 'recent-item';
    el.innerHTML = `
      <span class="recent-icon">🎬</span>
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
  ST.recentPaths = ST.recentPaths.filter(r => r.path !== folderPath);
  ST.recentPaths.unshift({ path: folderPath, name, ts: Date.now() });
  ST.recentPaths = ST.recentPaths.slice(0, 3);
  window.api.saveRecent(ST.recentPaths).catch(console.error);
}

// ── WINDOW CONTROLS ───────────────────────────────────────────────
G('wc').onclick        = () => window.api.winClose();
G('wm').onclick        = () => window.api.winMin();
G('wx').onclick        = () => window.api.winMax();
G('tb-fs').onclick     = () => window.api.winFs();
G('tb-change').onclick = reset;

// ── OPEN FOLDER ───────────────────────────────────────────────────
G('openBtn').onclick = openFolderDialog;
async function openFolderDialog() {
  try {
    const p = await window.api.openFolder();
    if (p) processPath(p);
  } catch (err) {
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
    cancelLoad('⚠ No video files found in that folder'); return;
  }

  addToRecent(rootPath);
  setLoad(95);
  ST.mode = result.mode;

  if (result.mode === 'library') {
    ST.library = result.titles;
    setLoad(100);
    setTimeout(() => { hideLoad(); buildLibraryUI(); }, 150);
  } else if (result.mode === 'title') {
    const title = {
      name: result.titleName,
      path: rootPath,
      posterPath: result.posterPath,
      type: result.type,
      episodes: result.episodes,
      seasons: result.seasons || [],
    };
    ST.library = [title]; ST.curTitle = title;
    setLoad(100);
    setTimeout(() => { hideLoad(); openEpList(title); }, 150);
  }
}

// ── LIBRARY UI ───────────────────────────────────────────────────
function watchCount(title) {
  return title.episodes.filter(ep => ST.progress[title.name + '::' + ep.name]).length;
}
function getSorted() {
  const q  = (G('searchBar').value || '').toLowerCase();
  const ft = ST.filterType;
  let list = [...ST.library];
  if (q)          list = list.filter(t => t.name.toLowerCase().includes(q));
  if (ft !== 'all') list = list.filter(t => {
    if (ft === 'movie')  return t.type === 'movie';
    if (ft === 'series') return t.type === 'series';
    // 'anime' — no explicit type set; user tags manually later
    return true;
  });
  const s = G('sortSel').value;
  if (s === 'az')   list.sort((a,b) => a.name.localeCompare(b.name));
  if (s === 'za')   list.sort((a,b) => b.name.localeCompare(a.name));
  if (s === 'most') list.sort((a,b) => watchCount(b) - watchCount(a));
  if (s === 'prog') list.sort((a,b) => {
    const pa = a.episodes.length ? watchCount(a)/a.episodes.length : 0;
    const pb = b.episodes.length ? watchCount(b)/b.episodes.length : 0;
    return pb - pa;
  });
  return list;
}
function buildLibraryUI() {
  renderGrid();
  showScreen('S-lib');
}
function renderGrid() {
  const list = getSorted();
  const q = G('searchBar').value || '';
  G('libLabel').textContent = list.length + (q ? ' (filtered)' : '') + ' Titles';
  G('counter').textContent  = list.length + ' / ' + ST.library.length;
  const grid = G('titleGrid'); grid.innerHTML = '';
  list.forEach(title => {
    const total   = title.episodes.length;
    const wn      = watchCount(title);
    const pct     = total ? Math.round(wn / total * 100) : 0;
    const allDone = wn === total && total > 0;
    const card    = document.createElement('div'); card.className = 'tcard';

    const cover = document.createElement('div'); cover.className = 'tcover';
    if (title.posterPath) {
      const img = document.createElement('img'); img.className = 'tcover-img';
      img.src = 'file://' + title.posterPath; img.loading = 'lazy';
      img.onerror = () => showPh();
      cover.appendChild(img);
    } else { showPh(); }
    function showPh() {
      const ph = document.createElement('div'); ph.className = 'tcover-ph';
      ph.textContent = (title.name.replace(/[^a-zA-Z0-9]/g,'').slice(0,3)||'?').toUpperCase();
      cover.appendChild(ph);
    }
    // type badge
    const badge = document.createElement('div'); badge.className = 'tbadge';
    badge.textContent = title.type === 'movie' ? '🎬 FILM' : (total > 1 ? '📺 ' + total + ' ep' : '📺 SERIES');
    cover.appendChild(badge);
    const ov = document.createElement('div'); ov.className = 'toverlay';
    ov.innerHTML = '<span>' + (title.type === 'movie' ? 'Watch ▶' : 'Open →') + '</span>';
    cover.appendChild(ov);
    const pb = document.createElement('div'); pb.className = 'tprog';
    const pf = document.createElement('div'); pf.className = 'tprog-f'; pf.style.width = pct + '%';
    pb.appendChild(pf); cover.appendChild(pb);

    const info = document.createElement('div'); info.className = 'tinfo';
    const pc = allDone ? 'done' : wn > 0 ? 'wip' : 'fresh';
    const pl = allDone ? '✓ Done' : wn > 0 ? pct + '%' : 'New';
    info.innerHTML = `
      <div class="tname" title="${title.name}">${title.name}</div>
      <div class="tmeta">
        <span class="tmeta-l">${wn}/${total} watched</span>
        <span class="mpill ${pc}">${pl}</span>
      </div>`;
    card.appendChild(cover); card.appendChild(info);
    card.onclick = () => {
      ST.curTitle = title;
      // Movies always play directly; series open episode list
      if (title.type === 'movie') {
        playEpisode(title.episodes[0]);
      } else {
        openEpList(title);
      }
    };
    grid.appendChild(card);
  });
}

G('searchBar').addEventListener('input',  () => renderGrid());
G('sortSel').addEventListener('change',   () => renderGrid());
G('filterRow').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  ST.filterType = btn.dataset.type;
  renderGrid();
});

// ── EPISODE LIST ─────────────────────────────────────────────────
function openEpList(title) {
  ST.curTitle = title;
  const total = title.episodes.length;
  const wn    = watchCount(title);
  const pct   = total ? Math.round(wn / total * 100) : 0;
  G('epTitle').textContent = title.name;
  G('epSub').textContent   = `${total} episode${total!==1?'s':''} · ${wn} watched · ${pct}%`;
  const ci = G('epCover');
  if (title.posterPath) { ci.src = 'file://' + title.posterPath; ci.style.display = ''; }
  else ci.style.display = 'none';

  // Season tabs
  const seasonsBar = G('seasonsBar');
  seasonsBar.innerHTML = '';
  const seasons = title.seasons || [];
  if (seasons.length > 1) {
    seasonsBar.style.display = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'season-btn' + (!ST.activeSeason || ST.activeSeason === '__all__' ? ' on' : '');
    allBtn.textContent = 'All'; allBtn.dataset.season = '__all__';
    allBtn.onclick = () => { ST.activeSeason = '__all__'; renderEpisodeGrid(title); setSeasonBtnActive('__all__'); };
    seasonsBar.appendChild(allBtn);
    seasons.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'season-btn' + (ST.activeSeason === s ? ' on' : '');
      btn.textContent = s; btn.dataset.season = s;
      btn.onclick = () => { ST.activeSeason = s; renderEpisodeGrid(title); setSeasonBtnActive(s); };
      seasonsBar.appendChild(btn);
    });
  } else {
    seasonsBar.style.display = 'none';
    ST.activeSeason = '__all__';
  }

  // Continue banner
  const slot = G('continueSlot'); slot.innerHTML = '';
  const lastKey = ST.lastEp[title.name];
  if (lastKey) {
    const lastEp = title.episodes.find(e => e.name === lastKey);
    if (lastEp) {
      const b = document.createElement('div'); b.className = 'continue-wrap';
      b.innerHTML = `
        <span class="continue-icon">▶</span>
        <div class="continue-info">
          <div class="continue-lbl">Continue Watching</div>
          <div class="continue-ch">${fmtEpName(lastEp)}</div>
        </div>
        <span class="continue-arrow">→</span>`;
      b.onclick = () => playEpisode(lastEp);
      slot.appendChild(b);
    }
  }

  renderEpisodeGrid(title);
  showScreen('S-ep');
}

function setSeasonBtnActive(s) {
  document.querySelectorAll('.season-btn').forEach(b =>
    b.classList.toggle('on', b.dataset.season === s)
  );
}

function fmtEpName(ep) {
  if (ep.season) return ep.season + ' · ' + ep.name.replace(/\.[^.]+$/, '');
  return ep.name.replace(/\.[^.]+$/, '');
}

function renderEpisodeGrid(title) {
  const lastKey = ST.lastEp[title.name];
  let episodes  = title.episodes;
  if (ST.activeSeason && ST.activeSeason !== '__all__') {
    episodes = episodes.filter(e => e.season === ST.activeSeason);
  }
  const grid = G('epGrid'); grid.innerHTML = '';

  // Card mode only when the episode lives in its OWN subfolder (not flat in title dir)
  // i.e. ep.dir !== title.path
  const titlePath = title.path || '';
  const hasPoster = episodes.some(e => e.epPoster && e.dir !== titlePath);

  episodes.forEach((ep, idx) => {
    const rid    = title.name + '::' + ep.name;
    const isRead = !!ST.progress[rid];
    const isCur  = ep.name === lastKey;

    // Clean display name: prefer dirName (subfolder), fallback to filename without ext
    const displayName = (ep.dirName && ep.dirName !== path.basename(title.path || ''))
      ? ep.dirName
      : ep.name.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ').trim();

    const el = document.createElement('div');

    if (hasPoster && ep.epPoster && ep.dir !== titlePath) {
      // ── Card mode with poster image ────────────────────────────
      el.className = 'ei-card' + (isRead ? ' watched' : '') + (isCur ? ' cur' : '');
      el.innerHTML = `
        ${isRead ? '<div class="ei-dot"></div>' : ''}
        ${isCur  ? '<div class="ei-curdot"></div>' : ''}
        <div class="ei-card-img" style="background-image:url('file://${ep.epPoster.replace(/'/g,"\\'")}')"></div>
        <div class="ei-card-label">${displayName}</div>`;
    } else {
      // ── Compact pill mode ──────────────────────────────────────
      el.className = 'ei' + (isRead ? ' watched' : '') + (isCur ? ' cur' : '');
      const subLabel = ep.season || (title.type === 'movie' ? '🎬' : `#${ep.num || idx+1}`);
      el.innerHTML = `
        ${isRead ? '<div class="ei-dot"></div>' : ''}
        ${isCur  ? '<div class="ei-curdot"></div>' : ''}
        <div class="ei-num">${displayName}</div>
        <div class="ei-pg">${subLabel}</div>`;
    }

    el.onclick = () => playEpisode(ep);
    grid.appendChild(el);
  });
}

G('epBackBtn').onclick = () => {
  if (ST.mode === 'library') { renderGrid(); showScreen('S-lib'); }
  else reset();
};
G('watchAllBtn').onclick = () => {
  if (ST.curTitle?.episodes?.length) playEpisode(ST.curTitle.episodes[0]);
};

// ── PLAYER ────────────────────────────────────────────────────────
function getEpIdx() {
  if (!ST.curTitle) return -1;
  return ST.curTitle.episodes.findIndex(e => e.name === ST.curEpKey);
}
function updateNavBtns() {
  const idx = getEpIdx();
  G('pPrev').disabled = idx <= 0;
  G('pNext').disabled = !ST.curTitle || idx >= ST.curTitle.episodes.length - 1;
}

function playEpisode(ep) {
  // Clear any previous subtitle interval
  clearInterval(ST.subInterval);
  ST.subInterval = null;

  ST.curEpKey = ep.name;
  const title = ST.curTitle;
  if (title) {
    ST.progress[title.name + '::' + ep.name] = true;
    ST.lastEp[title.name] = ep.name;
    window.api.saveProgress(ST.progress).catch(console.error);
  }
  updateNavBtns();

  G('pTitle').textContent = (title?.name || '') + ' — ' + ep.name.replace(/\.[^.]+$/,'');
  G('pPages').textContent = ep.season || '—';

  const pscroll = G('pScroll');
  pscroll.innerHTML = '';
  pscroll.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;background:#000;';

  // ── Video wrapper ──────────────────────────────────────────
  const videoWrap = document.createElement('div');
  videoWrap.className = 'video-wrap';
  videoWrap.style.cssText = 'flex:1;min-height:0;position:relative;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;';

  const video = document.createElement('video');
  video.src      = 'file://' + ep.filePath;
  video.controls = true;
  video.autoplay = true;
  video.preload  = 'auto';          // preload full video metadata + buffer
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;';

  // ── Subtitle overlay ───────────────────────────────────────
  const subs = ep.subtitles || [];
  let activeCues  = [];
  // use ST.subInterval (global) so pNext/pPrev clears it automatically

  const subOverlay = document.createElement('div');
  subOverlay.className = 'sub-ol';
  subOverlay.style.cssText = [
    'position:absolute','bottom:56px','left:50%',
    'transform:translateX(-50%)',
    'width:88%','max-width:920px',
    'text-align:center','pointer-events:none','z-index:10',
    'font-size:1.9rem','font-weight:600','line-height:1.6',
    'letter-spacing:.01em',
    'color:#fff',
    'text-shadow:0 0 10px #000,0 2px 6px #000,0 -2px 6px #000,3px 0 6px #000,-3px 0 6px #000',
  ].join(';');
  // Prevent the video element's built-in arrow key seek (5s default)
  // so our keyboard handler (10s) is the only one that fires
  video.addEventListener('keydown', e => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  videoWrap.appendChild(subOverlay);
  videoWrap.appendChild(video);
  pscroll.appendChild(videoWrap);
  pscroll._videoWrap = videoWrap; // store ref for cleanup

  video.addEventListener('dblclick', e => {
    e.stopPropagation();
    if (!document.fullscreenElement) videoWrap.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  });

  function isArabic(text) { return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text); }

  function renderSubAt(t) {
    const cue = activeCues.find(c => t >= c.start && t <= c.end);
    if (!cue) { subOverlay.innerHTML = ''; return; }
    const arabic = isArabic(cue.text);
    subOverlay.dataset.arabic = arabic ? '1' : '0';
    const isFs = !!document.fullscreenElement;
    subOverlay.style.fontFamily = arabic
      ? '"Noto Sans Arabic","Segoe UI","Arial","Tahoma",sans-serif'
      : '"Bebas Neue","JetBrains Mono",sans-serif';
    subOverlay.style.direction = arabic ? 'rtl' : 'ltr';
    subOverlay.style.fontSize  = isFs
      ? (arabic ? '2rem' : '2.2rem')
      : (arabic ? '1.7rem' : '1.9rem');
    subOverlay.innerHTML = cue.text.split('\n').map(l =>
      `<div style="background:rgba(0,0,0,.6);display:inline-block;padding:4px 18px;border-radius:6px;margin:3px 0">${l}</div>`
    ).join('<br>');
  }

  function loadSubtitle(vttUri) {
    activeCues = [];
    subOverlay.innerHTML = '';
    if (!vttUri) return;
    try {
      const content = decodeURIComponent(vttUri.replace('data:text/vtt;charset=utf-8,',''));
      activeCues = parseVttCues(content);
    } catch {}
  }

  // ── Volume: simple and reliable ───────────────────────────
  video.volume = Math.min(1, Math.max(0, ST.volume ?? 1));
  video.addEventListener('volumechange', () => { ST.volume = video.volume; });

  // ── Subtitle + auto-progress + auto-next ──────────────────
  video.addEventListener('play',   () => { clearInterval(ST.subInterval); ST.subInterval = setInterval(() => renderSubAt(video.currentTime), 80); });
  video.addEventListener('pause',  () => clearInterval(ST.subInterval));
  video.addEventListener('seeked', () => renderSubAt(video.currentTime));
  video.addEventListener('ended',  () => {
    clearInterval(ST.subInterval); ST.subInterval = null; subOverlay.innerHTML = '';
    // Auto-next for series / auto-back for movies
    const idx = getEpIdx();
    if (ST.curTitle?.type !== 'movie' && idx >= 0 && idx < ST.curTitle.episodes.length - 1) {
      setTimeout(() => playEpisode(ST.curTitle.episodes[idx + 1]), 1500);
    } else if (ST.curTitle?.type === 'movie') {
      setTimeout(() => G('pBackBtn').click(), 2000);
    }
  });

  // Mark 90% watched
  video.addEventListener('timeupdate', () => {
    if (video.duration && video.currentTime / video.duration > 0.9 && title) {
      const key = title.name + '::' + ep.name;
      if (!ST.progress[key]) {
        ST.progress[key] = true;
        window.api.saveProgress(ST.progress).catch(console.error);
        renderEpisodeGrid(title);
      }
    }
  });

  // ── Fullscreen: always use videoWrap so overlay stays ─────────
  ST.toggleFs = function() {
    if (!document.fullscreenElement) {
      videoWrap.requestFullscreen().catch(err => console.warn('FS error:', err));
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  G('pFs').onclick = ST.toggleFs;

  videoWrap.addEventListener('dblclick', () => ST.toggleFs && ST.toggleFs());

  function handleFsChange() {
    const isFs = document.fullscreenElement === videoWrap;
    subOverlay.style.bottom = isFs ? '64px' : '56px';
    const fsBtn = G('pFs'); if (fsBtn) fsBtn.textContent = isFs ? '⊠' : '⛶';
    renderSubAt(video.currentTime);
  }
  document.addEventListener('fullscreenchange', handleFsChange);
  videoWrap._cleanupFs = () => {
    document.removeEventListener('fullscreenchange', handleFsChange);
    ST.toggleFs = null;
  };

  // ── Subtitle + controls bar ────────────────────────────────
  const subBar = G('subBar');
  subBar.innerHTML = '';
  const toolbar = document.createElement('div');
  toolbar.className = 'sub-toolbar';

  // Load all subs async
  const subVttUris = new Array(subs.length).fill(null);

  if (subs.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'sub-hint';
    hint.textContent = 'No subtitles';
    toolbar.appendChild(hint);
  } else {
    const subLabel = document.createElement('span');
    subLabel.className = 'sub-label'; subLabel.textContent = '💬 Subtitles:';
    toolbar.appendChild(subLabel);

    const subSel = document.createElement('select');
    subSel.className = 'sub-select';

    // Off option
    const offOpt = document.createElement('option');
    offOpt.value = '-1'; offOpt.textContent = '— Off —';
    subSel.appendChild(offOpt);

    subs.forEach((sub, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = sub.name.replace(/\.[^.]+$/, '');
      subSel.appendChild(opt);
    });

    // Auto-select first sub once loaded
    Promise.all(
      subs.map((sub, idx) =>
        window.api.toVtt(sub.filePath)
          .then(uri => { subVttUris[idx] = uri; })
          .catch(() => {})
      )
    ).then(() => {
      if (subVttUris[0]) {
        subSel.value = '0';
        loadSubtitle(subVttUris[0]);
        renderSubAt(video.currentTime);
      }
    });

    subSel.onchange = () => {
      const idx = parseInt(subSel.value);
      if (idx === -1) {
        loadSubtitle(null);
      } else {
        loadSubtitle(subVttUris[idx]);
        renderSubAt(video.currentTime);
        if (!video.paused) {
          clearInterval(ST.subInterval);
          ST.subInterval = setInterval(() => renderSubAt(video.currentTime), 80);
        }
      }
    };

    toolbar.appendChild(subSel);
  }

  // ── Volume control ─────────────────────────────────────────
  const volWrap = document.createElement('div');
  volWrap.style.cssText = 'display:flex;align-items:center;gap:7px;margin-left:auto;flex-shrink:0;';

  const volIcon = document.createElement('span');
  volIcon.id = 'volIcon';
  volIcon.style.cssText = 'font-size:.9rem;cursor:pointer;user-select:none;';
  volIcon.textContent = video.volume === 0 ? '🔇' : video.volume < 0.5 ? '🔉' : '🔊';
  volIcon.onclick = () => {
    if (video.volume > 0) {
      ST.volume = video.volume; // save before muting
      video.volume = 0;
      video.muted  = true;
      volSlider.value = 0;
    } else {
      const restore = ST.volume > 0 ? ST.volume : 1;
      video.volume = restore;
      video.muted  = false;
      volSlider.value = Math.round(restore * 100);
    }
    updateSliderFill(volSlider.value);
    volPct.textContent = volSlider.value + '%';
    volIcon.textContent = video.volume === 0 ? '🔇' : video.volume < 0.5 ? '🔉' : '🔊';
  };

  const volSlider = document.createElement('input');
  volSlider.type = 'range'; volSlider.id = 'volSlider';
  volSlider.min = 0; volSlider.max = 100;
  volSlider.value = Math.round(video.volume * 100);
  volSlider.className = 'vol-slider';
  const updateSliderFill = (val) => volSlider.style.setProperty('--val', val + '%');
  updateSliderFill(volSlider.value);
  volSlider.oninput = () => {
    video.volume = volSlider.value / 100;
    video.muted  = volSlider.value == 0;
    updateSliderFill(volSlider.value);
    volPct.textContent = volSlider.value + '%';
    volIcon.textContent = +volSlider.value === 0 ? '🔇' : +volSlider.value < 50 ? '🔉' : '🔊';
  };

  const volPct = document.createElement('span');
  volPct.style.cssText = 'font-size:.65rem;color:var(--overlay1);min-width:32px;';
  volPct.textContent = Math.round(video.volume * 100) + '%';

  volWrap.appendChild(volIcon);
  volWrap.appendChild(volSlider);
  volWrap.appendChild(volPct);
  toolbar.appendChild(volWrap);

  subBar.appendChild(toolbar);

  G('pbar').classList.remove('hide');
  showScreen('S-player');
}

// Parse a VTT string into [{start, end, text}] cue objects
function parseVttCues(vtt) {
  const cues = [];
  // Normalize line endings, then split on blank lines
  const normalized = vtt.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const blocks = normalized.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    // Find timing line — supports H:MM:SS, HH:MM:SS, MM:SS with . or ,
    const tIdx = lines.findIndex(l => /\d+:\d{2}[:.]\d{2}.*-->/.test(l));
    if (tIdx < 0) continue;
    const timeLine = lines[tIdx];
    // Flexible regex: optional hours, comma or dot as ms separator
    const m = timeLine.match(
      /(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/
    );
    if (!m) continue;
    const text = lines.slice(tIdx + 1).join('\n')
      .replace(/<[^>]*>/g, '')    // strip VTT/HTML tags like <i>, <c.color>
      .replace(/\{[^}]*\}/g, '')  // strip ASS inline tags
      .replace(/^- /gm, '')       // strip leading dashes
      .trim();
    if (!text) continue;
    cues.push({ start: vttTimeToSec(m[1]), end: vttTimeToSec(m[2]), text });
  }
  return cues;
}

function vttTimeToSec(t) {
  // Handles: H:MM:SS.mmm  HH:MM:SS,mmm  MM:SS.mmm
  const clean = t.replace(',','.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
}

G('pPrev').onclick = () => {
  const idx = getEpIdx();
  if (idx > 0) playEpisode(ST.curTitle.episodes[idx - 1]);
};
G('pNext').onclick = () => {
  const idx = getEpIdx();
  if (ST.curTitle && idx >= 0 && idx < ST.curTitle.episodes.length - 1)
    playEpisode(ST.curTitle.episodes[idx + 1]);
};
G('pBackBtn').onclick = () => {
  clearInterval(ST.subInterval); ST.subInterval = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const pscroll = G('pScroll');
  if (pscroll._videoWrap?._cleanupFs) pscroll._videoWrap._cleanupFs();
  const v = pscroll.querySelector('video');
  if (v) { v.pause(); v.src = ''; }
  const subBar = G('subBar'); if (subBar) subBar.innerHTML = '';
  if (ST.curTitle?.type === 'movie') {
    if (ST.mode === 'library') { renderGrid(); showScreen('S-lib'); }
    else reset();
  } else if (ST.curTitle) {
    openEpList(ST.curTitle);
  } else if (ST.mode === 'library') {
    renderGrid(); showScreen('S-lib');
  } else {
    reset();
  }
};

// ── KEYBOARD ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!G('S-player').classList.contains('vis')) return;
  if (e.target.tagName === 'INPUT') return;
  const v = G('pScroll').querySelector('video');
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      e.stopPropagation();
      if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      e.stopPropagation();
      if (v) v.currentTime = Math.max(0, v.currentTime - 10);
      break;
    case ' ':
      e.preventDefault();
      if (v) v.paused ? v.play() : v.pause();
      break;
    case 'f': case 'F':
      e.preventDefault();
      if (ST.toggleFs) ST.toggleFs();
      break;
    case 'm': case 'M':
      if (v) { v.muted = !v.muted; }
      break;
    case 'Escape':
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else G('pBackBtn').click();
      break;
  }
});

// ── RESET ─────────────────────────────────────────────────────────
function reset() {
  clearInterval(ST.subInterval); ST.subInterval = null;
  ST.mode = null; ST.library = []; ST.curTitle = null; ST.curEpKey = null;
  G('searchBar').value = '';
  const v = G('pScroll')?.querySelector('video');
  if (v) { v.pause(); v.src = ''; }
  ['S-lib','S-ep','S-player'].forEach(id => G(id).classList.remove('vis'));
  G('welcome').classList.remove('hidden');
  showScreen(null);
  renderRecent();
}

// ── INIT ──────────────────────────────────────────────────────────
loadAndRenderRecent();
