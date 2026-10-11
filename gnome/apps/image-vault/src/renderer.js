'use strict';
// ═══════════════════════════════════════════════════════════════
//  Image Gallery — Renderer v5
//  virtual scroll · masonry 4col · favorites · sort · slideshow
//  zoom · copy path · show in folder · recent paths (cards)
// ═══════════════════════════════════════════════════════════════
const api = window.electronAPI;

// ── constants ──────────────────────────────────────────────────
let   COLS    = 4;   // now dynamic — recalculated on layout based on window width
const MAX_COLS   = 4;
const MIN_COL_W  = 350; // px — below this width per column, drop a column
                         // (tuned so halving the window goes 4→2, not 4→3)
const GAP     = 10;
const PAD     = 10;
let   BUFFER  = 2400;          // tiles are created this far above/below the viewport…
let   KEEP    = 5200;          // …and only destroyed once they are this far away (no flicker when scrolling back)
const TIMEOUT = 8000;
const SS_MS   = 4500;

// ── helpers ────────────────────────────────────────────────────
// Encode special chars (#, ?, spaces, etc.) in file paths for use as URLs.
// We split on '/' and encode each segment individually to preserve path separators.
function fileUrl(filePath) {                 // display (img/video): direct, fast
  return 'file://' + filePath.split('/').map(encodeURIComponent).join('/');
}
function fetchUrl(filePath) {                // fetch() cannot read file:// → tiny custom protocol
  return 'localfile://local' + filePath.split('/').map(encodeURIComponent).join('/');
}

// ── state ──────────────────────────────────────────────────────
let all         = [];
let shown       = [];
let favs        = new Set();
let favsOnly    = false;
let colH        = [];
let slots       = [];
let lbI         = 0;
let zoomed      = false;
let ssOn        = false;
let ssTid       = null;
let recentPaths = [];
const live      = new Map();
let rafPending  = false;

// ── elements ───────────────────────────────────────────────────
const $         = id => document.getElementById(id);
const gw        = $('galleryWrap');
const grid      = $('masonryGrid');
const welcome   = $('welcome');
const dzMain    = $('dzMain');
const loadState = $('loadingState');
const pFill     = $('progFill');
const pPct      = $('progText');
const loadLbl   = $('loadMsg');
const counter   = $('counter');
const srch      = $('searchBar');
const srt       = $('sortSelect');
const favsBtn   = $('favsBtn');
const ssBtn     = $('slideshowBtn');
const lb        = $('lightbox');
const lbImg     = $('lbImg');
const lbVid     = $('lbVideo');
const lbErr     = $('lbErr');
const lbInfo    = $('lbInfo');
const lbFavBtn  = $('lbFav');
const ssBar     = $('slideshowBar');
const ssProg    = $('slideshowProgress');
const toast     = $('toast');

// ── window controls ────────────────────────────────────────────
$('wClose').onclick    = () => api.close();
$('wMin').onclick      = () => api.minimize();
$('wMax').onclick      = () => api.maximize();
$('fsBtn').onclick     = () => api.toggleFullscreen();
$('changeBtn').onclick = doReset;

// ── particles ──────────────────────────────────────────────────
const cnv  = $('particles');
const pctx = cnv && cnv.getContext('2d');
const HUES = [267,217,199,183,158,115,41,23,350,316];
let pts = [];

function initPts() {
  if (!cnv) return;
  cnv.width = innerWidth; cnv.height = innerHeight;
  pts = Array.from({length:55}, () => ({
    x: Math.random()*cnv.width,  y: Math.random()*cnv.height,
    vx:(Math.random()-.5)*.3,   vy:(Math.random()-.5)*.3,
    r: Math.random()*1.5+.4,
    hue: HUES[Math.floor(Math.random()*HUES.length)],
    a: Math.random()*.45+.1,    ph: Math.random()*Math.PI*2,
  }));
}
let particlesOn = true;
function setParticles(on) {
  if (on === particlesOn) return;
  particlesOn = on;
  if (cnv) cnv.style.display = on ? '' : 'none';
  document.body.classList.toggle('in-gallery', !on);
  if (on) tickPts();
}
function tickPts() {
  if (!pctx || !particlesOn) return;
  pctx.clearRect(0,0,cnv.width,cnv.height);
  const t = performance.now()/1000;
  for (const p of pts) {
    p.x+=p.vx; p.y+=p.vy;
    if (p.x<0||p.x>cnv.width)  p.vx*=-1;
    if (p.y<0||p.y>cnv.height) p.vy*=-1;
    pctx.beginPath();
    pctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    pctx.fillStyle=`hsla(${p.hue},65%,72%,${p.a*(.65+.35*Math.sin(t+p.ph))})`;
    pctx.fill();
  }
  requestAnimationFrame(tickPts);
}
initPts(); tickPts();

// ── toast ──────────────────────────────────────────────────────
let toastTid;
function showToast(msg, ms=2000) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTid);
  toastTid = setTimeout(()=>toast.classList.remove('show'), ms);
}

// ── open / drop ────────────────────────────────────────────────
$('openFolderBtn').onclick = async () => { const p=await api.openFolderDialog(); if(p) loadFolder(p); };
$('openFilesBtn').onclick  = async () => { const f=await api.openFileDialog();   if(f?.length) ingestFiles(f); };

const dz = $('dropzone');
dz.addEventListener('dragover',  e=>{e.preventDefault();dz.classList.add('over');});
dz.addEventListener('dragleave', ()=>dz.classList.remove('over'));
dz.addEventListener('drop', e=>{
  e.preventDefault(); dz.classList.remove('over');
  const paths=Array.from(e.dataTransfer.files).map(f=>api.pathForFile(f)).filter(Boolean);
  if (paths.length) ingestFiles(paths);
});

// ── load ───────────────────────────────────────────────────────
const IMG_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','jfif','avif','webm','mp4']);

api.onScanProgress(d => setLoading('Scanning folder… ' + d.count.toLocaleString() + ' files'));

async function loadFolder(dir) {
  setLoading('Scanning folder…');
  const items = await api.scanFolder(dir);
  if (!items?.length) { unsetLoading(); showToast('No images found'); return; }
  await saveRecent(dir);
  await boot(items);
}

async function ingestFiles(paths) {
  setLoading('Reading files…');
  const items = paths
    .filter(p=>IMG_EXT.has(p.split('.').pop().toLowerCase()))
    .map(p=>{
      const name=p.split(/[\\/]/).pop();
      const ext=name.split('.').pop().toLowerCase();
      return {filePath:p,name,size:0,mtime:0,ext,isVideo:ext==='webm'||ext==='mp4'};
    });
  if (!items.length) {
    try { const fi=await api.scanFolder(paths[0]); if(fi?.length){await saveRecent(paths[0]);await boot(fi);return;} } catch{}
    unsetLoading(); showToast('No images found'); return;
  }
  await boot(items);
}

async function boot(items) {
  all  = items;
  lbI  = 0; // reset so lightbox never opens out-of-bounds
  favs = new Set(await api.loadFavorites());
  setLoading('Loading dimensions…');
  // Never make the user wait on a slow disk: give size-reading a few seconds, then
  // open the gallery anyway (unknown sizes lay out as 4:3) and keep resolving in the
  // background, re-laying out (scroll position kept) as the real sizes arrive.
  const snapshot = all;
  const dimsDone = getDims(snapshot);
  const finished = await Promise.race([dimsDone.then(() => true), new Promise(r => setTimeout(() => r(false), DIMS_BUDGET_MS))]);
  applySort();
  applyFilter();
  openGallery();
  thumbUrlCache.clear(); shownBefore.clear();
  startBgThumbs(all);
  if (!finished) {
    const timer = setInterval(() => { if (all !== snapshot) clearInterval(timer); else relayoutKeepScroll(); }, 2500);
    dimsDone.then(() => { clearInterval(timer); if (all === snapshot) relayoutKeepScroll(); });
  }
}
const DIMS_BUDGET_MS = 4000;
function relayoutKeepScroll() {
  const st = gw.scrollTop;
  for (const [, el] of live) dropCard(el);
  live.clear();
  computeLayout();
  grid.style.height = totalH() + 'px';
  gw.scrollTop = st;
  renderVisible();
}

// ── dimensions ─────────────────────────────────────────────────
// Sizes come from the file headers (main process, fast, EXIF-aware) — the old
// code decoded EVERY full-size picture just to learn its width and height.
// Only what can't be read that way (svg, videos, odd formats) is probed.
async function getDims(items) {
  const total = items.length; let done = 0;
  const todo = items.filter(it => !it.aspect);
  done += total - todo.length;
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    let dims = [];
    try { dims = await api.getDims(chunk.map(c => c.filePath)); } catch {}
    chunk.forEach((it, k) => {
      const d = dims[k];
      if (d) { it.width = d[0]; it.height = d[1]; it.aspect = d[0] / d[1]; }
    });
    done += chunk.length; updateProg(Math.min(done, total), total);
  }
  // Whatever is left (svg, unusual formats): never wait long and never block the
  // gallery — unknown videos default to 16:9, unknown images to 4:3.
  const rest = items.filter(it => !it.aspect);
  done = total - rest.length;
  const probe = item => new Promise(res => {
    let ok = false;
    const finish = (w, h) => {
      if (ok) return; ok = true; clearTimeout(tid);
      if (w > 0 && h > 0) { item.width = w; item.height = h; }
      else { item.width = item.isVideo ? 16 : 4; item.height = item.isVideo ? 9 : 3; }
      item.aspect = item.width / item.height;
      updateProg(++done, total); res();
    };
    const tid = setTimeout(() => finish(0, 0), item.isVideo ? 2500 : 5000);
    if (item.isVideo) { finish(0, 0); return; }              // never probe videos by loading them
    const img = new Image();
    img.onload = () => finish(img.naturalWidth, img.naturalHeight);
    img.onerror = () => finish(0, 0);
    img.src = fileUrl(item.filePath);
  });
  for (let i = 0; i < rest.length; i += 24)
    await Promise.all(rest.slice(i, i + 24).map(probe));
}

function updateProg(done,total) {
  const p=Math.round(done/total*100);
  pFill.style.width=p+'%'; pPct.textContent=p+'%';
}

// ── sort & filter ──────────────────────────────────────────────
function applySort() {
  const s=srt.value;
  all.sort((a,b)=>{
    if(s==='favs'){const af=favs.has(a.filePath),bf=favs.has(b.filePath);if(af!==bf)return af?-1:1;}
    if(s==='date') return b.mtime-a.mtime;
    if(s==='size') return b.size-a.size;
    return a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'});
  });
}
function applyFilter() {
  const q=srch.value.toLowerCase().trim();
  shown=all.filter(i=>{
    if(favsOnly&&!favs.has(i.filePath))return false;
    if(q&&!i.name.toLowerCase().includes(q))return false;
    return true;
  });
}

srt.addEventListener('change',()=>{applySort();applyFilter();rebuildGrid();});
srch.addEventListener('input', ()=>{applyFilter();rebuildGrid();});

favsBtn.addEventListener('click',()=>{
  favsOnly=!favsOnly;
  favsBtn.classList.toggle('active',favsOnly);
  favsBtn.textContent=favsOnly?'★ Favorites':'⭐ Favorites';
  applyFilter(); rebuildGrid();
  showToast(favsOnly?'★ Showing favorites':'Showing all');
});

// ── layout — responsive columns (up to MAX_COLS) ────────────────
function computeLayout() {
  const w=gw.clientWidth||innerWidth;
  // pick the largest column count (1..MAX_COLS) whose resulting column
  // width is still >= MIN_COL_W, so columns drop off as the window shrinks
  const h=gw.clientHeight||innerHeight;
  const isPortrait=h>w; // vertical window → cap columns at 3
  const capCols=isPortrait?Math.min(3,MAX_COLS):MAX_COLS;
  COLS=1;
  for(let c=capCols;c>=1;c--){
    const testW=Math.floor((w-PAD*2-GAP*(c-1))/c);
    if(testW>=MIN_COL_W){COLS=c;break;}
  }
  const colW=Math.floor((w-PAD*2-GAP*(COLS-1))/COLS);
  colH=Array(COLS).fill(PAD); slots=[];
  for(let i=0;i<shown.length;i++){
    const h  =Math.round(colW/(shown[i].aspect||1.33));
    const col=colH.indexOf(Math.min(...colH));
    slots.push({top:colH[col],h,left:PAD+col*(colW+GAP),colW});
    colH[col]+=h+GAP;
  }
}
function totalH(){return colH.length?Math.max(...colH)+PAD:0;}

// ── virtual render ─────────────────────────────────────────────
function sched(){if(rafPending)return;rafPending=true;requestAnimationFrame(()=>{rafPending=false;renderVisible();});}

function renderVisible() {
  const st=gw.scrollTop,vpH=gw.clientHeight;
  BUFFER=Math.max(2400,Math.round(vpH*2.2)); KEEP=Math.round(BUFFER*2.1);
  const t0=st-BUFFER,t1=st+vpH+BUFFER;
  const want=[];
  for(let i=0;i<shown.length;i++){
    const s=slots[i];if(!s||s.h===undefined)continue;
    if(s.top+s.h>=t0&&s.top<=t1)want.push(i);
  }
  // destroy only what is far outside the viewport
  const k0=st-KEEP,k1=st+vpH+KEEP;
  for(const[i,el]of live){
    const s=slots[i];
    if(!s||s.top+s.h<k0||s.top>k1){dropCard(el);live.delete(i);}
  }
  // nearest-to-viewport first, so what you are looking at appears first
  const mid=st+vpH/2;
  want.sort((a,b)=>Math.abs(slots[a].top-mid)-Math.abs(slots[b].top-mid));
  for(const i of want){
    if(live.has(i))continue;
    const s=slots[i];
    const el=makeCard(shown[i],i,s.colW,s.h);
    el.style.position='absolute';
    el.style.left=s.left+'px';
    el.style.top=s.top+'px';
    el.style.width=s.colW+'px';
    grid.appendChild(el); live.set(i,el);
  }
}

// ── thumbnails ─────────────────────────────────────────────────
// Grid tiles show small cached thumbnails (made once, off the main thread, kept
// on disk). The full-size file is only decoded when you open it in the lightbox.
const THUMB_W = 640;
const THUMB_CONC = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) >> 1));
const noThumb  = new Set();                         // files we could not thumbnail → always shown from the original
const inflight = new Map();                        // path -> Promise (never make the same thumbnail twice at once)
const FALLBACK_MS = 1500;                          // a tile still waiting after this long shows the original
const thumbQ = []; let thumbBusy = 0;
const thumbUrlCache = new Map();                    // path -> thumbnail url (no IPC when a tile is re-created)
let lastScrollAt = 0;
const needsThumb = it => !it.isVideo && it.size > 350 * 1024 && it.ext !== 'gif' && it.ext !== 'svg'
                         && (!it.width || it.width > THUMB_W * 1.25);

async function tileSrc(item, img, el, idx) {
  const hp = heicUrls.get(item.filePath);
  if (hp) { img.src = hp; return; }
  if (!needsThumb(item) || noThumb.has(item.filePath)) { img.src = fileUrl(item.filePath); return; }
  const hit = thumbUrlCache.get(item.filePath);
  if (hit) { img.src = hit; return; }               // synchronous: no blank flash on re-creation
  let t = null;
  try { t = await api.thumbGet(item.filePath, item.mtime, item.size, THUMB_W); } catch {}
  if (!el.isConnected) return;                       // scrolled away before we even started
  if (t && t.url) { thumbUrlCache.set(item.filePath, t.url); img.src = t.url; return; }
  const job = { item, img, el, idx, key: t && t.key };
  // never leave a tile blank: if the thumbnail is late (busy queue / very big file), show the original
  job.fallback = setTimeout(() => {
    if (el.isConnected && !img.getAttribute('src')) img.src = fileUrl(item.filePath);
  }, FALLBACK_MS);
  thumbQ.push(job);
  pumpThumbs();
}

// one job per file, with a hard time limit so a stuck decode can never block the queue
function thumbJob(item, key) {
  let p = inflight.get(item.filePath);
  if (!p) {
    p = Promise.race([renderThumb(item, key), new Promise(res => setTimeout(() => res(null), 20000))])
      .then(url => { if (!url) noThumb.add(item.filePath); return url; })
      .finally(() => inflight.delete(item.filePath));
    inflight.set(item.filePath, p);
  }
  return p;
}
function pumpThumbs() {
  while (thumbBusy < THUMB_CONC && thumbQ.length) {
    // pick the job closest to the middle of the screen right now (what you are looking at first)
    const mid = gw.scrollTop + gw.clientHeight / 2;
    let bi = -1, bd = Infinity;
    for (let q = thumbQ.length - 1; q >= 0; q--) {
      const j = thumbQ[q];
      if (!j.el.isConnected) { thumbQ.splice(q, 1); continue; }
      const s = slots[j.idx];
      const d = s ? Math.abs(s.top + (s.h || 0) / 2 - mid) : 1e9;
      if (d < bd) { bd = d; bi = q; }
    }
    if (bi < 0) break;
    const job = thumbQ.splice(bi, 1)[0];
    thumbBusy++;
    thumbJob(job.item, job.key)
      .then(url => {
        clearTimeout(job.fallback);
        if (job.el.isConnected && !job.img.getAttribute('src')) job.img.src = url || fileUrl(job.item.filePath);
      })
      .finally(() => { thumbBusy--; pumpThumbs(); });
  }
}
// decode a downscaled copy off the main thread, store it on disk, return its url
async function renderThumb(item, key) {
  try {
    const blob = await (await fetch(fetchUrl(item.filePath))).blob();
    const bmp  = await createImageBitmap(blob, { resizeWidth: THUMB_W, resizeQuality: 'medium', imageOrientation: 'from-image' });
    const oc   = new OffscreenCanvas(bmp.width, bmp.height);
    const cx   = oc.getContext('2d');
    cx.fillStyle = '#1e1e2e'; cx.fillRect(0, 0, oc.width, oc.height);
    cx.drawImage(bmp, 0, 0); bmp.close();
    const out  = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    const url  = key ? await api.thumbSave(key, await out.arrayBuffer()) : null;
    if (url) thumbUrlCache.set(item.filePath, url);
    return url || URL.createObjectURL(out);
  } catch { return null; }
}

// Background pre-generation: while you are NOT scrolling, thumbnails for the whole
// library are prepared one at a time, so scrolling later never waits for a decode.
let bgToken = 0;
async function startBgThumbs(list) {
  const token = ++bgToken;
  const todo = list.filter(needsThumb);
  // 1) which thumbnails already exist? (fast, batched)
  const missing = [];
  for (let i = 0; i < todo.length && token === bgToken; i += 400) {
    const chunk = todo.slice(i, i + 400);
    let res = [];
    try { res = await api.thumbGetMany(chunk.map(c => [c.filePath, c.mtime, c.size, THUMB_W])); } catch {}
    chunk.forEach((it, k) => {
      const t = res[k];
      if (t && t.url) thumbUrlCache.set(it.filePath, t.url); else missing.push({ it, key: t && t.key });
    });
  }
  // 2) make the missing ones, gently
  for (const { it, key } of missing) {
    if (token !== bgToken) return;
    while (token === bgToken && (Date.now() - lastScrollAt < 800 || thumbBusy > 0 || thumbQ.length))
      await new Promise(r => setTimeout(r, 300));
    if (token !== bgToken || thumbUrlCache.has(it.filePath) || noThumb.has(it.filePath)) continue;
    await thumbJob(it, key);
    await new Promise(r => setTimeout(r, 40));
  }
}

// videos play only while visible (many decoders at once = stutter)
const vidIO = new IntersectionObserver(es => {
  for (const en of es) {
    const v = en.target;
    if (en.isIntersecting && en.intersectionRatio > 0.35) v.play().catch(() => {});
    else v.pause();
  }
}, { threshold: [0, 0.35, 0.6] });

function dropCard(el) {
  const v = el.querySelector('video');
  if (v) { vidIO.unobserve(v); vidLoadIO.unobserve(v); v.pause(); v.removeAttribute('src'); v.load(); }   // frees the decoder
  el.remove();
}

// ── HEIC/HEIF photos (saved as .jpg etc.) ──────────────────────────────────
// The browser engine can't show them, so they are decoded with WebAssembly
// (heic-worker.js) into a normal JPEG preview that is cached on disk.
const heicUrls = new Map();                   // path -> preview url
const heicJobs = new Map();                   // path -> Promise<url|null>
let heicWorker = null, heicSeq = 0, heicBusy = Promise.resolve();
const HEIC_MAX = 2560;

function heicDecode(buf) {
  if (!heicWorker) heicWorker = new Worker('heic-worker.js');
  const id = ++heicSeq;
  return new Promise((resolve, reject) => {
    const on = (e) => {
      if (e.data.id !== id) return;
      heicWorker.removeEventListener('message', on);
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data);
    };
    heicWorker.addEventListener('message', on);
    heicWorker.addEventListener('error', ev => reject(new Error(ev.message || 'worker error')), { once: true });
    heicWorker.postMessage({ id, buf }, [buf]);
  });
}

function heicUrl(item) {
  if (heicUrls.has(item.filePath)) return Promise.resolve(heicUrls.get(item.filePath));
  let p = heicJobs.get(item.filePath);
  if (!p) {
    p = (heicBusy = heicBusy.then(async () => {            // one conversion at a time (heavy)
      try {
        const t = await api.thumbGet(item.filePath, item.mtime, item.size, 'heic' + HEIC_MAX);
        if (t.url) return t.url;
        const buf = await (await fetch(fetchUrl(item.filePath))).arrayBuffer();
        const { w, h, rgba } = await heicDecode(buf);
        const full = new OffscreenCanvas(w, h);
        full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
        const k = Math.min(1, HEIC_MAX / Math.max(w, h));
        const out = new OffscreenCanvas(Math.round(w * k), Math.round(h * k));
        out.getContext('2d').drawImage(full, 0, 0, out.width, out.height);
        const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        return await api.thumbSave(t.key, await blob.arrayBuffer()) || URL.createObjectURL(blob);
      } catch (err) { console.warn('HEIC conversion failed:', item.name, err.message); return null; }
    })).then(url => { if (url) heicUrls.set(item.filePath, url); heicJobs.delete(item.filePath); return url; });
    heicJobs.set(item.filePath, p);
  }
  return p;
}

// true when the file really is HEIC/HEIF (asked only after the browser failed to show it)
async function isHeic(item) { try { return (await api.probeFile(item.filePath)).kind === 'heic'; } catch { return false; } }

// ── files the browser cannot decode: say WHY, and offer a way out ──────────
function fillBroken(box, item, big) {
  box.innerHTML = '';
  const ic = document.createElement('span'); ic.className = big ? 'big' : ''; ic.textContent = '⚠'; if (!big) ic.style.fontSize = '22px';
  const t = document.createElement('span'); t.textContent = "Can't preview this file";
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = item.name; if (!big) nm.style.cssText = 'opacity:.7;word-break:break-all;font-size:11px;';
  const why = document.createElement('span'); why.textContent = '…'; why.style.cssText = 'opacity:.85;font-size:' + (big ? '13px' : '11px') + ';max-width:100%;';
  const row = document.createElement('div');
  const b1 = document.createElement('button'); b1.className = 'bad-btn'; b1.textContent = '↗ Open with system viewer';
  b1.onclick = e => { e.stopPropagation(); api.openPath(item.filePath); };
  const b2 = document.createElement('button'); b2.className = 'bad-btn'; b2.textContent = '📂 Show in folder';
  b2.onclick = e => { e.stopPropagation(); api.showInFolder(item.filePath); };
  row.append(b1, b2);
  box.append(ic, t, nm, why, row);
  api.probeFile(item.filePath).then(r => { why.textContent = r.note + (r.size ? '  (' + (r.size / 1024).toFixed(0) + ' KB)' : ''); }).catch(() => { why.textContent = ''; });
}

const shownBefore = new Set();                      // paths already displayed once (decoded copy likely cached)
// a video only gets its src when it is near the screen (hundreds of buffering <video> = stutter)
const vidLoadIO = new IntersectionObserver(es => {
  for (const en of es) {
    if (!en.isIntersecting) continue;
    const v = en.target; vidLoadIO.unobserve(v);
    if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; }
  }
}, { rootMargin: '700px 0px' });

function makeCard(item,idx,cw,ch) {
  const el=document.createElement('div');
  el.className='masonry-item';
  el.style.height=ch+'px';
  el.style.overflow='hidden';
  el.style.background='#1e1e2e';                    // never white/transparent while an image decodes

  const seen=shownBefore.has(item.filePath);
  const sk=document.createElement('div');
  sk.className='skeleton'; sk.style.height=ch+'px';
  if(!seen) el.appendChild(sk);                     // skeleton only the first time

  const rmSk =()=>sk.parentNode&&sk.remove();
  const errSk=()=>{sk.style.opacity='.08';};

  if(item.isVideo){
    const v=document.createElement('video');
    v.muted=true;v.loop=true;v.playsInline=true;v.preload='metadata';
    v.disablePictureInPicture=true;
    v.style.cssText=`width:100%;height:${ch}px;object-fit:cover;display:block;border-radius:13px;`;
    v.onloadeddata=rmSk; v.onloadedmetadata=rmSk; v.onerror=errSk;
    v.dataset.src=fileUrl(item.filePath);
    el.appendChild(v);
    vidLoadIO.observe(v);
    vidIO.observe(v);
    const b=document.createElement('span');
    b.className='vid-badge';b.textContent='VIDEO';el.appendChild(b);
  } else {
    const img=document.createElement('img');
    img.alt=item.name; img.decoding='async';
    img.style.cssText='width:100%;height:auto;display:block;border-radius:13px;opacity:'+(seen?'1':'0')+';'+(seen?'':'transition:opacity .18s;');
    const show=()=>{rmSk();img.style.opacity='1';el.style.height='auto';shownBefore.add(item.filePath);};
    img.onload=show;
    img.onerror=()=>{
      // a cached thumbnail that cannot be read → fall back to the original once
      if(!img.dataset.retry&&/\/thumbs\//.test(img.src)){img.dataset.retry='1';thumbUrlCache.delete(item.filePath);noThumb.add(item.filePath);img.src=fileUrl(item.filePath);return;}
      // maybe a HEIC photo with a .jpg name → decode it with WebAssembly
      if(!item._heicTried){
        item._heicTried=true;
        isHeic(item).then(async yes=>{
          const url=yes?await heicUrl(item):null;
          if(url&&el.isConnected){img.src=url;} else {img.onerror();}
        });
        return;
      }
      // the file itself can't be decoded (corrupt / unsupported) → say so instead of a blank box
      rmSk(); img.remove(); el.style.height=ch+'px';
      const bad=document.createElement('div');
      bad.style.cssText='height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:12px;text-align:center;color:#7f849c;font-size:12px;border:1px dashed #45475a;border-radius:13px;box-sizing:border-box;overflow:hidden;';
      fillBroken(bad,item,false);
      el.insertBefore(bad,el.firstChild);
    };
    el.appendChild(img);
    tileSrc(item,img,el,idx);
    if(img.complete&&img.naturalWidth>0)show();
  }

  // fav button
  const isFav=favs.has(item.filePath);
  const fb=document.createElement('button');
  fb.className='fav-btn'+(isFav?' active':'');
  fb.textContent=isFav?'★':'☆';
  // (no backdrop-filter here: one blur layer per tile made scrolling stutter)
  fb.style.cssText='position:absolute;top:7px;right:7px;width:28px;height:28px;border-radius:8px;border:1px solid rgba(203,166,247,.25);background:rgba(17,17,27,.8);display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;opacity:0;transition:opacity .2s,transform .2s;z-index:5;';
  if(isFav){fb.style.opacity='1';fb.style.borderColor='#f9e2af';}
  fb.onclick=e=>{e.stopPropagation();toggleFav(item.filePath,fb);};
  // hover managed on el so moving mouse to the btn doesn't flicker
  el.addEventListener('mouseenter',()=>{if(!favs.has(item.filePath))fb.style.opacity='1';});
  el.addEventListener('mouseleave',()=>{if(!favs.has(item.filePath))fb.style.opacity='0';});
  el.appendChild(fb);

  el.onclick=()=>openLb(idx);
  return el;
}

// ── gallery open / rebuild ──────────────────────────────────────
function openGallery() {
  setParticles(false);          // the background animation is only for the welcome screen
  unsetLoading();
  welcome.classList.add('hidden');
  gw.classList.add('visible');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    computeLayout();
    grid.style.height=totalH()+'px';
    updateCounter(); renderVisible();
  }));
}

function rebuildGrid() {
  for(const[,el]of live)dropCard(el); live.clear();
  computeLayout();
  grid.style.height=totalH()+'px';
  gw.scrollTop=0; updateCounter(); renderVisible();
}

function updateCounter() {
  const n=shown.length,t=all.length;
  counter.textContent=n===t?`${n} images`:`${n} / ${t}`;
}

gw.addEventListener('scroll',()=>{lastScrollAt=Date.now();sched();},{passive:true});

let resizeTid;
window.addEventListener('resize',()=>{
  initPts();
  clearTimeout(resizeTid);
  resizeTid=setTimeout(()=>{
    if(!shown.length)return;
    requestAnimationFrame(()=>requestAnimationFrame(rebuildGrid));
  },200);
});

// ── loading state ──────────────────────────────────────────────
function setLoading(msg) {
  dzMain.style.display='none'; loadState.style.display='block';
  loadLbl.textContent=msg; pFill.style.width='0%'; pPct.textContent='0%';
}
function unsetLoading() {
  dzMain.style.display=''; loadState.style.display='none';
}

// ── favorites ──────────────────────────────────────────────────
function toggleFav(path,cardBtn) {
  const was=favs.has(path);
  was?favs.delete(path):favs.add(path);
  api.saveFavorites([...favs]);
  if(cardBtn){
    cardBtn.textContent=was?'☆':'★';
    // only hide if not a permanent fav — leave hover-reveal logic to mouseenter/leave
    if(!was){ cardBtn.style.opacity='1'; cardBtn.style.borderColor='#f9e2af'; }
    else     { cardBtn.style.opacity='0'; cardBtn.style.borderColor='rgba(203,166,247,.25)'; }
    cardBtn.classList.toggle('active',!was);
  }
  syncLbFav();
  showToast(was?'Removed from favorites':'★ Added to favorites');
  if(favsOnly&&was){applyFilter();rebuildGrid();}
}

function syncLbFav() {
  const item=shown[lbI];if(!item)return;
  const f=favs.has(item.filePath);
  lbFavBtn.textContent=f?'★':'☆';
  lbFavBtn.classList.toggle('active',f);
}

// ── lightbox ───────────────────────────────────────────────────
function openLb(idx){lbI=idx;zoomed=false;lbImg.style.cursor='zoom-in';lb.classList.add('active');renderLb();}

function renderLb() {
  const item=shown[lbI];if(!item)return;
  zoomed=false;
  lbImg.style.transform='';lbImg.style.transformOrigin='';
  lbImg.classList.remove('zoomed');
  lbImg.style.display='none';lbVid.style.display='none';lbErr.style.display='none';
  if(item.isVideo){
    lbVid.src=fileUrl(item.filePath);lbVid.style.display='block';
  } else {
    lbVid.pause();lbVid.src='';
    lbImg.onload=()=>{lbErr.style.display='none';lbImg.style.display='block';};
    lbImg.onerror=()=>{
      lbImg.style.display='none';
      if(!item._heicTriedLb){                 // HEIC photo with a .jpg name? decode it, then show it
        item._heicTriedLb=true;
        lbErr.innerHTML='<span class="big">⏳</span>Converting photo…';lbErr.style.display='block';
        isHeic(item).then(async yes=>{
          const url=yes?await heicUrl(item):null;
          if(url&&shown[lbI]===item){lbImg.src=url;lbImg.style.display='block';}
          else if(shown[lbI]===item){fillBroken(lbErr,item,true);}
        });
        return;
      }
      fillBroken(lbErr,item,true);lbErr.style.display='block';   // explain instead of a black screen
    };
    lbImg.src=heicUrls.get(item.filePath)||fileUrl(item.filePath);lbImg.style.display='block';
  }
  const parts=[];
  if(item.width)  parts.push(`${item.width}×${item.height}`);
  if(item.size)   parts.push(`${(item.size/1024).toFixed(0)} KB`);
  if(item.mtime)  parts.push(new Date(item.mtime).toLocaleDateString());
  // safe: avoid XSS from filenames with < > &
  lbInfo.innerHTML = '';
  const nameEl = document.createElement('strong');
  nameEl.textContent = item.name;
  lbInfo.appendChild(nameEl);
  if(parts.length){
    const detailEl = document.createElement('span');
    detailEl.textContent = ' · ' + parts.join(' · ');
    detailEl.style.color = 'rgba(255,255,255,.6)';
    detailEl.style.fontSize = '11px';
    lbInfo.appendChild(detailEl);
  }
  syncLbFav();
}

lbImg.addEventListener('click',e=>{
  if(zoomed){
    zoomed=false;lbImg.classList.remove('zoomed');
    lbImg.style.transform='';lbImg.style.transformOrigin='';lbImg.style.cursor='zoom-in';
  } else {
    zoomed=true;lbImg.classList.add('zoomed');
    const r=lbImg.getBoundingClientRect();
    lbImg.style.transformOrigin=`${((e.clientX-r.left)/r.width*100).toFixed(1)}% ${((e.clientY-r.top)/r.height*100).toFixed(1)}%`;
    lbImg.style.transform='scale(2.6)';lbImg.style.cursor='zoom-out';
  }
});

$('lbClose').onclick=closeLb;
$('lbPrev').onclick =()=>nav(-1);
$('lbNext').onclick =()=>nav(+1);
lbFavBtn.onclick    =()=>toggleFav(shown[lbI]?.filePath,null);
$('lbCopyPath').onclick   =async()=>{const i=shown[lbI];if(i){await api.copyToClipboard(i.filePath);showToast('Path copied');}};
$('lbOpenFolder').onclick =async()=>{const i=shown[lbI];if(i)await api.showInFolder(i.filePath);};

function nav(dir){lbVid.pause();lbI=(lbI+dir+shown.length)%shown.length;renderLb();if(ssOn)resetSs();}
function closeLb(){lb.classList.remove('active');lbVid.pause();lbVid.src='';stopSs();}
lb.addEventListener('click',e=>{if(e.target===lb)closeLb();});

// ── slideshow ──────────────────────────────────────────────────
ssBtn.addEventListener('click',()=>{
  if(!shown.length)return;
  if(!lb.classList.contains('active'))openLb(lbI);
  ssOn?stopSs():startSs();
});

function startSs(){
  ssOn=true;ssBtn.classList.add('active');ssBtn.textContent='⏸ Slideshow';
  ssBar.classList.add('active');tickSs();
}
function tickSs(){
  ssProg.style.transition='none';ssProg.style.width='0%';
  ssProg.getBoundingClientRect();
  ssProg.style.transition=`width ${SS_MS}ms linear`;ssProg.style.width='100%';
  ssTid=setTimeout(()=>nav(+1),SS_MS);
}
function resetSs(){clearTimeout(ssTid);tickSs();}
function stopSs(){
  ssOn=false;clearTimeout(ssTid);
  ssBtn.classList.remove('active');ssBtn.textContent='▶ Slideshow';
  ssBar.classList.remove('active');
  ssProg.style.transition='none';ssProg.style.width='0%';
}

// ── keyboard ───────────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  const tag=(e.target&&e.target.tagName)||'';
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;   // let the user type (e.g. a space in search)
  const inLb=lb.classList.contains('active');
  if(!inLb){if(e.key===' '){e.preventDefault();if(shown.length){openLb(0);startSs();}}return;}
  switch(e.key){
    case 'ArrowLeft': case 'a': nav(-1);break;
    case 'ArrowRight':case 'd': nav(+1);break;
    case 'Escape': closeLb();break;
    case 'f':case 'F': toggleFav(shown[lbI]?.filePath,null);break;
    case ' ': e.preventDefault();ssOn?stopSs():startSs();break;
  }
});

// ── recent paths ───────────────────────────────────────────────
async function initRecent() {
  if(!api.loadRecent)return;
  recentPaths=await api.loadRecent()||[];
  renderRecent();
}

async function saveRecent(folderPath) {
  if(!api.saveRecent)return;
  recentPaths=[folderPath,...recentPaths.filter(p=>p!==folderPath)].slice(0,2);
  await api.saveRecent(recentPaths);
  renderRecent();
}

function renderRecent() {
  if(!document.getElementById('rcCSS')){
    const s=document.createElement('style');s.id='rcCSS';
    s.textContent=`
      #recentWrap{margin-bottom:14px;display:flex;flex-direction:column;gap:8px;}
      .rc{display:flex;align-items:center;gap:12px;padding:11px 14px;
        background:rgba(49,50,68,.7);border:1px solid rgba(69,71,90,.8);
        border-radius:12px;cursor:pointer;text-align:left;width:100%;
        transition:border-color .2s,background .2s,box-shadow .2s;}
      .rc:hover{border-color:rgba(203,166,247,.7);background:rgba(203,166,247,.1);
        box-shadow:0 0 0 1px rgba(203,166,247,.12);}
      .rc-icon{font-size:1.3em;flex-shrink:0;line-height:1;}
      .rc-text{flex:1;min-width:0;font-family:inherit;}
      .rc-name{color:#cdd6f4;font-size:13px;font-weight:500;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;}
      .rc-path{color:#6c7086;font-size:10.5px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .rc-arrow{color:#7f849c;font-size:15px;flex-shrink:0;transition:color .2s,transform .2s;}
      .rc:hover .rc-arrow{color:#cba6f7;transform:translateX(3px);}
    `;
    document.head.appendChild(s);
  }

  let wrap=$('recentWrap');
  if(!wrap){
    wrap=document.createElement('div');wrap.id='recentWrap';
    const wbox=document.querySelector('.wbox');
    const dz=$('dropzone');
    if(wbox&&dz)wbox.insertBefore(wrap,dz);
    else if(dzMain)dzMain.prepend(wrap);
  }
  wrap.style.display=recentPaths.length?'':'none';
  wrap.innerHTML='';
  if(!recentPaths.length)return;

  recentPaths.forEach(p=>{
    const parts=p.replace(/\\/g,'/').split('/').filter(Boolean);
    const name=parts[parts.length-1]||p;
    const btn=document.createElement('button');
    btn.className='rc';btn.title=p;
    // safe: set text content separately to avoid XSS from path names
    const icon  = document.createElement('span'); icon.className='rc-icon'; icon.textContent='📂';
    const text  = document.createElement('span'); text.className='rc-text';
    const rname = document.createElement('div');  rname.className='rc-name'; rname.textContent=name;
    const rpath = document.createElement('div');  rpath.className='rc-path'; rpath.textContent=p;
    const arrow = document.createElement('span'); arrow.className='rc-arrow'; arrow.textContent='→';
    text.appendChild(rname); text.appendChild(rpath);
    btn.appendChild(icon); btn.appendChild(text); btn.appendChild(arrow);
    btn.onclick=()=>loadFolder(p);
    wrap.appendChild(btn);
  });
}

// ── reset ──────────────────────────────────────────────────────
function doReset() {
  stopSs();closeLb();
  all=[];shown=[];
  for(const[,el]of live)dropCard(el);live.clear();
  grid.style.height='0';colH=[];slots=[];
  gw.scrollTop=0;gw.classList.remove('visible');
  welcome.classList.remove('hidden');
  bgToken++; thumbQ.length=0;            // stop background thumbnail work
  setParticles(true);
  srch.value='';favsOnly=false;
  favsBtn.classList.remove('active');favsBtn.textContent='⭐ Favorites';
  counter.textContent='0 images';
  renderRecent();
}

// ── init ───────────────────────────────────────────────────────
initRecent();
