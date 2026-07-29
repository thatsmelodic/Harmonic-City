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
const defaultMedia={
  background:{url:`${DEFAULT_MEDIA_BASE}/background/33eb1859-6fef-4afe-864c-1107b4192a8d-Animated-loop.mp4`,type:'video/mp4'},
  intro:{url:`${DEFAULT_MEDIA_BASE}/intro/17b08f2a-1a03-4756-ab55-87fafe641211-Tv-loop.mp4`,type:'video/mp4'},
  core:{url:`${DEFAULT_MEDIA_BASE}/core/6a68cfd1-255c-4c99-ba09-1047f9dd67a5-Loop-Glow-GIF-by-xponentialdesign.gif`,type:'image/gif'},
  audio:{url:`${DEFAULT_MEDIA_BASE}/audio/3c300a37-dddc-4c59-97af-b2a156cd5107-Is-it-worth-it_3.wav`,type:'audio/wav'}
};

const defaults={
  portalTitle:'Harmonic City',heroTitle:'Harmonic City',heroEyebrow:'WELCOME TO the UNIVERSE',heroDescription:'Hoopz, food, fashion, and every world sowed to Melodic. Choose your melody.',introTitle:'Harmonic City',introKicker:'WELCOME TO',headlineFont:'Playfair Display',bodyFont:'Playfair Display',heroTextSize:82,profileTitleSize:54,bodyTextSize:16,iconScale:125,orbitSpeed:12,volume:.2,heroLayout:'split',profileLayout:'reverse',socialStyle:'icon-label',orbitNodeStyle:'icon-only',primary:'#a54cff',secondary:'#5520a8',accent:'#ff57dc',background:'#06020a',surface:'#160920',text:'#fbf5ff',activeWorld:'thatsmelodic',backgroundMediaId:null,introMediaId:null,audioMediaId:null,coreMediaId:null,coreSize:200,coreShape:'circle',coreFallback:'∞',
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
function element(item){const e=document.createElement(item.type.startsWith('video/')?'video':'img');e.src=mediaUrl(item);if(e.tagName==='VIDEO'){e.autoplay=e.loop=e.muted=e.playsInline=true;e.setAttribute('playsinline','')}else e.alt='';return e}

const socialIcons={youtube:'▶',instagram:'◎',tiktok:'♪',snapchat:'◉',facebook:'f',website:'↗'};
function render(){const r=document.documentElement;['primary','secondary','accent','background','surface','text'].forEach(k=>r.style.setProperty('--'+k,state[k]));r.style.setProperty('--icon-scale',state.iconScale/100);r.style.setProperty('--orbit-duration',state.orbitSpeed+'s');r.style.setProperty('--headline',`'${state.headlineFont}'`);r.style.setProperty('--body',`'${state.bodyFont}'`);r.style.setProperty('--hero-size',state.heroTextSize+'px');r.style.setProperty('--profile-title-size',state.profileTitleSize+'px');r.style.setProperty('--body-size',state.bodyTextSize+'px');r.style.setProperty('--core-size',state.coreSize+'px');$('#heroPanel').dataset.layout=state.heroLayout;$('#orbitSystem').dataset.nodeStyle=state.orbitNodeStyle||'framed';$('#portalTitleTop').textContent=state.portalTitle.toUpperCase();$('#heroTitle').textContent=state.heroTitle;$('#heroEyebrow').textContent=state.heroEyebrow;$('#heroDescription').textContent=state.heroDescription;$('#introTitle').textContent=state.introTitle;$('#introKicker').textContent=state.introKicker;$$('[data-setting]').forEach(i=>{if(document.activeElement!==i)i.value=state[i.dataset.setting]});audio.volume=state.volume;renderMedia();renderOrbit();renderProfile();renderHistory();renderWorldEditor()}
function renderMedia(){[['background','#backgroundStage'],['intro','#introMedia']].forEach(([k,s])=>{const box=$(s),item=media(k,state[k+'MediaId']);box.innerHTML='';if(item)box.appendChild(element(item))})}
function renderOrbit(){const box=$('#orbitSystem');box.innerHTML='<div class="orbit-ring"></div>';const core=document.createElement('div');core.className=`orbit-core core-${state.coreShape||'sphere'}`;const coreItem=media('core',state.coreMediaId);if(coreItem){core.classList.add('has-media');core.appendChild(element(coreItem))}else{const fallback=document.createElement('span');fallback.className='core-fallback';fallback.textContent=state.coreFallback||'∞';core.appendChild(fallback)}box.appendChild(core);state.worlds.forEach((w,i)=>{const b=document.createElement('button');b.className='world-node';b.style.setProperty('--i',i);b.innerHTML=`<span class="world-icon">${w.customIcon?`<img src="${w.customIcon}" alt="${w.name}">`:w.emoji}</span><span class="world-label">${w.name}</span>`;b.onclick=()=>{state.activeWorld=w.id;renderProfile();save();$('#profileStage').scrollIntoView({behavior:'smooth'})};box.appendChild(b)})}
function socialIconMarkup(w,key){const custom=w.socialIcons?.[key];return custom?`<img class="custom-social-icon" src="${custom}" alt="">`:(socialIcons[key]||'↗')}
function renderProfile(){const w=state.worlds.find(x=>x.id===state.activeWorld)||state.worlds[0],f=$('#profileTemplate').content.cloneNode(true),card=f.querySelector('.profile-card');card.dataset.layout=state.profileLayout;f.querySelector('.profile-art').innerHTML=w.customIcon?`<img src="${w.customIcon}" alt="${w.name}">`:w.emoji;f.querySelector('.profile-eyebrow').textContent=w.eyebrow;f.querySelector('.profile-title').textContent=w.name;f.querySelector('.profile-description').textContent=w.description;const grid=f.querySelector('.social-grid');grid.dataset.style=state.socialStyle;Object.entries(w.socials).forEach(([k,u])=>{if(!u)return;const a=document.createElement('a');a.className='social-link';a.href=u;a.target='_blank';a.rel='noopener';a.innerHTML=`<span class="social-icon" aria-hidden="true">${socialIconMarkup(w,k)}</span><span class="social-label">${k}</span>`;grid.appendChild(a)});$('#profileStage').replaceChildren(f)}

function setupDrop(zoneSel,inputSel,kind){const z=$(zoneSel),i=$(inputSel);z.onclick=()=>i.click();z.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();i.click()}};['dragenter','dragover'].forEach(t=>z.addEventListener(t,e=>{e.preventDefault();z.classList.add('dragover')}));['dragleave','drop'].forEach(t=>z.addEventListener(t,e=>{e.preventDefault();z.classList.remove('dragover')}));z.addEventListener('drop',e=>readFiles(e.dataTransfer.files,kind));i.onchange=e=>{readFiles(e.target.files,kind);i.value=''}}
async function readFiles(files,kind){for(const file of [...files]){const valid=kind==='audio'?file.type.startsWith('audio/'):file.type.startsWith('image/')||file.type.startsWith('video/');if(!valid)continue;const item={id:crypto.randomUUID(),kind,name:file.name,type:file.type,blob:file,createdAt:Date.now()};await dbPut(item);library[kind].unshift(item);state[kind+'MediaId']=item.id;if(kind==='audio')loadAudio();render();save()}}
function renderHistory(){['background','intro','audio','core'].forEach(kind=>{const box=$('#'+kind+'History');if(!box)return;box.innerHTML='';library[kind].forEach(item=>{const c=document.createElement('div');c.className='history-item';c.title=item.name;if(kind==='audio')c.innerHTML='<div class="audio-history-icon">♪</div>';else c.appendChild(element(item));const x=document.createElement('button');x.textContent='×';x.onclick=async e=>{e.stopPropagation();await dbDelete(item.id);library[kind]=library[kind].filter(m=>m.id!==item.id);if(state[kind+'MediaId']===item.id)state[kind+'MediaId']=null;render();save()};c.appendChild(x);c.onclick=()=>{state[kind+'MediaId']=item.id;if(kind==='audio')loadAudio();render();save()};box.appendChild(c)})})}
function loadAudio(){const item=media('audio',state.audioMediaId);if(!item)return;const was=playing;audio.pause();audio=new Audio(mediaUrl(item));audio.loop=true;audio.volume=state.volume;audio.onplay=()=>audioUI(true);audio.onpause=()=>audioUI(false);if(was)audio.play().catch(()=>audioUI(false))}
function audioUI(on){playing=on;$('#audioToggle').textContent=on?'Ⅱ Pause audio':'▶ Play audio'}
async function toggleAudio(){if(!audio.src)loadAudio();if(!audio.src){$('#audioToggle').textContent='Upload audio first';return}if(!audio.paused)audio.pause();else await audio.play().catch(()=>{$('#audioToggle').textContent='Tap again to play'})}

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
    const rawKey=localStorage.getItem(KEY);
    let syncMeta=null;try{syncMeta=JSON.parse(localStorage.getItem(SYNC_META_KEY)||'null')}catch{}
    const hasRealLocalEdit=rawKey!==null&&!syncMeta;
    if(hasRealLocalEdit)return; // a person edited this device locally -- never overwrite that
    if(syncMeta?.updatedAt&&syncMeta.updatedAt===data.updatedAt)return; // already current

    state=mergeDefaults(data.settings.state||{});
    Object.entries(data.settings.assets||{}).forEach(([kind,asset])=>{
      if(asset?.publicUrl)defaultMedia[kind]={url:asset.publicUrl,type:asset.type||defaultMedia[kind]?.type};
    });
    rawLocalStorageSet(KEY,JSON.stringify(state));
    rawLocalStorageSet(SYNC_META_KEY,JSON.stringify({updatedAt:data.updatedAt||null}));
    render();loadAudio();
  }catch(e){console.warn('[Harmonic City] Live public defaults unavailable, using baked-in defaults.',e)}
}

(async function init(){try{const items=await dbAll();library={background:items.filter(x=>x.kind==='background').sort((a,b)=>b.createdAt-a.createdAt),intro:items.filter(x=>x.kind==='intro').sort((a,b)=>b.createdAt-a.createdAt),audio:items.filter(x=>x.kind==='audio').sort((a,b)=>b.createdAt-a.createdAt),core:items.filter(x=>x.kind==='core').sort((a,b)=>b.createdAt-a.createdAt)}}catch(e){console.error('Media library unavailable',e)}render();loadAudio();if(localStorage.getItem(KEY)!==null||localStorage.getItem(LEGACY_KEY)!==null)save();fetchPublicDefaults()})();