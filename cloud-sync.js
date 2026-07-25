import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STATE_KEY='harmonic-city-state-v2';
const LAYOUT_KEY='harmonic-city-studio-layout-v1';
const CONFIG_KEY='harmonic-city-supabase-config-v1';
const PORTAL_KEY='harmonic-city';
const MEDIA_DB='harmonic-city-media';
const MEDIA_STORE='assets';
let supabase=null,session=null,syncTimer=null,syncing=false;
const $=s=>document.querySelector(s);

function readJson(key,fallback={}){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch{return fallback}}
function setStatus(text){const el=$('#cloudStatus');if(el)el.textContent=text}
function config(){return readJson(CONFIG_KEY,{url:'https://xsslskkhxyavwvuxyelf.supabase.co',anonKey:''})}
function openMediaDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(MEDIA_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(MEDIA_STORE)){const store=db.createObjectStore(MEDIA_STORE,{keyPath:'id'});store.createIndex('kind','kind')}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function allLocalMedia(){const db=await openMediaDB();return new Promise((resolve,reject)=>{const req=db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}
async function putLocalMedia(item){const db=await openMediaDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MEDIA_STORE,'readwrite');tx.objectStore(MEDIA_STORE).put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
function safeName(name='asset'){return name.replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-100)}

async function connectClient(){const c=config();if(!c.url||!c.anonKey)return null;supabase=createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});const {data}=await supabase.auth.getSession();session=data.session;supabase.auth.onAuthStateChange((_event,next)=>{session=next;renderCloudState();if(session)initialCloudSync()});renderCloudState();return supabase}

function renderCloudState(){const btn=$('#cloudToggle');if(!btn)return;if(session){btn.textContent='☁ Cloud On';btn.classList.add('cloud-connected');setStatus(`Connected as ${session.user.email}`)}else{btn.textContent='☁ Connect Cloud';btn.classList.remove('cloud-connected');setStatus('Not connected. Your work is still only on this browser.')}}

async function saveWorkspace(){if(!session||syncing)return;syncing=true;try{const settings={state:readJson(STATE_KEY,{}),layout:readJson(LAYOUT_KEY,{})};const {error}=await supabase.from('portal_settings').upsert({owner_id:session.user.id,portal_key:PORTAL_KEY,settings,updated_at:new Date().toISOString()},{onConflict:'owner_id,portal_key'});if(error)throw error;await uploadMissingMedia();setStatus(`Cloud saved ${new Date().toLocaleTimeString()}`)}catch(error){console.error(error);setStatus(`Cloud save failed: ${error.message}`)}finally{syncing=false}}

async function loadWorkspace(){if(!session)return false;const {data,error}=await supabase.from('portal_settings').select('settings,updated_at').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).maybeSingle();if(error)throw error;if(!data?.settings)return false;const remote=data.settings;if(remote.state&&Object.keys(remote.state).length)localStorage.setItem(STATE_KEY,JSON.stringify(remote.state));if(remote.layout&&Object.keys(remote.layout).length)localStorage.setItem(LAYOUT_KEY,JSON.stringify(remote.layout));await downloadMissingMedia();sessionStorage.setItem('harmonic-city-cloud-loaded','1');return true}

async function uploadMissingMedia(){const items=await allLocalMedia();if(!items.length)return;const {data:rows,error}=await supabase.from('portal_media').select('id').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY);if(error)throw error;const existing=new Set((rows||[]).map(x=>x.id));for(const item of items){if(existing.has(item.id))continue;const path=`${session.user.id}/${item.kind}/${item.id}-${safeName(item.name)}`;const {error:uploadError}=await supabase.storage.from('harmonic-city-media').upload(path,item.blob,{contentType:item.type,upsert:true,cacheControl:'31536000'});if(uploadError)throw uploadError;const {error:rowError}=await supabase.from('portal_media').upsert({id:item.id,owner_id:session.user.id,portal_key:PORTAL_KEY,kind:item.kind,name:item.name,storage_path:path,mime_type:item.type});if(rowError)throw rowError}}

async function downloadMissingMedia(){const local=await allLocalMedia();const existing=new Set(local.map(x=>x.id));const {data,error}=await supabase.from('portal_media').select('*').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).order('created_at',{ascending:false});if(error)throw error;for(const row of data||[]){if(existing.has(row.id))continue;const {data:file,error:downloadError}=await supabase.storage.from('harmonic-city-media').download(row.storage_path);if(downloadError){console.warn(downloadError);continue}await putLocalMedia({id:row.id,kind:row.kind,name:row.name,type:row.mime_type||file.type,blob:file,createdAt:new Date(row.created_at).getTime()})}}

async function initialCloudSync(){try{setStatus('Loading your cloud workspace…');const loaded=await loadWorkspace();if(loaded&&!sessionStorage.getItem('harmonic-city-cloud-reloaded')){sessionStorage.setItem('harmonic-city-cloud-reloaded','1');location.reload();return}await saveWorkspace()}catch(error){console.error(error);setStatus(`Cloud sync failed: ${error.message}`)}}

function scheduleSave(){if(!session)return;clearTimeout(syncTimer);syncTimer=setTimeout(saveWorkspace,900)}
const nativeSet=localStorage.setItem.bind(localStorage);localStorage.setItem=(key,value)=>{nativeSet(key,value);if(key===STATE_KEY||key===LAYOUT_KEY)scheduleSave()};

function bindUI(){const modal=$('#cloudModal'),toggle=$('#cloudToggle'),close=$('#cloudClose'),saveConfig=$('#cloudSaveConfig'),sendLink=$('#cloudSendLink'),signOut=$('#cloudSignOut');if(!modal||!toggle)return;const c=config();$('#cloudUrl').value=c.url;$('#cloudAnonKey').value=c.anonKey;toggle.onclick=()=>modal.classList.add('open');close.onclick=()=>modal.classList.remove('open');modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});saveConfig.onclick=async()=>{localStorage.setItem(CONFIG_KEY,JSON.stringify({url:$('#cloudUrl').value.trim(),anonKey:$('#cloudAnonKey').value.trim()}));setStatus('Cloud configuration saved. Connecting…');await connectClient()};sendLink.onclick=async()=>{if(!supabase)await connectClient();if(!supabase){setStatus('Add the Supabase anon key first.');return}const email=$('#cloudEmail').value.trim();if(!email){setStatus('Enter your email address.');return}const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});setStatus(error?`Sign-in failed: ${error.message}`:'Check your email for the Harmonic City sign-in link.')};signOut.onclick=async()=>{if(supabase)await supabase.auth.signOut();session=null;renderCloudState()};$('#cloudSyncNow').onclick=saveWorkspace}

addEventListener('DOMContentLoaded',async()=>{bindUI();await connectClient();setInterval(()=>{if(session)saveWorkspace()},15000);addEventListener('pagehide',()=>{if(session)saveWorkspace()})});
