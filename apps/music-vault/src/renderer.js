// ════════════════════════════════════════════════════════════
// Music Vault — Renderer Process
// ════════════════════════════════════════════════════════════

// ── STATE ─────────────────────────────────────────────────────────
const ST = {
  mode:        null,   // 'library' | 'collection'
  library:     [],     // [{name, path, coverPath, tracks, albums, totalAudio, totalClips}]
  curArtist:   null,
  curTrackKey: null,
  progress:    {},     // { "Artist::trackName": true }
  lastTrack:   {},     // { "Artist": trackName }
  recentPaths: [],
  activeSeason: '__all__',
  filterType:  'all',  // 'all' | 'audio' | 'clip'
};

// ── DOM ───────────────────────────────────────────────────────────
const G = id => document.getElementById(id);

// ── SCREENS ───────────────────────────────────────────────────────
function showScreen(name) {
  ['S-lib','S-ep','S-player'].forEach(id =>
    G(id).classList.toggle('vis', id === name)
  );
  const inLib = name === 'S-lib';
  G('searchBar').style.display = inLib ? '' : 'none';
  G('sortSel').style.display   = inLib ? '' : 'none';
  G('filterRow').style.display = inLib ? '' : 'none';
  G('tb-change').style.display = name  ? '' : 'none';
  G('counter').style.display   = inLib ? '' : 'none';
}

// ── TOAST ─────────────────────────────────────────────────────────
let toastT;
function showToast(msg, ms = 2400) {
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
  ST.recentPaths.forEach(r => {
    const el = document.createElement('div');
    el.className = 'recent-item';
    el.innerHTML = `
      <span class="recent-icon">🎵</span>
      <div class="recent-info">
        <div class="recent-name">${escHtml(r.name)}</div>
        <div class="recent-path">${escHtml(r.path)}</div>
      </div>
      <span class="recent-arrow">→</span>`;
    el.onclick = () => processPath(r.path);
    wrap.appendChild(el);
  });
}
function addToRecent(folderPath) {
  const name = folderPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || folderPath;
  ST.recentPaths = ST.recentPaths.filter(r => r.path !== folderPath);
  ST.recentPaths.unshift({ path: folderPath, name, ts: Date.now() });
  ST.recentPaths = ST.recentPaths.slice(0, 3);
  window.api.saveRecent(ST.recentPaths).catch(() => {});
}

// ── ESCAPE HTML (XSS safety for filenames) ───────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  showLoad('Scanning music library…'); setLoad(10);
  try { ST.progress = await window.api.loadProgress() || {}; }
  catch { ST.progress = {}; }

  let result;
  try { result = await window.api.scanRoot(rootPath); setLoad(70); }
  catch (err) { cancelLoad('⚠ Scan error: ' + err.message); return; }

  if (!result || result.mode === 'empty') {
    cancelLoad('⚠ No audio or video files found in that folder'); return;
  }

  addToRecent(rootPath);
  setLoad(95);
  ST.mode = result.mode;

  if (result.mode === 'library') {
    ST.library = result.artists;
    setLoad(100);
    setTimeout(() => { hideLoad(); buildLibraryUI(); }, 150);
  } else if (result.mode === 'collection') {
    const artist = {
      name:       result.collectionName,
      path:       rootPath,
      coverPath:  result.coverPath,
      tracks:     result.tracks,
      albums:     result.albums || [],
      totalAudio: result.totalAudio || 0,
      totalClips: result.totalClips || 0,
    };
    ST.library = [artist]; ST.curArtist = artist;
    setLoad(100);
    setTimeout(() => { hideLoad(); openTrackList(artist); }, 150);
  }
}

// ── LIBRARY UI ───────────────────────────────────────────────────
function getSorted() {
  const q  = (G('searchBar').value || '').toLowerCase();
  const ft = ST.filterType;
  let list = [...ST.library];

  if (q) list = list.filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.tracks.some(t => t.displayName.toLowerCase().includes(q))
  );
  if (ft === 'audio') list = list.filter(a => a.totalAudio > 0);
  if (ft === 'clip')  list = list.filter(a => a.totalClips  > 0);

  const s = G('sortSel').value;
  if (s === 'az')   list.sort((a,b) => a.name.localeCompare(b.name));
  if (s === 'za')   list.sort((a,b) => b.name.localeCompare(a.name));
  if (s === 'most') list.sort((a,b) => b.tracks.length - a.tracks.length);
  return list;
}

function buildLibraryUI() { renderGrid(); showScreen('S-lib'); }

function renderGrid() {
  const list = getSorted();
  const q    = G('searchBar').value || '';
  G('libLabel').textContent = list.length + (q ? ' (filtered)' : '') + ' Artists';
  G('counter').textContent  = list.length + ' / ' + ST.library.length;
  const grid = G('titleGrid'); grid.innerHTML = '';

  list.forEach(artist => {
    const total = artist.tracks.length;
    const card  = document.createElement('div'); card.className = 'tcard';

    // Cover
    const cover = document.createElement('div'); cover.className = 'tcover';
    if (artist.coverPath) {
      const img = document.createElement('img'); img.className = 'tcover-img';
      img.src = 'file://' + artist.coverPath; img.loading = 'lazy';
      img.onerror = () => { img.remove(); addPh(cover, artist.name); };
      cover.appendChild(img);
    } else {
      addPh(cover, artist.name);
    }

    // Badge
    const badge = document.createElement('div'); badge.className = 'tbadge';
    if (artist.totalClips > 0 && artist.totalAudio > 0)
      badge.textContent = `♪ ${artist.totalAudio}  🎬 ${artist.totalClips}`;
    else if (artist.totalClips > 0)
      badge.textContent = `🎬 ${artist.totalClips} clips`;
    else
      badge.textContent = `♪ ${artist.totalAudio} tracks`;
    cover.appendChild(badge);

    const ov = document.createElement('div'); ov.className = 'toverlay';
    ov.innerHTML = '<span>Play ▶</span>';
    cover.appendChild(ov);

    const pb = document.createElement('div'); pb.className = 'tprog';
    const pf = document.createElement('div'); pf.className = 'tprog-f';
    pf.style.width = '0%'; pb.appendChild(pf); cover.appendChild(pb);

    // Info
    const info = document.createElement('div'); info.className = 'tinfo';
    const pillClass = artist.totalClips > 0 ? 'has-clips' : 'audio-only';
    const pillLabel = artist.totalClips > 0 ? '🎬 Mixed'  : '🎵 Audio';
    info.innerHTML = `
      <div class="tname" title="${escHtml(artist.name)}">${escHtml(artist.name)}</div>
      <div class="tmeta">
        <span class="tmeta-l">${total} tracks</span>
        <span class="mpill ${pillClass}">${pillLabel}</span>
      </div>`;

    card.appendChild(cover); card.appendChild(info);
    card.onclick = () => { ST.curArtist = artist; openTrackList(artist); };
    grid.appendChild(card);
  });
}

// Fix 2: addPh is a standalone function, not declared inside a loop
function addPh(container, name) {
  const ph = document.createElement('div'); ph.className = 'tcover-ph';
  ph.textContent = (name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g,'').slice(0,2) || '♪').toUpperCase();
  container.appendChild(ph);
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

// ── TRACK LIST ────────────────────────────────────────────────────
function openTrackList(artist) {
  ST.curArtist  = artist;
  ST.activeSeason = '__all__'; // Fix 5: reset season on new artist
  G('epTitle').textContent = artist.name;
  G('epSub').textContent   = `${artist.totalAudio} sounds · ${artist.totalClips} clips`;

  const ci = G('epCover');
  if (artist.coverPath) { ci.src = 'file://' + artist.coverPath; ci.style.display = ''; }
  else ci.style.display = 'none';

  // Album tabs
  const seasonsBar = G('seasonsBar'); seasonsBar.innerHTML = '';
  const albums = artist.albums || [];
  if (albums.length > 1) {
    seasonsBar.style.display = '';
    const allBtn = document.createElement('button');
    allBtn.className   = 'season-btn on';
    allBtn.textContent = 'All';
    allBtn.dataset.season = '__all__';
    allBtn.onclick = () => { ST.activeSeason = '__all__'; renderTrackList(artist); setSeasonActive('__all__'); };
    seasonsBar.appendChild(allBtn);
    albums.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'season-btn'; btn.textContent = a; btn.dataset.season = a;
      btn.onclick = () => { ST.activeSeason = a; renderTrackList(artist); setSeasonActive(a); };
      seasonsBar.appendChild(btn);
    });
  } else {
    seasonsBar.style.display = 'none';
  }

  // Continue banner
  const slot = G('continueSlot'); slot.innerHTML = '';
  const lastKey = ST.lastTrack[artist.name];
  if (lastKey) {
    const lt = artist.tracks.find(t => t.name === lastKey);
    if (lt) {
      const b = document.createElement('div'); b.className = 'continue-wrap';
      b.innerHTML = `
        <span class="continue-icon">${lt.isClip ? '🎬' : '▶'}</span>
        <div class="continue-info">
          <div class="continue-lbl">Continue Playing</div>
          <div class="continue-ch">${escHtml(lt.displayName)}</div>
        </div>
        <span class="continue-arrow">→</span>`;
      b.onclick = () => playTrack(lt);
      slot.appendChild(b);
    }
  }

  renderTrackList(artist);
  showScreen('S-ep');
}

function setSeasonActive(a) {
  document.querySelectorAll('.season-btn').forEach(b =>
    b.classList.toggle('on', b.dataset.season === a)
  );
}

// ── VIDEO THUMBNAIL EXTRACTOR ─────────────────────────────────────
const thumbCache  = {};  // filePath → dataURL | null
const thumbQueue  = [];
let   thumbActive = 0;
const THUMB_MAX   = 3;   // max concurrent video loads

function extractVideoThumb(filePath) {
  return new Promise(resolve => {
    if (filePath in thumbCache) { resolve(thumbCache[filePath]); return; }
    thumbQueue.push({ filePath, resolve });
    drainThumbQueue();
  });
}

function drainThumbQueue() {
  while (thumbActive < THUMB_MAX && thumbQueue.length > 0) {
    const task = thumbQueue.shift();
    if (task.filePath in thumbCache) { task.resolve(thumbCache[task.filePath]); continue; }
    thumbActive++;
    doExtract(task.filePath).then(url => {
      thumbCache[task.filePath] = url;
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
      if (settled) return; settled = true;
      cleanupVid(); resolve(url || null);
    };

    const vid = document.createElement('video');
    vid.muted      = true;
    vid.preload    = 'auto';
    vid.playsInline = true;
    vid.style.cssText = 'position:fixed;left:-9999px;width:320px;height:180px;opacity:0;pointer-events:none;';
    document.body.appendChild(vid);

    const cleanupVid = () => { try { vid.pause(); vid.src = ''; vid.load(); document.body.removeChild(vid); } catch {} };

    const capture = () => {
      try {
        const c = document.createElement('canvas'); c.width = 320; c.height = 180;
        const ctx = c.getContext('2d');
        ctx.drawImage(vid, 0, 0, 320, 180);
        const px = ctx.getImageData(80, 45, 160, 90);
        // Count non-black pixels in center region
        let nonBlack = 0;
        for (let i = 0; i < px.data.length; i += 4) {
          if (px.data[i] > 12 || px.data[i+1] > 12 || px.data[i+2] > 12) nonBlack++;
        }
        if (nonBlack > 50) {
          done(c.toDataURL('image/jpeg', 0.82));
        } else {
          done(null); // truly black frame
        }
      } catch { done(null); }
    };

    // Strategy 1: seek to 8% after metadata
    vid.addEventListener('loadedmetadata', () => {
      try { vid.currentTime = Math.max(0.5, (vid.duration || 30) * 0.08); }
      catch { done(null); }
    }, { once: true });

    // Strategy 2: capture after seek
    vid.addEventListener('seeked', capture, { once: true });

    // Strategy 3: fallback if seeked never fires
    vid.addEventListener('loadeddata', () => {
      if (!settled) setTimeout(() => { if (!settled) capture(); }, 400);
    }, { once: true });

    vid.addEventListener('error', () => done(null), { once: true });

    // Hard deadline — 7s
    setTimeout(() => done(null), 7000);

    vid.src = 'file://' + filePath;
  });
}

// Retry with later seek time (for videos with black intros)
function retryThumb(filePath, imgEl, phEl) {
  if (thumbCache[filePath]) {
    imgEl.src = thumbCache[filePath];
    imgEl.style.display = 'block';
    if (phEl) phEl.style.display = 'none';
    return;
  }
  const vid = document.createElement('video');
  vid.muted = true; vid.preload = 'auto';
  vid.style.cssText = 'position:fixed;left:-9999px;width:320px;height:180px;opacity:0;pointer-events:none;';
  document.body.appendChild(vid);
  let done = false;
  const cleanup = () => { try { vid.pause(); vid.src = ''; vid.load(); document.body.removeChild(vid); } catch {} };
  vid.addEventListener('seeked', () => {
    if (done) return; done = true; cleanup();
    try {
      const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      c.getContext('2d').drawImage(vid, 0, 0, 320, 180);
      const url = c.toDataURL('image/jpeg', 0.82);
      thumbCache[filePath] = url;
      imgEl.src = url; imgEl.style.display = 'block';
      if (phEl) phEl.style.display = 'none';
    } catch { cleanup(); }
  }, { once: true });
  vid.addEventListener('loadedmetadata', () => {
    try { vid.currentTime = Math.max(2, (vid.duration || 60) * 0.25); } catch {}
  }, { once: true });
  vid.addEventListener('error', () => { if (!done) { done = true; cleanup(); } }, { once: true });
  setTimeout(() => { if (!done) { done = true; cleanup(); } }, 6000);
  vid.src = 'file://' + filePath;
}

// ── RENDER TRACK LIST ─────────────────────────────────────────────
function renderTrackList(artist) {
  const lastKey = ST.lastTrack[artist.name];
  let tracks    = artist.tracks;
  if (ST.activeSeason && ST.activeSeason !== '__all__') {
    tracks = tracks.filter(t => t.album === ST.activeSeason);
  }

  const clips  = tracks.filter(t => t.isClip);
  const audios = tracks.filter(t => t.isAudio);
  const grid   = G('epGrid'); grid.innerHTML = '';

  // ── CLIPS: thumbnail grid ──────────────────────────────────────
  if (clips.length > 0) {
    if (audios.length > 0) {
      const lbl = document.createElement('div');
      lbl.className = 'sec-label'; lbl.style.margin = '0 0 16px';
      lbl.innerHTML = `<span>🎬 Video Clips (${clips.length})</span>`;
      grid.appendChild(lbl);
    }

    const cgrid = document.createElement('div'); cgrid.className = 'clip-grid';
    grid.appendChild(cgrid);

    clips.forEach(track => {
      const rid       = artist.name + '::' + track.name;
      const isPlaying = track.name === ST.curTrackKey;
      const isWatched = !!ST.progress[rid];

      const card = document.createElement('div');
      card.className = 'cg-card' + (isPlaying ? ' playing' : '');

      // Thumbnail area
      const thumbDiv = document.createElement('div'); thumbDiv.className = 'cg-thumb';

      const thumbImg = document.createElement('img'); thumbImg.className = 'cg-thumb-img';
      thumbImg.style.display = 'none';
      thumbDiv.appendChild(thumbImg);

      const ph = document.createElement('div'); ph.className = 'cg-thumb-ph';
      ph.textContent = '🎬';
      thumbDiv.appendChild(ph);

      if (isPlaying) {
        // EQ overlay instead of play button
        const eqOv = document.createElement('div'); eqOv.className = 'cg-eq-overlay';
        [10,22,14,18].forEach((h,i) => {
          const b = document.createElement('div'); b.className = 'cg-eq-bar';
          b.style.height = h + 'px'; eqOv.appendChild(b);
        });
        thumbDiv.appendChild(eqOv);
      } else {
        const pb2 = document.createElement('div'); pb2.className = 'cg-play-btn';
        pb2.textContent = '▶'; thumbDiv.appendChild(pb2);
      }

      card.appendChild(thumbDiv);

      // Async thumbnail load
      extractVideoThumb(track.filePath).then(url => {
        if (url) {
          thumbImg.src = url;
          thumbImg.onload = () => { thumbImg.style.display = 'block'; ph.style.display = 'none'; };
          thumbImg.onerror = () => retryThumb(track.filePath, thumbImg, ph);
        } else {
          retryThumb(track.filePath, thumbImg, ph);
        }
      });

      // Info
      const info = document.createElement('div'); info.className = 'cg-info';
      info.innerHTML = `
        <div class="cg-name" title="${escHtml(track.displayName)}">${escHtml(track.displayName)}</div>
        <div class="cg-meta">
          <span class="cg-album">${escHtml(track.album || '')}</span>
          ${isWatched ? '<span class="cg-dot" title="Watched"></span>' : ''}
        </div>`;
      card.appendChild(info);
      card.onclick = () => playTrack(track);
      cgrid.appendChild(card);
    });

    if (audios.length > 0) {
      const sp = document.createElement('div'); sp.style.height = '26px';
      grid.appendChild(sp);
    }
  }

  // ── AUDIO: list rows ───────────────────────────────────────────
  if (audios.length > 0) {
    if (clips.length > 0) {
      const lbl = document.createElement('div');
      lbl.className = 'sec-label'; lbl.style.margin = '0 0 16px';
      lbl.innerHTML = `<span>🎵 Sounds (${audios.length})</span>`;
      grid.appendChild(lbl);
    }

    const alist = document.createElement('div'); alist.className = 'track-list';
    grid.appendChild(alist);

    audios.forEach((track, idx) => {
      const rid       = artist.name + '::' + track.name;
      const isPlaying = track.name === ST.curTrackKey;
      const isPlayed  = !!ST.progress[rid];

      const el = document.createElement('div');
      el.className = 'ei' + (isPlaying ? ' playing' : '');

      if (isPlayed) {
        const dot = document.createElement('div'); dot.className = 'ei-dot'; el.appendChild(dot);
      }

      const num = document.createElement('div'); num.className = 'ei-num';
      num.textContent = idx + 1; el.appendChild(num);

      // Thumb
      const tdiv = document.createElement('div'); tdiv.className = 'ei-thumb';
      const csrc = track.coverPath || artist.coverPath;
      if (csrc) {
        const timg = document.createElement('img');
        timg.src = 'file://' + csrc; timg.loading = 'lazy';
        timg.onerror = () => {
          timg.remove();
          tdiv.textContent = '♪';
          Object.assign(tdiv.style, { display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem', color:'var(--accent)' });
        };
        tdiv.appendChild(timg);
      } else {
        tdiv.textContent = '♪';
        Object.assign(tdiv.style, { display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem', color:'var(--accent)' });
      }
      el.appendChild(tdiv);

      const idiv = document.createElement('div'); idiv.className = 'ei-info';
      idiv.innerHTML = `
        <div class="ei-name">${escHtml(track.displayName)}</div>
        ${track.album ? `<div class="ei-album">${escHtml(track.album)}</div>` : ''}`;
      el.appendChild(idiv);

      if (isPlaying) {
        const eq = document.createElement('div'); eq.className = 'ei-eq';
        for (let i = 0; i < 3; i++) {
          const b = document.createElement('div'); b.className = 'ei-eq-bar'; eq.appendChild(b);
        }
        el.appendChild(eq);
      }

      el.onclick = () => playTrack(track);
      alist.appendChild(el);
    });
  }
}

G('epBackBtn').onclick = () => {
  if (ST.mode === 'library') { renderGrid(); showScreen('S-lib'); }
  else reset();
};
G('watchAllBtn').onclick = () => {
  const t = ST.curArtist?.tracks;
  if (t?.length) playTrack(t[0]);
};

// ── PLAYER ────────────────────────────────────────────────────────
function getTrackIdx() {
  if (!ST.curArtist) return -1;
  return ST.curArtist.tracks.findIndex(t => t.name === ST.curTrackKey);
}
function updateNavBtns() {
  const idx = getTrackIdx();
  G('pPrev').disabled = idx <= 0;
  G('pNext').disabled = !ST.curArtist || idx >= ST.curArtist.tracks.length - 1;
}

// ── WEB AUDIO API — prevents crackling/distortion ────────────────
// Raw <audio> element on Chromium/Linux can crackle due to software
// resampling. Routing through AudioContext uses the proper audio pipeline.
let audioCtx    = null;
let audioSource = null;

function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    // Do NOT hardcode sampleRate — let the browser use the system's native rate
    // Hardcoding 48000 on a 44100Hz system causes resampling = crackling
    audioCtx = new AudioContext({ latencyHint: 'playback' });
  }
  return audioCtx;
}

function connectAudioElement(audEl) {
  // Only connect once per element — createMediaElementSource throws if called twice
  if (audEl._wcConnected) {
    try {
      if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch {}
    return;
  }
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Disconnect any previous source node cleanly
    if (audioSource) { try { audioSource.disconnect(); } catch {} audioSource = null; }
    audioSource = ctx.createMediaElementSource(audEl);
    audioSource.connect(ctx.destination);
    audEl._wcConnected = true;
  } catch {
    // Fallback: raw <audio> element still works without Web Audio routing
    audEl._wcConnected = false;
  }
}

// ── VOLUME PERSISTENCE ────────────────────────────────────────────
let savedVolume = 1.0;
try { savedVolume = parseFloat(localStorage.getItem('mv-volume') ?? '1.0') || 1.0; } catch {}
function getVol()   { return isNaN(savedVolume) ? 1.0 : Math.min(1, Math.max(0, savedVolume)); }
function saveVol(v) { savedVolume = v; try { localStorage.setItem('mv-volume', String(v)); } catch {} }

// ── STOP ALL MEDIA ────────────────────────────────────────────────
function stopAllMedia() {
  const aud = G('apAudio');
  const vid = G('vpVideo');

  if (aud) {
    try { aud.pause(); } catch {}
    aud.onplay = aud.onpause = aud.onended = aud.onerror = null;
    aud.src = '';
    try { aud.load(); } catch {}  // abort pending network request
  }

  if (vid) {
    try { vid.pause(); } catch {}
    vid.onended = vid.onerror = vid.oncontextmenu = null;
    if (vid._subBlobUrl) { URL.revokeObjectURL(vid._subBlobUrl); vid._subBlobUrl = null; }
    Array.from(vid.querySelectorAll('track')).forEach(t => t.remove());
    vid.src = '';
    try { vid.load(); } catch {}  // abort pending network request
  }

  // Suspend AudioContext when not playing — saves CPU & avoids residual noise
  if (audioCtx && audioCtx.state === 'running') {
    audioCtx.suspend().catch(() => {});
  }

  G('audioPlayer').style.display = 'none';
  G('videoPlayer').style.display = 'none';
  G('apArt').classList.remove('spinning');
}

function playTrack(track) {
  ST.curTrackKey = track.name;
  const artist   = ST.curArtist;

  if (artist) {
    ST.progress[artist.name + '::' + track.name] = true;
    ST.lastTrack[artist.name] = track.name;
    window.api.saveProgress(ST.progress).catch(() => {});
  }

  stopAllMedia();
  updateNavBtns();

  G('pTitle').textContent = (artist?.name ? artist.name + ' — ' : '') + track.displayName;
  G('pPages').textContent = track.album || '—';

  if (track.isClip) {
    // ── VIDEO ──────────────────────────────────────────────────
    G('videoPlayer').style.display = 'flex';
    const vid = G('vpVideo');
    vid.volume = getVol();

    // Fix: load subtitle BEFORE setting src → no race condition
    const startVideo = (subBlobUrl) => {
      if (subBlobUrl) {
        vid._subBlobUrl = subBlobUrl;
        const trk = document.createElement('track');
        trk.kind = 'subtitles'; trk.label = 'Subtitles';
        trk.srclang = 'ar'; trk.src = subBlobUrl; trk.default = true;
        vid.appendChild(trk);
      }
      // Set src AFTER track element is in DOM
      vid.src = 'file://' + track.filePath;
      // Resume AudioContext if suspended by browser autoplay policy
      if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
      // Single loadedmetadata handler
      vid.addEventListener('loadedmetadata', () => {
        if (vid.textTracks.length > 0) vid.textTracks[0].mode = 'showing';
      }, { once: true });
      vid.play().catch(() => {});
    };

    if (track.subtitlePath) {
      window.api.loadSubtitle(track.subtitlePath)
        .then(res => startVideo(res?.ok && res.vtt
          ? URL.createObjectURL(new Blob([res.vtt], { type: 'text/vtt' }))
          : null))
        .catch(() => startVideo(null));
    } else {
      startVideo(null);
    }

    vid.onended = () => {
      const idx = getTrackIdx();
      if (ST.curArtist && idx >= 0 && idx < ST.curArtist.tracks.length - 1)
        setTimeout(() => playTrack(ST.curArtist.tracks[idx + 1]), 800);
    };
    vid.onerror = () => {
      const err  = vid.error;
      const ext  = (track.filePath.split('.').pop() || '').toUpperCase();
      const CODES = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE (unsupported codec)', 4: 'SRC_NOT_SUPPORTED (format not supported)' };
      const label = err ? (CODES[err.code] || ('code ' + err.code)) : 'unknown';
      showToast('⚠ Cannot play .' + ext + ' file — ' + label, 5000);
      console.error('Video error:', { file: track.filePath, code: err?.code, message: err?.message });
    };
    vid.oncontextmenu = e => { e.preventDefault(); window.api.openExternal(track.filePath); };
    // Named handler prevents accumulation across track changes
    if (vid._volHandler) vid.removeEventListener('volumechange', vid._volHandler);
    vid._volHandler = () => saveVol(vid.volume);
    vid.addEventListener('volumechange', vid._volHandler, { passive: true });

  } else {
    // ── AUDIO ──────────────────────────────────────────────────
    G('audioPlayer').style.display = 'flex';

    const artImg = G('apArtImg');
    const artPh  = G('apArtPh');
    const csrc   = track.coverPath || artist?.coverPath;
    if (csrc) {
      artImg.src = 'file://' + csrc;
      artImg.style.display = 'block'; artPh.style.display = 'none';
      artImg.onerror = () => { artImg.style.display = 'none'; artPh.style.display = 'flex'; };
    } else {
      artImg.style.display = 'none'; artPh.style.display = 'flex';
    }

    G('apName').textContent  = track.displayName;
    G('apAlbum').textContent = track.album || artist?.name || '—';
    G('apArt').classList.add('spinning');

    const aud   = G('apAudio');
    aud.preload = 'auto';
    aud.volume  = getVol();
    aud.src     = 'file://' + track.filePath;

    // Route through Web Audio API for clean playback (prevents crackling)
    connectAudioElement(aud);

    aud.play().catch(() => {});

    aud.onplay  = () => G('apArt').classList.add('spinning');
    aud.onpause = () => G('apArt').classList.remove('spinning');
    aud.onerror = () => showToast('⚠ Cannot play this file');
    aud.onended = () => {
      G('apArt').classList.remove('spinning');
      const idx = getTrackIdx();
      if (ST.curArtist && idx >= 0 && idx < ST.curArtist.tracks.length - 1)
        setTimeout(() => playTrack(ST.curArtist.tracks[idx + 1]), 500);
    };
    // Named handler prevents accumulation across track changes
    if (aud._volHandler) aud.removeEventListener('volumechange', aud._volHandler);
    aud._volHandler = () => saveVol(aud.volume);
    aud.addEventListener('volumechange', aud._volHandler, { passive: true });

    // ── Media Session API ──────────────────────────────────────
    if ('mediaSession' in navigator) {
      const setMeta = (artUrl) => {
        navigator.mediaSession.metadata = new MediaMetadata({
          title:   track.displayName,
          artist:  artist?.name || '',
          album:   track.album  || '',
          artwork: artUrl ? [{ src: artUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
        });
      };
      // Fix: OS needs blob URL, not file:// for artwork
      if (csrc) {
        fetch('file://' + csrc).then(r => r.blob())
          .then(b => setMeta(URL.createObjectURL(b)))
          .catch(() => setMeta(null));
      } else { setMeta(null); }

      navigator.mediaSession.setActionHandler('play',          () => aud.play().catch(()=>{}));
      navigator.mediaSession.setActionHandler('pause',         () => aud.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => G('pPrev').click());
      navigator.mediaSession.setActionHandler('nexttrack',     () => G('pNext').click());
      navigator.mediaSession.setActionHandler('seekbackward',  () => { aud.currentTime = Math.max(0, aud.currentTime - 10); });
      navigator.mediaSession.setActionHandler('seekforward',   () => { aud.currentTime = Math.min(aud.duration || 0, aud.currentTime + 10); });
    }
  }

  if (ST.curArtist) renderTrackList(ST.curArtist);
  G('pbar').classList.remove('hide');
  showScreen('S-player');
}

G('pPrev').onclick = () => {
  const idx = getTrackIdx(); if (idx > 0) playTrack(ST.curArtist.tracks[idx - 1]);
};
G('pNext').onclick = () => {
  const idx = getTrackIdx();
  if (ST.curArtist && idx >= 0 && idx < ST.curArtist.tracks.length - 1)
    playTrack(ST.curArtist.tracks[idx + 1]);
};
G('pBackBtn').onclick = () => {
  stopAllMedia(); ST.curTrackKey = null;
  if (ST.curArtist) { renderTrackList(ST.curArtist); showScreen('S-ep'); }
  else if (ST.mode === 'library') { renderGrid(); showScreen('S-lib'); }
  else reset();
};

// ── KEYBOARD ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!G('S-player').classList.contains('vis')) return;
  if (e.target.tagName === 'INPUT') return;

  // Fix 4: check src properly
  const aud = G('apAudio');
  const vid = G('vpVideo');
  const isAudActive = G('audioPlayer').style.display !== 'none' && aud.src;
  const isVidActive = G('videoPlayer').style.display !== 'none' && vid.src;
  const media = isVidActive ? vid : (isAudActive ? aud : null);

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) G('pNext').click();
    else if (media) media.currentTime = Math.min(media.duration || 0, media.currentTime + 10);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) G('pPrev').click();
    else if (media) media.currentTime = Math.max(0, media.currentTime - 10);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (media) media.volume = Math.min(1, (media.volume || 0) + 0.1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (media) media.volume = Math.max(0, (media.volume || 1) - 0.1);
  } else if (e.key === ' ') {
    e.preventDefault();
    if (media) { media.paused ? media.play().catch(()=>{}) : media.pause(); }
  } else if (e.key === 'Escape') {
    G('pBackBtn').click();
  } else if (e.key === 'f' || e.key === 'F') {
    window.api.winFs();
  } else if (e.key === 'm' || e.key === 'M') {
    if (media) media.muted = !media.muted;
  }
});

// ── RESET ─────────────────────────────────────────────────────────
function reset() {
  ST.mode = null; ST.library = []; ST.curArtist = null;
  ST.curTrackKey = null; ST.activeSeason = '__all__'; // Fix 5
  G('searchBar').value = '';
  stopAllMedia();
  ['S-lib','S-ep','S-player'].forEach(id => G(id).classList.remove('vis'));
  G('welcome').classList.remove('hidden');
  showScreen(null);
  renderRecent();
}

// ── INIT ──────────────────────────────────────────────────────────
loadAndRenderRecent();
