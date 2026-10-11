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
const BUFFER  = 900;
const TIMEOUT = 8000;
const SS_MS   = 4500;

// ── helpers ────────────────────────────────────────────────────
// Encode special chars (#, ?, spaces, etc.) in file paths for use as URLs.
// We split on '/' and encode each segment individually to preserve path separators.
function fileUrl(filePath) {
  const encoded = filePath.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return 'localfile://' + encoded;
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
function tickPts() {
  if (!pctx) return;
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
  const paths=Array.from(e.dataTransfer.files).map(f=>f.path).filter(Boolean);
  if (paths.length) ingestFiles(paths);
});

// ── load ───────────────────────────────────────────────────────
const IMG_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','jfif','avif','webm','mp4']);

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
  await getDims(all);
  applySort();
  applyFilter();
  openGallery();
}

// ── dimensions — timeout prevents hung images blocking batch ───
async function getDims(items) {
  const BATCH=30; let done=0;
  const probe = item => new Promise(res=>{
    if (item.aspect) { updateProg(++done,items.length); res(); return; }
    let ok=false;
    const finish=(w,h)=>{
      if(ok)return; ok=true; clearTimeout(tid);
      item.width=Math.max(w||1,1); item.height=Math.max(h||1,1);
      item.aspect=item.width/item.height;
      updateProg(++done,items.length); res();
    };
    const tid=setTimeout(()=>finish(4,3),TIMEOUT);
    if (item.isVideo) {
      const v=document.createElement('video');
      v.onloadedmetadata=()=>finish(v.videoWidth,v.videoHeight);
      v.onerror=()=>finish(0,0); v.src=fileUrl(item.filePath);
    } else {
      const img=new Image();
      img.onload=()=>finish(img.naturalWidth,img.naturalHeight);
      img.onerror=()=>finish(0,0);
      img.src=fileUrl(item.filePath);
      if(img.complete&&img.naturalWidth) finish(img.naturalWidth,img.naturalHeight);
    }
  });
  for(let i=0;i<items.length;i+=BATCH)
    await Promise.all(items.slice(i,i+BATCH).map(probe));
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
  const t0=st-BUFFER,t1=st+vpH+BUFFER;
  const want=new Set();
  for(let i=0;i<shown.length;i++){
    const s=slots[i];if(!s||s.h===undefined)continue;
    if(s.top+s.h>=t0&&s.top<=t1)want.add(i);
  }
  for(const[i,el]of live){if(!want.has(i)){el.remove();live.delete(i);}}
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

function makeCard(item,idx,cw,ch) {
  const el=document.createElement('div');
  el.className='masonry-item';
  el.style.height=ch+'px';
  el.style.overflow='hidden';

  const sk=document.createElement('div');
  sk.className='skeleton'; sk.style.height=ch+'px';
  el.appendChild(sk);

  const rmSk =()=>sk.parentNode&&sk.remove();
  const errSk=()=>{sk.style.opacity='.08';sk.style.animation='none';};

  if(item.isVideo){
    const v=document.createElement('video');
    v.muted=true;v.loop=true;v.autoplay=true;v.playsInline=true;
    v.style.cssText=`width:100%;height:${ch}px;object-fit:cover;display:block;border-radius:13px;`;
    v.onloadeddata=rmSk; v.onerror=errSk;
    v.src=fileUrl(item.filePath);
    el.appendChild(v);
    const b=document.createElement('span');
    b.className='vid-badge';b.textContent='VIDEO';el.appendChild(b);
  } else {
    const img=document.createElement('img');
    img.alt=item.name; img.decoding='async';
    // opacity avoids cache-hit invisibility bug
    img.style.cssText='width:100%;height:auto;display:block;border-radius:13px;opacity:0;transition:opacity .25s;';
    const show=()=>{rmSk();img.style.opacity='1';el.style.height='auto';};
    img.onload=show; img.onerror=errSk;
    img.src=fileUrl(item.filePath);
    if(img.complete&&img.naturalWidth>0)show();
    el.appendChild(img);
  }

  // fav button
  const isFav=favs.has(item.filePath);
  const fb=document.createElement('button');
  fb.className='fav-btn'+(isFav?' active':'');
  fb.textContent=isFav?'★':'☆';
  fb.style.cssText='position:absolute;top:7px;right:7px;width:28px;height:28px;border-radius:8px;border:1px solid rgba(203,166,247,.25);background:rgba(17,17,27,.65);display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;opacity:0;transition:opacity .2s,transform .2s;z-index:5;backdrop-filter:blur(6px);';
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
  for(const[,el]of live)el.remove(); live.clear();
  computeLayout();
  grid.style.height=totalH()+'px';
  gw.scrollTop=0; updateCounter(); renderVisible();
}

function updateCounter() {
  const n=shown.length,t=all.length;
  counter.textContent=n===t?`${n} images`:`${n} / ${t}`;
}

gw.addEventListener('scroll',sched,{passive:true});

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
  lbImg.style.display='none';lbVid.style.display='none';
  if(item.isVideo){
    lbVid.src=fileUrl(item.filePath);lbVid.style.display='block';
  } else {
    lbVid.pause();lbVid.src='';
    lbImg.src=fileUrl(item.filePath);lbImg.style.display='block';
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
  for(const[,el]of live)el.remove();live.clear();
  grid.style.height='0';colH=[];slots=[];
  gw.scrollTop=0;gw.classList.remove('visible');
  welcome.classList.remove('hidden');
  srch.value='';favsOnly=false;
  favsBtn.classList.remove('active');favsBtn.textContent='⭐ Favorites';
  counter.textContent='0 images';
  renderRecent();
}

// ── init ───────────────────────────────────────────────────────
initRecent();
