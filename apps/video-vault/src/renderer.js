// ════════════════════════════════════════════════════════════
// Video Vault — Renderer Process  (reviewed & fixed)
// ════════════════════════════════════════════════════════════

// ── STATE ─────────────────────────────────────────────────────────
const ST = {
  mode:        null,   // 'library' | 'collection'
  library:     [],
  curChannel:  null,
  curVideoKey: null,
  progress:    {},     // { "Channel::videoName": true }
  lastVideo:   {},     // { "Channel": videoName }
  recentPaths: [],
  activeGroup: '__all__',
};

const G = id => document.getElementById(id);

// ── SCREENS ───────────────────────────────────────────────────────
function showScreen(name) {
  ['S-lib','S-ep','S-player'].forEach(id =>
    G(id).classList.toggle('vis', id === name)
  );
  const inLib = name === 'S-lib';
  G('searchBar').style.display = inLib ? '' : 'none';
  G('sortSel').style.display   = inLib ? '' : 'none';
  G('tb-change').style.display = name  ? '' : 'none';
  G('counter').style.display   = inLib ? '' : 'none';
}

// ── TOAST ─────────────────────────────────────────────────────────
let _toastT;
function showToast(msg, ms = 2600) {
  const t = G('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.classList.remove('on'), ms);
}

// ── LOADING ───────────────────────────────────────────────────────
function showLoad(msg) {
  G('dzMain').style.display    = 'none';
  G('loadState').style.display = 'block';
  G('loadMsg').textContent     = msg || 'Loading…';
  G('progFill').style.width    = '5%';
}
function setLoad(pct) { G('progFill').style.width = pct + '%'; }
function hideLoad()   { G('dzMain').style.display = ''; G('loadState').style.display = 'none'; G('welcome').classList.add('hidden'); }
function cancelLoad(msg) {
  G('dzMain').style.display    = '';
  G('loadState').style.display = 'none';
  G('welcome').classList.remove('hidden');
  if (msg) showToast(msg);
}

// ── HTML ESCAPE ───────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── RECENT PATHS ──────────────────────────────────────────────────
async function loadAndRenderRecent() {
  try {
    const raw = await window.api.loadRecent() || [];
    // Normalize: support old format (plain strings) and new format (objects with .path)
    ST.recentPaths = raw
      .map(r => {
        if (typeof r === 'string' && r.length > 0)
          return { path: r, name: r.split('/').filter(Boolean).pop() || r };
        if (r && typeof r.path === 'string' && r.path.length > 0) return r;
        return null;
      })
      .filter(Boolean);
  } catch { ST.recentPaths = []; }
  renderRecent();
}
function renderRecent() {
  const wrap = G('recentPaths'); wrap.innerHTML = '';
  ST.recentPaths.forEach(r => {
    if (!r || typeof r.path !== 'string') return;
    const el = document.createElement('div');
    el.className = 'recent-item';
    el.innerHTML = `
      <span class="recent-icon">📺</span>
      <div class="recent-info">
        <div class="recent-name">${escHtml(r.name || r.path)}</div>
        <div class="recent-path">${escHtml(r.path)}</div>
      </div>
      <span class="recent-arrow">→</span>`;
    el.onclick = () => processPath(r.path);
    wrap.appendChild(el);
  });
}
function addToRecent(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') return;
  const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
  ST.recentPaths = ST.recentPaths.filter(r => r && r.path !== folderPath);
  ST.recentPaths.unshift({ path: folderPath, name, ts: Date.now() });
  ST.recentPaths = ST.recentPaths.slice(0, 3);
  window.api.saveRecent(ST.recentPaths).catch(() => {});
}

// ── WINDOW CONTROLS ───────────────────────────────────────────────
G('wc').onclick        = () => window.api.winClose();
G('wm').onclick        = () => window.api.winMin();
G('wx').onclick        = () => window.api.winMax();
G('tb-fs').onclick     = () => window.api.winFs();
G('tb-change').onclick = reset;
G('pFs').onclick       = () => {
  const wrap = G('videoWrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else wrap.requestFullscreen().catch(() => {});
};

// ── OPEN FOLDER ───────────────────────────────────────────────────
G('openBtn').onclick = openFolderDialog;
async function openFolderDialog() {
  try {
    const p = await window.api.openFolder();
    if (!p || typeof p !== 'string') return;
    processPath(p);
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
  if (!files.length) { showToast('⚠ Drop a folder'); return; }
  for (const f of files) {
    if (f.path && typeof f.path === 'string' && f.path.startsWith('/')) {
      processPath(f.path); return;
    }
    try {
      const p = await window.api.getPathForFile(f);
      if (p && typeof p === 'string' && p.startsWith('/')) { processPath(p); return; }
    } catch {}
  }
  showToast('⚠ Could not read path — use Open Folder button');
});

// ── PROCESS PATH ──────────────────────────────────────────────────
async function processPath(rootPath) {
  if (!rootPath || typeof rootPath !== 'string') { showToast('⚠ Invalid path'); return; }
  showLoad('Scanning video library…'); setLoad(10);
  try { ST.progress = await window.api.loadProgress() || {}; } catch { ST.progress = {}; }

  let result;
  try { result = await window.api.scanRoot(rootPath); setLoad(70); }
  catch (err) { cancelLoad('⚠ Scan error: ' + err.message); return; }

  if (!result || result.mode === 'empty') { cancelLoad('⚠ No video files found'); return; }

  addToRecent(rootPath);
  setLoad(95);
  ST.mode = result.mode;

  if (result.mode === 'library') {
    ST.library = result.channels;
    setLoad(100);
    setTimeout(() => { hideLoad(); buildLibraryUI(); }, 150);
  } else {
    const ch = {
      name:      result.collectionName,
      path:      rootPath,
      thumbPath: result.thumbPath,
      videos:    result.videos,
      groups:    result.groups || [],
      total:     result.total || result.videos.length,
    };
    ST.library = [ch]; ST.curChannel = ch;
    setLoad(100);
    setTimeout(() => { hideLoad(); openVideoList(ch); }, 150);
  }
}

// ── LIBRARY GRID ──────────────────────────────────────────────────
function getSorted() {
  const q = (G('searchBar').value || '').toLowerCase();
  let list = [...ST.library];
  if (q) list = list.filter(ch =>
    ch.name.toLowerCase().includes(q) ||
    ch.videos.some(v => v.displayName.toLowerCase().includes(q))
  );
  const s = G('sortSel').value;
  if (s === 'az')   list.sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  if (s === 'za')   list.sort((a,b) => b.name.localeCompare(a.name,'en',{numeric:true,sensitivity:'base'}));
  if (s === 'most') list.sort((a,b) => b.total - a.total);
  if (s === 'prog') {
    list.sort((a,b) => {
      const wa = a.videos.filter(v => ST.progress[a.name+'::'+v.name]).length;
      const wb = b.videos.filter(v => ST.progress[b.name+'::'+v.name]).length;
      return wb - wa;
    });
  }
  return list;
}

function buildLibraryUI() { renderGrid(); showScreen('S-lib'); }

function renderGrid() {
  const list = getSorted();
  const q    = G('searchBar').value || '';
  G('libLabel').textContent = list.length + (q ? ' (filtered)' : '') + ' Channels';
  G('counter').textContent  = list.length + ' / ' + ST.library.length;
  const grid = G('titleGrid'); grid.innerHTML = '';

  list.forEach(ch => {
    const watched = ch.videos.filter(v => ST.progress[ch.name+'::'+v.name]).length;
    const pct     = ch.total > 0 ? (watched / ch.total * 100).toFixed(0) : 0;

    const card  = document.createElement('div'); card.className = 'tcard';
    const cover = document.createElement('div'); cover.className = 'tcover';

    if (ch.thumbPath) {
      const img = document.createElement('img'); img.className = 'tcover-img';
      img.src = 'file://' + ch.thumbPath; img.loading = 'lazy';
      img.onerror = () => { img.remove(); addChannelPh(cover); };
      cover.appendChild(img);
    } else {
      addChannelPh(cover);
    }

    const badge = document.createElement('div'); badge.className = 'tbadge';
    badge.textContent = '▶ ' + ch.total;
    cover.appendChild(badge);

    const ov = document.createElement('div'); ov.className = 'toverlay';
    ov.innerHTML = '<span>Open ▶</span>';
    cover.appendChild(ov);

    const pb = document.createElement('div'); pb.className = 'tprog';
    const pf = document.createElement('div'); pf.className = 'tprog-f';
    pf.style.width = pct + '%'; pb.appendChild(pf); cover.appendChild(pb);

    const hasGroups = (ch.groups || []).length > 1;
    const info = document.createElement('div'); info.className = 'tinfo';
    info.innerHTML = `
      <div class="tname" title="${escHtml(ch.name)}">${escHtml(ch.name)}</div>
      <div class="tmeta">
        <span class="tmeta-l">${watched}/${ch.total} watched</span>
        <span class="mpill ${hasGroups ? 'has-groups':'flat'}">${hasGroups ? '📁 Playlists':'🎬 Videos'}</span>
      </div>`;

    card.appendChild(cover); card.appendChild(info);
    card.onclick = () => { ST.curChannel = ch; openVideoList(ch); };
    grid.appendChild(card);
  });
}

function addChannelPh(container) {
  const ph = document.createElement('div'); ph.className = 'tcover-ph';
  ph.textContent = '📺';
  container.appendChild(ph);
}

G('searchBar').addEventListener('input',  () => renderGrid());
G('sortSel').addEventListener('change',   () => renderGrid());

// ── VIDEO LIST ────────────────────────────────────────────────────
function openVideoList(ch) {
  ST.curChannel  = ch;
  ST.activeGroup = '__all__';
  G('epTitle').textContent = ch.name;

  const ci = G('epCover');
  if (ch.thumbPath) { ci.src = 'file://' + ch.thumbPath; ci.style.display = ''; }
  else ci.style.display = 'none';

  // Group tabs
  const groupsBar = G('groupsBar'); groupsBar.innerHTML = '';
  const groups = ch.groups || [];
  if (groups.length > 1) {
    groupsBar.style.display = '';
    const mkBtn = (label, grp, on) => {
      const b = document.createElement('button');
      b.className = 'group-btn' + (on ? ' on' : '');
      b.textContent = label; b.dataset.group = grp; b.title = label;
      b.onclick = () => { ST.activeGroup = grp; renderVideoList(ch); setGroupActive(grp); };
      groupsBar.appendChild(b);
    };
    mkBtn('All', '__all__', true);
    groups.forEach(g => mkBtn(g, g, false));
  } else {
    groupsBar.style.display = 'none';
  }

  // Continue banner
  const slot = G('continueSlot'); slot.innerHTML = '';
  const lastKey = ST.lastVideo[ch.name];
  if (lastKey) {
    const lv = ch.videos.find(v => v.name === lastKey);
    if (lv) {
      const b = document.createElement('div'); b.className = 'continue-wrap';
      b.innerHTML = `
        <span class="continue-icon">▶</span>
        <div class="continue-info">
          <div class="continue-lbl">Continue Watching</div>
          <div class="continue-ch">${escHtml(lv.displayName)}</div>
        </div>
        <span class="continue-arrow">→</span>`;
      b.onclick = () => playVideo(lv);
      slot.appendChild(b);
    }
  }

  renderVideoList(ch);
  showScreen('S-ep');
}

function setGroupActive(g) {
  document.querySelectorAll('.group-btn').forEach(b =>
    b.classList.toggle('on', b.dataset.group === g)
  );
}

// ── THUMBNAIL EXTRACTOR ───────────────────────────────────────────
// Queue-based extractor with cache — max 4 concurrent extractions
const thumbCache  = new Map();   // filePath → dataURL | null
const thumbQueue  = [];
let   thumbActive = 0;
const THUMB_MAX   = 4;

function extractVideoThumb(filePath) {
  return new Promise(resolve => {
    if (thumbCache.has(filePath)) { resolve(thumbCache.get(filePath)); return; }
    thumbQueue.push({ filePath, resolve });
    drainThumbQueue();
  });
}

function drainThumbQueue() {
  while (thumbActive < THUMB_MAX && thumbQueue.length > 0) {
    const task = thumbQueue.shift();
    // Check cache again (another task may have filled it while queued)
    if (thumbCache.has(task.filePath)) { task.resolve(thumbCache.get(task.filePath)); continue; }
    thumbActive++;
    doExtract(task.filePath).then(url => {
      thumbCache.set(task.filePath, url);  // store null on failure too (avoid re-attempts)
      task.resolve(url);
      thumbActive--;
      drainThumbQueue();
    });
  }
}

function doExtract(filePath) {
  return new Promise(resolve => {
    let settled = false;
    const done = url => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(url || null);
    };

    const vid = document.createElement('video');
    vid.muted = true; vid.preload = 'metadata'; vid.playsInline = true;
    // Hidden off-screen — never attached to AudioContext
    vid.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(vid);

    const cleanup = () => {
      try { vid.pause(); vid.removeAttribute('src'); vid.load(); document.body.removeChild(vid); } catch {}
    };

    const capture = () => {
      try {
        const c = document.createElement('canvas'); c.width = 480; c.height = 270;
        const ctx = c.getContext('2d', { alpha: false });
        ctx.drawImage(vid, 0, 0, 480, 270);
        // Check if frame is not all-black
        const px = ctx.getImageData(60, 40, 360, 190);
        let bright = 0;
        for (let i = 0; i < px.data.length; i += 4) {
          if (px.data[i] > 15 || px.data[i+1] > 15 || px.data[i+2] > 15) bright++;
        }
        if (bright > 200) done(c.toDataURL('image/jpeg', 0.85));
        else done(null);
      } catch { done(null); }
    };

    vid.addEventListener('loadedmetadata', () => {
      try {
        const t = Math.max(1, (vid.duration || 60) * 0.1);
        vid.currentTime = t;
      } catch { done(null); }
    }, { once: true });

    vid.addEventListener('seeked', capture, { once: true });

    // Fallback: if seeked never fires (some codecs), try after load
    vid.addEventListener('canplay', () => {
      if (!settled) setTimeout(() => { if (!settled) capture(); }, 300);
    }, { once: true });

    vid.addEventListener('error', () => done(null), { once: true });

    // 6-second hard timeout
    setTimeout(() => done(null), 6000);

    vid.src = 'file://' + filePath;
  });
}

// ── RENDER VIDEO LIST ─────────────────────────────────────────────
function renderVideoList(ch) {
  let videos = ch.videos;
  if (ST.activeGroup && ST.activeGroup !== '__all__')
    videos = videos.filter(v => v.group === ST.activeGroup);

  const watched = ch.videos.filter(v => ST.progress[ch.name+'::'+v.name]).length;
  G('epSub').textContent = `${watched}/${ch.total} watched · ${videos.length} showing`;

  const grid = G('epGrid'); grid.innerHTML = '';

  videos.forEach(video => {
    const rid       = ch.name + '::' + video.name;
    const isPlaying = video.name === ST.curVideoKey;
    const isWatched = !!ST.progress[rid];

    const card = document.createElement('div');
    card.className = 'vcard' + (isWatched ? ' watched' : '') + (isPlaying ? ' playing' : '');

    // ── Thumbnail area ──────────────────────────────────────────
    const thumbDiv = document.createElement('div'); thumbDiv.className = 'vc-thumb';

    const thumbImg = document.createElement('img'); thumbImg.className = 'vc-thumb-img';
    thumbImg.style.display = 'none';
    thumbDiv.appendChild(thumbImg);

    // Spinner (removed once extract resolves)
    const loadWrap = document.createElement('div'); loadWrap.className = 'vc-thumb-loading';
    const spinner  = document.createElement('div'); spinner.className  = 'vc-thumb-spinner';
    loadWrap.appendChild(spinner); thumbDiv.appendChild(loadWrap);

    // Fallback placeholder
    const ph = document.createElement('div'); ph.className = 'vc-thumb-ph';
    ph.textContent = '🎬'; ph.style.display = 'none';
    thumbDiv.appendChild(ph);

    // Playing EQ animation OR hover-play button
    if (isPlaying) {
      const eq = document.createElement('div'); eq.className = 'vc-eq-overlay';
      [0,1,2,3].forEach(() => {
        const b = document.createElement('div'); b.className = 'vc-eq-bar';
        eq.appendChild(b);
      });
      thumbDiv.appendChild(eq);
    } else {
      const play = document.createElement('div'); play.className = 'vc-play';
      const btn  = document.createElement('div'); btn.className = 'vc-play-btn';
      btn.textContent = '▶'; play.appendChild(btn);
      thumbDiv.appendChild(play);
    }

    if (isWatched) {
      const dot = document.createElement('div'); dot.className = 'vc-watched-dot';
      thumbDiv.appendChild(dot);
    }

    card.appendChild(thumbDiv);

    // Extract thumb from the video file itself — never from folder image
    let cardAlive = true;
    // If already cached, show immediately without spinner flicker
    if (thumbCache.has(video.filePath)) {
      loadWrap.remove();
      const url = thumbCache.get(video.filePath);
      if (url) {
        thumbImg.src = url;
        thumbImg.style.display = 'block';
      } else {
        ph.style.display = 'flex';
      }
    } else {
      extractVideoThumb(video.filePath).then(url => {
        if (!cardAlive) return; // card was removed from DOM
        loadWrap.remove();
        if (url) {
          thumbImg.src = url;
          thumbImg.onload  = () => { thumbImg.style.display = 'block'; };
          thumbImg.onerror = () => { ph.style.display = 'flex'; };
        } else {
          ph.style.display = 'flex';
        }
      });
    }

    // ── Info area ───────────────────────────────────────────────
    const info = document.createElement('div'); info.className = 'vc-info';
    info.innerHTML = `
      <div class="vc-name" title="${escHtml(video.displayName)}">${escHtml(video.displayName)}</div>
      <div class="vc-meta">
        <span class="vc-group">${escHtml(video.group || '')}</span>
      </div>`;

    card.appendChild(info);
    card.onclick = () => playVideo(video);

    // Mark card as dead when it's replaced (grid.innerHTML = '' in next render)
    const observer = new MutationObserver(() => {
      if (!card.isConnected) { cardAlive = false; observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    grid.appendChild(card);
  });
}

G('epBackBtn').onclick  = () => { if (ST.mode === 'library') { renderGrid(); showScreen('S-lib'); } else reset(); };
G('watchAllBtn').onclick = () => { const v = getVisibleVideos(); if (v.length) playVideo(v[0]); };

function getVisibleVideos() {
  if (!ST.curChannel) return [];
  let v = ST.curChannel.videos;
  if (ST.activeGroup && ST.activeGroup !== '__all__') v = v.filter(x => x.group === ST.activeGroup);
  return v;
}

// ── PLAYER ────────────────────────────────────────────────────────
function getVideoIdx()  { return getVisibleVideos().findIndex(v => v.name === ST.curVideoKey); }
function updateNavBtns() {
  const vids = getVisibleVideos();
  const idx  = getVideoIdx();
  G('pPrev').disabled = idx <= 0;
  G('pNext').disabled = idx < 0 || idx >= vids.length - 1;
}

function stopVideo() {
  const vid = G('mainVideo');
  try { vid.pause(); } catch {}
  Array.from(vid.querySelectorAll('track')).forEach(t => t.remove());
  if (vid._subBlobUrl) { URL.revokeObjectURL(vid._subBlobUrl); vid._subBlobUrl = null; }
  vid.removeAttribute('src');
  vid.load(); // fully abort any pending network request
}

// ── AudioContext — created once, reused across all videos ─────────
// IMPORTANT: must be created AFTER first user gesture (click)
let _audioCtx = null;
let _audioSrc = null; // MediaElementSourceNode — tied to the video element forever

function ensureAudioCtx() {
  const vid = G('mainVideo');
  if (_audioCtx) {
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
    return;
  }
  try {
    _audioCtx = new AudioContext({ latencyHint: 'playback' });
    _audioSrc  = _audioCtx.createMediaElementSource(vid);
    _audioSrc.connect(_audioCtx.destination);
  } catch {
    _audioCtx = null; _audioSrc = null;
  }
}

function playVideo(video) {
  ST.curVideoKey = video.name;
  const ch = ST.curChannel;

  if (ch) {
    ST.progress[ch.name + '::' + video.name] = true;
    ST.lastVideo[ch.name] = video.name;
    window.api.saveProgress(ST.progress).catch(() => {});
  }

  stopVideo();
  updateNavBtns();

  G('pTitle').textContent = (ch?.name ? ch.name + ' — ' : '') + video.displayName;
  G('pPages').textContent = video.group || '—';

  const vid = G('mainVideo');
  vid.volume = vid.volume > 0 ? vid.volume : 1.0;
  vid.src    = 'file://' + video.filePath;

  // Activate AudioContext after user gesture
  ensureAudioCtx();

  // Subtitle
  G('subBar').innerHTML = '';
  if (video.subtitlePath) {
    window.api.loadSubtitle(video.subtitlePath).then(res => {
      if (!res?.ok || !res.vtt) return;
      const blob = new Blob([res.vtt], { type: 'text/vtt' });
      const url  = URL.createObjectURL(blob);
      vid._subBlobUrl = url;
      const trk = document.createElement('track');
      trk.kind = 'subtitles'; trk.label = 'Subtitles';
      trk.srclang = 'ar'; trk.src = url; trk.default = true;
      vid.appendChild(trk);
      vid.addEventListener('loadedmetadata', () => {
        const t = vid.textTracks[0];
        if (t) t.mode = 'showing';
      }, { once: true });
      renderSubBar(video);
    }).catch(() => {});
  }

  vid.play().catch(() => {});

  vid.onerror = () => {
    const err   = vid.error;
    const ext   = (video.filePath.split('.').pop() || '').toUpperCase();
    const CODES = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE (unsupported codec)', 4: 'SRC_NOT_SUPPORTED (format not supported)' };
    const label = err ? (CODES[err.code] || ('code ' + err.code)) : 'unknown';
    showToast('⚠ Cannot play .' + ext + ' file — ' + label, 5000);
    console.error('Video error:', { file: video.filePath, code: err?.code, message: err?.message });
  };

  // Auto-advance to next video
  vid.onended = () => {
    const idx  = getVideoIdx();
    const vids = getVisibleVideos();
    if (idx >= 0 && idx < vids.length - 1)
      setTimeout(() => playVideo(vids[idx + 1]), 800);
  };

  // Update playing indicator without full re-render (preserve thumbnails)
  document.querySelectorAll('.vcard').forEach(c => c.classList.remove('playing'));
  const cards = document.querySelectorAll('.vcard');
  const vids  = getVisibleVideos();
  const idx   = vids.findIndex(v => v.name === video.name);
  if (cards[idx]) cards[idx].classList.add('playing');

  showScreen('S-player');
}

function renderSubBar(video) {
  const bar = G('subBar'); bar.innerHTML = '';
  const lbl = document.createElement('span'); lbl.className = 'sub-label'; lbl.textContent = '◉ SUB:';
  bar.appendChild(lbl);
  const btn = document.createElement('button'); btn.className = 'sub-btn on';
  btn.textContent = video.subtitlePath.split('/').pop();
  btn.title       = video.subtitlePath;
  bar.appendChild(btn);
  const hint = document.createElement('span'); hint.className = 'sub-hint sub-hint-right';
  hint.textContent = 'Space · ←→ seek · ↑↓ vol · F full · M mute · Ctrl+←→ prev/next';
  bar.appendChild(hint);
}

G('pPrev').onclick = () => { const i = getVideoIdx(); if (i > 0) playVideo(getVisibleVideos()[i-1]); };
G('pNext').onclick = () => { const i = getVideoIdx(), v = getVisibleVideos(); if (i >= 0 && i < v.length-1) playVideo(v[i+1]); };
G('pBackBtn').onclick = () => {
  stopVideo(); ST.curVideoKey = null;
  if (ST.curChannel) { renderVideoList(ST.curChannel); showScreen('S-ep'); }
  else if (ST.mode === 'library') { renderGrid(); showScreen('S-lib'); }
  else reset();
};

// ── KEYBOARD ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!G('S-player').classList.contains('vis')) return;
  if (e.target.tagName === 'INPUT') return;
  const vid = G('mainVideo');
  switch (e.key) {
    case ' ':
      e.preventDefault();
      vid.paused ? vid.play().catch(()=>{}) : vid.pause();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) G('pNext').click();
      else vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 10);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) G('pPrev').click();
      else vid.currentTime = Math.max(0, vid.currentTime - 10);
      break;
    case 'ArrowUp':
      e.preventDefault(); vid.volume = Math.min(1, (vid.volume || 0) + 0.1); break;
    case 'ArrowDown':
      e.preventDefault(); vid.volume = Math.max(0, (vid.volume || 1) - 0.1); break;
    case 'Escape':
      if (document.fullscreenElement) document.exitFullscreen();
      else G('pBackBtn').click();
      break;
    case 'f': case 'F': G('pFs').click(); break;
    case 'm': case 'M': vid.muted = !vid.muted; break;
  }
});

// ── RESET ─────────────────────────────────────────────────────────
function reset() {
  ST.mode = null; ST.library = []; ST.curChannel = null;
  ST.curVideoKey = null; ST.activeGroup = '__all__';
  G('searchBar').value = '';
  stopVideo();
  ['S-lib','S-ep','S-player'].forEach(id => G(id).classList.remove('vis'));
  G('welcome').classList.remove('hidden');
  showScreen(null);
  renderRecent();
}

// ── INIT ──────────────────────────────────────────────────────────
loadAndRenderRecent();
