const KEY='harmonic-city-state-v2';
const LEGACY_KEY='harmonic-city-state-v1';
const SYNC_META_KEY='harmonic-city-public-sync-v1';
const DB_NAME='harmonic-city-media';
const STORE='assets';
// Captured before cloud-sync-v2.js monkeypatches localStorage.setItem (to flag local
// edits as "dirty"/pending-cloud-upload). Live-sync writes below are pulling FROM the
// public source, not a local edit awaiting upload, so they must bypass that tracking.
const rawLocalStorageSet=localStorage.setItem.bind(localStorage);

// Public, permanent home for the owner's real branding media (background/intro/core/audio).
// This is his own Supabase project's public storage bucket -- not a third-party CDN -- used
// as a fallback for any visitor whose browser has no locally-synced media in IndexedDB yet.
// See scripts/diagnostic.mjs and README for how to refresh these paths after a re-upload.
const DEFAULT_MEDIA_BASE='https://xsslskkhxyavwvuxyelf.supabase.co/storage/v1/object/public/harmonic-city-media/b7387b68-4169-4c9b-a4cc-64d576cdeca8/harmonic-city';
// The core media is a 300-frame, 21.6MB animated GIF. GIFs are software-decoded frame
// by frame (no hardware acceleration like video), and continuously re-decoding one at
// full size inside the 3D-transformed, box-shadowed orbit stack is a major source of
// lag/freezing on iPhone Safari. Touch devices get a static frame instead -- same
// artwork, decoded once, no ongoing cost. Desktop is unaffected either way.
const isTouchDevice=matchMedia('(hover: none) and (pointer: coarse)').matches;
const defaultMedia={
  background:{url:`${DEFAULT_MEDIA_BASE}/background/33eb1859-6fef-4afe-864c-1107b4192a8d-Animated-loop.mp4`,type:'video/mp4'},
  intro:{url:`${DEFAULT_MEDIA_BASE}/intro/17b08f2a-1a03-4756-ab55-87fafe641211-Tv-loop.mp4`,type:'video/mp4'},
  core:isTouchDevice?{url:'./defaults/icons/core-static.webp',type:'image/webp'}:{url:`${DEFAULT_MEDIA_BASE}/core/6a68cfd1-255c-4c99-ba09-1047f9dd67a5-Loop-Glow-GIF-by-xponentialdesign.gif`,type:'image/gif'},
  audio:{url:`${DEFAULT_MEDIA_BASE}/audio/3c300a37-dddc-4c59-97af-b2a156cd5107-Is-it-worth-it_3.wav`,type:'audio/wav'}
};

const defaults={
  portalTitle:'Harmonic City',heroTitle:'Harmonic City',heroEyebrow:'WELCOME TO the UNIVERSE',heroDescription:'Hoopz, food, fashion, and every world sowed to Melodic. Choose your melody.',introTitle:'Harmonic City',introKicker:'WELCOME TO',headlineFont:'Playfair Display',bodyFont:'Playfair Display',heroTextSize:92,profileTitleSize:72,bodyTextSize:17,iconScale:100,orbitSpeed:12,volume:.2,heroLayout:'split',profileLayout:'reverse',socialStyle:'icon-label',orbitNodeStyle:'icon-only',primary:'#a54cff',secondary:'#5520a8',accent:'#ff57dc',background:'#06020a',surface:'#160920',text:'#fbf5ff',activeWorld:'thatsmelodic',backgroundMediaId:null,introMediaId:null,audioMediaId:null,coreMediaId:null,coreSize:190,coreShape:'circle',coreFallback:'∞',
  worlds:[
    {id:'thatsmelodic',name:'thatsmelodic',eyebrow:'PERSONAL PAGE',description:'Music, personality, basketball, announcements, & BTS. The Melody that Stitches it all together.',emoji:'🎵',customIcon:'./defaults/icons/thatsmelodic.png',socialIcons:{},socials:{youtube:'https://www.youtube.com/@thatsmelodic',instagram:'https://www.instagram.com/thatsmelodic',tiktok:'https://www.tiktok.com/@thatsmelodic',facebook:'https://www.facebook.com/share/1G8drmZJ7s/'}},
    {id:'schmakinn',name:'Schmakinn',eyebrow:'EATING CHANNEL',description:'Food reviews, mukbangs, challenges, honest reactions, and meals that are actually schmackin.',emoji:'🍔',customIcon:'./defaults/icons/schmakinn.png',socialIcons:{},socials:{youtube:'https://youtube.com/@schmackinn',instagram:'https://www.instagram.com/schmakinn',tiktok:'https://www.tiktok.com/@schmackinn',facebook:'https://www.facebook.com/share/1H9x4fD9zo/'}},
    {id:'2harmonic',name:'2Harmonic',eyebrow:'CLOTHING LINE',description:'Stitched Melodies—fashion built around harmony, expression, duality, and the messages that keep people moving.',emoji:'👕',customIcon:'./defaults/icons/2harmonic.png',socialIcons:{},socials:{youtube:'https://youtube.com/@2harmonic',instagram:'https://www.instagram.com/2harmonic',facebook:'https://www.facebook.com/share/183jemgJ89/',website:'https://twoharmonic.com'}}
  ]
};

const themes={lifted:{label:'Lifted Beige',primary:'#d8b67a',secondary:'#8e6840',accent:'#f7e7bd',background:'#0b0806',surface:'#1a120d',text:'#fff8e9',headlineFont:'Playfair Display'},royal:{label:'Royal Desert',primary:'#c89b57',secondary:'#6d4827',accent:'#fff0c7',background:'#100b07',surface:'#25170e',text:'#fff9ec',headlineFont:'Playfair Display'},midnight:{label:'Midnight Melody',primary:'#a54cff',secondary:'#5520a8',accent:'#ff57dc',background:'#06020a',surface:'#160920',text:'#fbf5ff',headlineFont:'Archivo Black'},food:{label:'Schmakinn Neon',primary:'#ff5a24',secondary:'#1588ff',accent:'#72ff49',background:'#070707',surface:'#1c100a',text:'#fff5e9',headlineFont:'Archivo Black'},gym:{label:'Fried Em Gym',primary:'#8a52ff',secondary:'#e03737',accent:'#ffffff',background:'#08070c',surface:'#17121f',text:'#ffffff',headlineFont:'Archivo Black'},rose:{label:'Rose Gold',primary:'#d9939f',secondary:'#805461',accent:'#ffe8df',background:'#10080b',surface:'#25151b',text:'#fff7f3',headlineFont:'Playfair Display'}};

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const clone=o=>JSON.parse(JSON.stringify(o));
function mergeDefaults(saved){const next={...clone(defaults),...(saved||{})};next.worlds=clone(defaults.worlds).map(base=>{const old=(saved?.worlds||[]).find(w=>w.id===base.id)||{};return {...base,...old,socials:{...base.socials,...(old.socials||{})},socialIcons:{...(base.socialIcons||{}),...(old.socialIcons||{})}}});return next}
function loadState(){try{const saved=JSON.parse(localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY)||'null');return mergeDefaults(saved)}catch{return clone(defaults)}}
let state=loadState(), library={background:[],intro:[],audio:[],core:[]}, audio=new Audio(), playing=false, saveTimer;

function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:'id'});s.createIndex('kind','kind')}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbPut(item){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(item);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function dbDelete(id){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function dbAll(){const db=await openDB();return new Promise((res,rej)=>{const req=db.transaction(STORE).objectStore(STORE).getAll();req.onsuccess=()=>res(req.result||[]);req.onerror=()=>rej(req.error)})}

function save(){clearTimeout(saveTimer);$('#saveStatus').textContent='Saving…';saveTimer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(state));$('#saveStatus').textContent='Saved automatically'}catch(e){$('#saveStatus').textContent='Icon file too large to save';console.error(e)}},150)}
function media(kind,id){return library[kind].find(x=>x.id===id)||defaultMedia[kind]}
function mediaUrl(item){if(!item)return'';if(!item.url)item.url=URL.createObjectURL(item.blob);return item.url}
function element(item){const e=document.createElement(item.type.startsWith('video/')?'video':'img');e.src=mediaUrl(item);if(e.tagName==='VIDEO'){e.autoplay=e.loop=e.muted=e.playsInline=true;e.setAttribute('playsinline','');e.onerror=()=>{if(e.dataset.retried)return;e.dataset.retried='1';setTimeout(()=>{e.src=mediaUrl(item)},1200)}}else e.alt='';return e}

const socialIcons={youtube:'▶',instagram:'◎',tiktok:'♪',snapchat:'◉',facebook:'f',website:'↗'};
// Tracks what's actually in the DOM for background/intro/core media so re-renders
// (e.g. the live-sync refresh in fetchPublicDefaults) don't tear down and restart an
// already-playing video/audio when the resolved media hasn't actually changed.
let renderedMedia={background:null,intro:null,core:null};
const coreEl=document.createElement('div');
function render(){const r=document.documentElement;['primary','secondary','accent','background','surface','text'].forEach(k=>r.style.setProperty('--'+k,state[k]));r.style.setProperty('--icon-scale',state.iconScale/100);r.style.setProperty('--orbit-duration',state.orbitSpeed+'s');r.style.setProperty('--headline',`'${state.headlineFont}'`);r.style.setProperty('--body',`'${state.bodyFont}'`);r.style.setProperty('--hero-size',state.heroTextSize+'px');r.style.setProperty('--profile-title-size',state.profileTitleSize+'px');r.style.setProperty('--body-size',state.bodyTextSize+'px');r.style.setProperty('--core-size',state.coreSize+'px');$('#heroPanel').dataset.layout=state.heroLayout;$('#orbitSystem').dataset.nodeStyle=state.orbitNodeStyle||'framed';$('#portalTitleTop').textContent=state.portalTitle.toUpperCase();$('#heroTitle').textContent=state.heroTitle;$('#heroEyebrow').textContent=state.heroEyebrow;$('#heroDescription').textContent=state.heroDescription;$('#introTitle').textContent=state.introTitle;$('#introKicker').textContent=state.introKicker;$$('[data-setting]').forEach(i=>{if(document.activeElement!==i)i.value=state[i.dataset.setting]});audio.volume=state.volume;renderMedia();renderOrbit();renderProfile();renderHistory();renderWorldEditor()}
function renderMedia(){[['background','#backgroundStage'],['intro','#introMedia']].forEach(([k,s])=>{const item=media(k,state[k+'MediaId']),key=item?mediaUrl(item):null;if(renderedMedia[k]===key)return;renderedMedia[k]=key;const box=$(s);box.innerHTML='';if(item)box.appendChild(element(item))})}
function renderOrbit(){const box=$('#orbitSystem');box.innerHTML='<div class="orbit-ring"></div>';coreEl.className=`orbit-core core-${state.coreShape||'sphere'}`;const coreItem=media('core',state.coreMediaId),coreKey=coreItem?mediaUrl(coreItem):null;if(renderedMedia.core!==coreKey){renderedMedia.core=coreKey;coreEl.innerHTML='';if(coreItem){coreEl.classList.add('has-media');coreEl.appendChild(element(coreItem))}else{coreEl.classList.remove('has-media');const fallback=document.createElement('span');fallback.className='core-fallback';fallback.textContent=state.coreFallback||'∞';coreEl.appendChild(fallback)}}box.appendChild(coreEl);state.worlds.forEach((w,i)=>{const b=document.createElement('button');b.className='world-node';b.style.setProperty('--i',i);b.innerHTML=`<span class="world-icon">${w.customIcon?`<img src="${w.customIcon}" alt="${w.name}">`:w.emoji}</span><span class="world-label">${w.name}</span>`;b.onclick=()=>{state.activeWorld=w.id;renderProfile();save();$('#profileStage').scrollIntoView({behavior:'smooth'})};box.appendChild(b)})}
function socialIconMarkup(w,key){const custom=w.socialIcons?.[key];return custom?`<img class="custom-social-icon" src="${custom}" alt="">`:(socialIcons[key]||'↗')}
function renderProfile(){const w=state.worlds.find(x=>x.id===state.activeWorld)||state.worlds[0],f=$('#profileTemplate').content.cloneNode(true),card=f.querySelector('.profile-card');card.dataset.layout=state.profileLayout;f.querySelector('.profile-art').innerHTML=w.customIcon?`<img src="${w.customIcon}" alt="${w.name}">`:w.emoji;f.querySelector('.profile-eyebrow').textContent=w.eyebrow;f.querySelector('.profile-title').textContent=w.name;f.querySelector('.profile-description').textContent=w.description;const grid=f.querySelector('.social-grid');grid.dataset.style=state.socialStyle;Object.entries(w.socials).forEach(([k,u])=>{if(!u)return;const a=document.createElement('a');a.className='social-link';a.href=u;a.target='_blank';a.rel='noopener';a.innerHTML=`<span class="social-icon" aria-hidden="true">${socialIconMarkup(w,k)}</span><span class="social-label">${k}</span>`;grid.appendChild(a)});$('#profileStage').replaceChildren(f)}

function setupDrop(zoneSel,inputSel,kind){const z=$(zoneSel),i=$(inputSel);z.onclick=()=>i.click();z.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();i.click()}};['dragenter','dragover'].forEach(t=>z.addEventListener(t,e=>{e.preventDefault();z.classList.add('dragover')}));['dragleave','drop'].forEach(t=>z.addEventListener(t,e=>{e.preventDefault();z.classList.remove('dragover')}));z.addEventListener('drop',e=>readFiles(e.dataTransfer.files,kind));i.onchange=e=>{readFiles(e.target.files,kind);i.value=''}}
async function readFiles(files,kind){for(const file of [...files]){const valid=kind==='audio'?file.type.startsWith('audio/'):file.type.startsWith('image/')||file.type.startsWith('video/');if(!valid)continue;const item={id:crypto.randomUUID(),kind,name:file.name,type:file.type,blob:file,createdAt:Date.now()};await dbPut(item);library[kind].unshift(item);state[kind+'MediaId']=item.id;if(kind==='audio')loadAudio();render();save()}}
function renderHistory(){['background','intro','audio','core'].forEach(kind=>{const box=$('#'+kind+'History');if(!box)return;box.innerHTML='';library[kind].forEach(item=>{const c=document.createElement('div');c.className='history-item';c.title=item.name;if(kind==='audio')c.innerHTML='<div class="audio-history-icon">♪</div>';else c.appendChild(element(item));const x=document.createElement('button');x.textContent='×';x.onclick=async e=>{e.stopPropagation();await dbDelete(item.id);library[kind]=library[kind].filter(m=>m.id!==item.id);if(state[kind+'MediaId']===item.id)state[kind+'MediaId']=null;render();save()};c.appendChild(x);c.onclick=()=>{state[kind+'MediaId']=item.id;if(kind==='audio')loadAudio();render();save()};box.appendChild(c)})})}
function loadAudio(){const item=media('audio',state.audioMediaId);if(!item)return;const url=mediaUrl(item);if(audio.src===url)return;const was=playing;audio.pause();audio=new Audio(url);audio.loop=true;audio.volume=state.volume;audio.onplay=()=>audioUI(true);audio.onpause=()=>audioUI(false);if(was)audio.play().catch(()=>audioUI(false))}
function audioUI(on){playing=on;$('#audioToggle').textContent=on?'Ⅱ Pause audio':'▶ Play audio'}
async function toggleAudio(){if(!audio.src)loadAudio();if(!audio.src){$('#audioToggle').textContent='Upload audio first';return}if(!audio.paused)audio.pause();else await audio.play().catch(()=>{$('#audioToggle').textContent='Tap again to play'})}
// Browsers block unprompted audio with sound; there's no way around that. Instead of
// requiring visitors to find and press the small "Play audio" pill specifically, treat
// ANY first tap/click/keypress on the page as that permission -- e.g. tapping "Enter
// Portal" on the intro screen, which is almost always a visitor's first interaction.
function armFirstInteractionAudio(){
  const start=()=>{
    document.removeEventListener('pointerdown',start);
    document.removeEventListener('keydown',start);
    if(!audio.src||!audio.paused)return;
    audio.play().catch(()=>{});
  };
  document.addEventListener('pointerdown',start,{once:true});
  document.addEventListener('keydown',start,{once:true});
}

// iOS Safari aggressively pauses <video> playback when the tab/app is backgrounded
// (to save power) and does not resume it automatically when you come back -- the
// background video, intro video, and any video-backed core media are all affected.
// This is what makes the page look permanently frozen after switching apps or locking
// the phone and returning, even though nothing actually crashed. bfcache restores
// (fired as a 'pageshow' event with persisted:true) hit the same issue since no script
// re-runs on that path -- init() never fires again, so this can't rely on page load.
function resumeMediaOnForeground(){
  document.querySelectorAll('video').forEach(v=>{if(v.paused)v.play().catch(()=>{})});
}

// Simply re-playing paused <video> elements (above) was not enough: on a real iPhone,
// backgrounding long enough also gets the CSS-driven orbit icon animation stuck static,
// and can leave click handlers (Connect Cloud, Sign in, Sync now, etc.) silently
// unresponsive -- just resuming video playback does nothing for either, because iOS is
// evicting/suspending more of the page's render and script state than just the video
// decode session, and there's no API to detect or force-repair that from script. A full
// reload is the one thing guaranteed to reset every stuck layer, since it's what iOS
// itself does for ordinary tabs it evicts under memory pressure. Scoped to iOS only
// (confirmed fine on Android) and only after a background long enough to plausibly be
// the trigger, so a quick glance at the app switcher doesn't cause a jarring reload.
const isIOS=document.documentElement.classList.contains('is-ios');
const IOS_RELOAD_THRESHOLD_MS=1000;
let hiddenAt=0;
function handleForegroundReturn(){
  if(isIOS&&hiddenAt&&Date.now()-hiddenAt>IOS_RELOAD_THRESHOLD_MS){location.reload();return}
  resumeMediaOnForeground();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenAt=Date.now();else handleForegroundReturn()});
// WebKit silently swallows a location.reload() called synchronously (or even via a 0ms
// setTimeout) from inside a 'pageshow' handler -- it looks like a guard against reload
// loops during the page-transition lifecycle. A short deferral lets the navigation through.
window.addEventListener('pageshow',e=>{if(e.persisted){if(isIOS){setTimeout(()=>location.reload(),250)}else{resumeMediaOnForeground()}}});
window.addEventListener('focus',handleForegroundReturn);

function fileToDataUrl(file,done){if(!file||!file.type.startsWith('image/'))return;const r=new FileReader();r.onload=()=>done(r.result);r.readAsDataURL(file)}
function renderWorldEditor(){const e=$('#worldEditor');e.innerHTML='';state.worlds.forEach((w,n)=>{const d=document.createElement('details');d.innerHTML=`<summary>${w.name}</summary>`;[['name','World name'],['eyebrow','Label'],['description','Description'],['emoji','Fallback icon']].forEach(([k,l])=>{const label=document.createElement('label'),input=k==='description'?document.createElement('textarea'):document.createElement('input');label.textContent=l;input.value=w[k];input.oninput=()=>{state.worlds[n][k]=input.value;renderOrbit();renderProfile();save()};label.appendChild(input);d.appendChild(label)});const label=document.createElement('label'),input=document.createElement('input');label.textContent='Custom world icon';input.type='file';input.accept='image/*';input.onchange=()=>fileToDataUrl(input.files[0],data=>{state.worlds[n].customIcon=data;render();save()});label.appendChild(input);d.appendChild(label);

const socialHeading=document.createElement('p');socialHeading.className='editor-subheading';socialHeading.textContent='Custom social icons';d.appendChild(socialHeading);const socialEditor=document.createElement('div');socialEditor.className='social-icon-editor';Object.keys(w.socials).forEach(key=>{const row=document.createElement('div');row.className='social-icon-row';const preview=document.createElement('span');preview.className='social-icon-preview';preview.innerHTML=socialIconMarkup(w,key);const name=document.createElement('strong');name.textContent=key;const upload=document.createElement('label');upload.className='mini-upload';upload.textContent='Upload';const socialInput=document.createElement('input');socialInput.type='file';socialInput.accept='image/*';socialInput.hidden=true;socialInput.onchange=()=>fileToDataUrl(socialInput.files[0],data=>{state.worlds[n].socialIcons=state.worlds[n].socialIcons||{};state.worlds[n].socialIcons[key]=data;renderProfile();renderWorldEditor();save()});upload.appendChild(socialInput);const reset=document.createElement('button');reset.type='button';reset.className='mini-reset';reset.textContent='Default';reset.onclick=()=>{if(state.worlds[n].socialIcons)delete state.worlds[n].socialIcons[key];renderProfile();renderWorldEditor();save()};row.append(preview,name,upload,reset);socialEditor.appendChild(row)});d.appendChild(socialEditor);e.appendChild(d)})}

Object.entries(themes).forEach(([id,t])=>{const b=document.createElement('button');b.className='theme-button';b.textContent=t.label;b.onclick=()=>{Object.assign(state,t);render();save()};$('#themeGrid').appendChild(b)});
$$('[data-setting]').forEach(i=>i.oninput=()=>{state[i.dataset.setting]=i.type==='range'?Number(i.value):i.value;render();save()});
$('#openCustomizer').onclick=()=>$('#customizer').classList.add('open');$('#closeCustomizer').onclick=()=>$('#customizer').classList.remove('open');$('#enterPortal').onclick=()=>$('#introScreen').classList.add('hidden');$('#audioToggle').onclick=toggleAudio;
setupDrop('#coreDrop','#coreInput','core');setupDrop('#backgroundDrop','#backgroundInput','background');setupDrop('#introDrop','#introInput','intro');setupDrop('#audioDrop','#audioInput','audio');

async function fetchPublicDefaults(){
  try{
    const res=await fetch('/api/public-portal',{cache:'no-store'});
    if(!res.ok)return;
    const data=await res.json();
    if(!data?.ok||!data.settings)return;

    // The baked-in DEFAULT_MEDIA_BASE core is skipped on touch devices (further up this
    // file) because it's specifically the original 300-frame/21.6MB GIF that caused the
    // iPhone freeze/lag this whole engagement started from. That's about protecting the
    // very first, never-customized load -- it was never meant to also silently override
    // whatever the owner deliberately uploads afterward, so a synced custom asset (this
    // loop) is applied unconditionally, on every platform.
    //
    // defaultMedia is also a plain runtime object -- it resets to the baked-in defaults
    // on every single page load, since nothing about it is ever persisted to localStorage.
    // It has to be re-applied here every time a live update exists, regardless of whether
    // the local *state* itself is already up to date. Gating this on the same "already
    // current" check as the state/localStorage write below was a real bug: a device could
    // correctly persist a synced coreMediaId, then still render the old baked-in image on
    // every subsequent load, because nothing told this fresh defaultMedia object what
    // that id actually resolves to -- until the NEXT time the remote data changed and
    // this function did a full apply again.
    Object.entries(data.settings.assets||{}).forEach(([kind,asset])=>{
      if(asset?.publicUrl)defaultMedia[kind]={url:asset.publicUrl,type:asset.type||defaultMedia[kind]?.type};
    });

    const rawKey=localStorage.getItem(KEY);
    let syncMeta=null;try{syncMeta=JSON.parse(localStorage.getItem(SYNC_META_KEY)||'null')}catch{}
    const hasRealLocalEdit=rawKey!==null&&!syncMeta;
    if(hasRealLocalEdit){render();loadAudio();return} // a person edited this device locally -- never overwrite that, but still re-render with the refreshed asset map above
    if(syncMeta?.updatedAt&&syncMeta.updatedAt===data.updatedAt){render();loadAudio();return} // state already current, but still re-render with the refreshed asset map above

    state=mergeDefaults(data.settings.state||{});
    rawLocalStorageSet(KEY,JSON.stringify(state));
    rawLocalStorageSet(SYNC_META_KEY,JSON.stringify({updatedAt:data.updatedAt||null}));
    render();loadAudio();
  }catch(e){console.warn('[Harmonic City] Live public defaults unavailable, using baked-in defaults.',e)}
}

(async function init(){try{const items=await dbAll();library={background:items.filter(x=>x.kind==='background').sort((a,b)=>b.createdAt-a.createdAt),intro:items.filter(x=>x.kind==='intro').sort((a,b)=>b.createdAt-a.createdAt),audio:items.filter(x=>x.kind==='audio').sort((a,b)=>b.createdAt-a.createdAt),core:items.filter(x=>x.kind==='core').sort((a,b)=>b.createdAt-a.createdAt)}}catch(e){console.error('Media library unavailable',e)}render();loadAudio();armFirstInteractionAudio();if(localStorage.getItem(KEY)!==null||localStorage.getItem(LEGACY_KEY)!==null)save();fetchPublicDefaults()})();