import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STATE_KEY='harmonic-city-state-v2';
const LAYOUT_KEY='harmonic-city-studio-layout-v1';
const CONFIG_KEY='harmonic-city-supabase-config-v1';
const DEVICE_KEY='harmonic-city-device-id-v1';
const PORTAL_KEY='harmonic-city';
const MEDIA_DB='harmonic-city-media';
const MEDIA_STORE='assets';
const STORAGE_BUCKET='harmonic-city-media';
const WORKSPACE_VERSION=5;
const MAGIC_LINK_SENT_KEY='harmonic-city-magic-link-sent-at';
const MAX_COOLDOWN_SECONDS=60;
const REQUEST_TIMEOUT_MS=30000;
const POLL_INTERVAL_MS=20000;
let supabase=null,session=null,syncTimer=null,syncing=false,mediaSyncing=false,cooldownTimer=null,authListener=null,realtimeChannel=null,initialSyncStarted=false,lastRemoteUpdatedAt='',applyingRemote=false,dirty=false;
const $=s=>document.querySelector(s);

function readJson(key,fallback={}){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch{return fallback}}
function setStatus(text){const el=$('#cloudStatus');if(el)el.textContent=text}
function config(){return readJson(CONFIG_KEY,{url:'https://xsslskkhxyavwvuxyelf.supabase.co',anonKey:''})}
function cleanAuthUrl(){history.replaceState({},document.title,location.pathname)}
function deviceId(){let id=localStorage.getItem(DEVICE_KEY);if(!id){id=crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;localStorage.setItem(DEVICE_KEY,id)}return id}
function withTimeout(promise,label,ms=REQUEST_TIMEOUT_MS){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out.`)),ms)})]).finally(()=>clearTimeout(timer))}
function isNewer(timestamp){return Boolean(timestamp&&(!lastRemoteUpdatedAt||new Date(timestamp)>new Date(lastRemoteUpdatedAt)))}
function openMediaDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(MEDIA_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(MEDIA_STORE)){const store=db.createObjectStore(MEDIA_STORE,{keyPath:'id'});store.createIndex('kind','kind')}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function allLocalMedia(){const db=await openMediaDB();return new Promise((resolve,reject)=>{const req=db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}
async function putLocalMedia(item){const db=await openMediaDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MEDIA_STORE,'readwrite');tx.objectStore(MEDIA_STORE).put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
function safeName(name='asset'){return name.replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-100)}
function workspacePath(){return `${session.user.id}/${PORTAL_KEY}/workspace.json`}
function readAuthError(){const search=new URLSearchParams(location.search);const hash=new URLSearchParams(location.hash.replace(/^#/,'')||'');return search.get('error_description')||search.get('error')||hash.get('error_description')||hash.get('error')||''}

async function consumeAuthCallback(){
  if(!supabase)return false;
  const authError=readAuthError();
  if(authError){localStorage.removeItem(MAGIC_LINK_SENT_KEY);cleanAuthUrl();throw new Error(decodeURIComponent(authError.replace(/\+/g,' ')))}
  const hash=new URLSearchParams(location.hash.replace(/^#/,'')||'');
  const access_token=hash.get('access_token'),refresh_token=hash.get('refresh_token');
  if(access_token&&refresh_token){const {data,error}=await supabase.auth.setSession({access_token,refresh_token});if(error)throw error;session=data.session;localStorage.removeItem(MAGIC_LINK_SENT_KEY);cleanAuthUrl();return Boolean(session)}
  const code=new URLSearchParams(location.search).get('code');
  if(code){const {data,error}=await supabase.auth.exchangeCodeForSession(code);if(error)throw error;session=data.session;localStorage.removeItem(MAGIC_LINK_SENT_KEY);cleanAuthUrl();return Boolean(session)}
  return false;
}

async function connectClient(){
  const c=config();if(!c.url||!c.anonKey){setStatus('Cloud setup is incomplete.');return null}
  if(authListener){authListener.unsubscribe();authListener=null}
  if(realtimeChannel&&supabase){await supabase.removeChannel(realtimeChannel);realtimeChannel=null}
  supabase=createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'implicit',storageKey:'harmonic-city-auth'}});
  try{await consumeAuthCallback()}catch(error){console.error(error);setStatus(error.message.toLowerCase().includes('expired')?'That email link expired. Request one fresh link below.':`Sign-in failed: ${error.message}`)}
  const {data,error}=await supabase.auth.getSession();if(error)console.error(error);session=data?.session||session||null;
  const subscription=supabase.auth.onAuthStateChange((_event,next)=>{session=next;renderCloudState();if(session){startCrossDeviceSync();if(!initialSyncStarted)initialCloudSync()}else stopCrossDeviceSync()});
  authListener=subscription.data.subscription;
  renderCloudState();
  if(session){startCrossDeviceSync();if(!initialSyncStarted)initialCloudSync()}
  return supabase;
}

function renderCloudState(){const btn=$('#cloudToggle');if(!btn)return;if(session){btn.textContent='☁ Cloud On';btn.classList.add('cloud-connected');setStatus(`Connected as ${session.user.email}`)}else{btn.textContent='☁ Connect Cloud';btn.classList.remove('cloud-connected');if(!cooldownRemaining()&&!readAuthError())setStatus('Sign in to load and save Harmonic City across devices.')}}
function currentWorkspace(){return {version:WORKSPACE_VERSION,portalKey:PORTAL_KEY,updatedAt:new Date().toISOString(),deviceId:deviceId(),state:readJson(STATE_KEY,{}),layout:readJson(LAYOUT_KEY,{})}}
async function uploadWorkspaceFile(workspace){const body=new Blob([JSON.stringify(workspace)],{type:'application/json'});const result=await withTimeout(supabase.storage.from(STORAGE_BUCKET).upload(workspacePath(),body,{contentType:'application/json',upsert:true,cacheControl:'no-cache'}),'Workspace upload');if(result.error)throw result.error;return {path:workspacePath(),size:body.size}}
async function writeManifest(workspace,uploaded){const manifest={version:WORKSPACE_VERSION,workspace_path:uploaded.path,workspace_size:uploaded.size,updated_at:workspace.updatedAt,device_id:deviceId(),sync_complete:true};const {error}=await withTimeout(supabase.from('portal_settings').upsert({owner_id:session.user.id,portal_key:PORTAL_KEY,settings:manifest,updated_at:workspace.updatedAt},{onConflict:'owner_id,portal_key'}),'Workspace record');if(error)throw error}

async function saveWorkspace({includeMedia=false}={}){
  if(!session){setStatus('Sign in to enable cloud saving.');return false}
  if(syncing||applyingRemote)return false;
  syncing=true;
  try{
    setStatus('Saving settings to cloud…');
    const workspace=currentWorkspace();
    const uploaded=await uploadWorkspaceFile(workspace);
    await writeManifest(workspace,uploaded);
    lastRemoteUpdatedAt=workspace.updatedAt;dirty=false;
    setStatus(`Settings synced ${new Date().toLocaleTimeString()}`);
    if(includeMedia)syncMediaInBackground();
    return true;
  }catch(error){console.error(error);setStatus(`Cloud save failed: ${error.message}`);return false}
  finally{syncing=false}
}

async function fetchRemoteRecord(){if(!session)return null;const {data,error}=await withTimeout(supabase.from('portal_settings').select('settings,updated_at').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).maybeSingle(),'Cloud lookup');if(error)throw error;return data||null}
async function downloadWorkspaceFile(path){const {data,error}=await withTimeout(supabase.storage.from(STORAGE_BUCKET).download(path),'Workspace download');if(error)throw error;return JSON.parse(await data.text())}
async function applyRemoteWorkspace(record,{reload=true}={}){
  if(!record?.settings)return false;
  const timestamp=record.updated_at||record.settings.updated_at;if(!isNewer(timestamp))return false;
  applyingRemote=true;
  try{
    setStatus('Loading settings from cloud…');
    let remote=record.settings;if(remote.workspace_path)remote=await downloadWorkspaceFile(remote.workspace_path);
    if(remote.state)nativeSet(STATE_KEY,JSON.stringify(remote.state));
    if(remote.layout)nativeSet(LAYOUT_KEY,JSON.stringify(remote.layout));
    lastRemoteUpdatedAt=timestamp;dirty=false;
    setStatus('Settings loaded from Harmonic Cloud');
    if(reload){sessionStorage.setItem('harmonic-city-cloud-reloaded','1');location.reload()}
    else syncMediaInBackground(true);
    return true;
  }finally{applyingRemote=false}
}
async function loadWorkspace(){const record=await fetchRemoteRecord();if(!record?.settings)return false;lastRemoteUpdatedAt='';return applyRemoteWorkspace(record,{reload:false})}
async function checkRemoteUpdates(){if(!session||syncing||applyingRemote||document.hidden)return;try{const record=await fetchRemoteRecord();if(!record?.settings)return;const manifest=record.settings;if(manifest.device_id===deviceId())return;await applyRemoteWorkspace(record,{reload:true})}catch(error){console.warn('Cross-device check failed',error);setStatus(`Cross-device sync failed: ${error.message}`)}}

async function uploadMissingMedia(){const items=(await allLocalMedia()).filter(item=>item?.id&&item?.blob instanceof Blob&&item.blob.size>0);if(!items.length)return {uploaded:0,total:0};const {data:rows,error}=await supabase.from('portal_media').select('id').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY);if(error)throw error;const existing=new Set((rows||[]).map(x=>x.id));const missing=items.filter(item=>!existing.has(item.id));let uploaded=0;for(const item of missing){const path=`${session.user.id}/${PORTAL_KEY}/${item.kind||'asset'}/${item.id}-${safeName(item.name)}`;const upload=await withTimeout(supabase.storage.from(STORAGE_BUCKET).upload(path,item.blob,{contentType:item.type||item.blob.type,upsert:true,cacheControl:'31536000'}),'Media upload',30000);if(upload.error)throw upload.error;const {error:rowError}=await supabase.from('portal_media').upsert({id:item.id,owner_id:session.user.id,portal_key:PORTAL_KEY,kind:item.kind||'asset',name:item.name||'asset',storage_path:path,mime_type:item.type||item.blob.type});if(rowError)throw rowError;uploaded++}return {uploaded,total:missing.length}}
async function downloadMissingMedia(){const local=await allLocalMedia();const existing=new Set(local.map(x=>x.id));const {data,error}=await supabase.from('portal_media').select('*').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).order('created_at',{ascending:false});if(error)throw error;for(const row of (data||[]).filter(row=>!existing.has(row.id))){const {data:file,error:downloadError}=await withTimeout(supabase.storage.from(STORAGE_BUCKET).download(row.storage_path),'Media download',30000);if(downloadError)throw downloadError;await putLocalMedia({id:row.id,kind:row.kind,name:row.name,type:row.mime_type||file.type,blob:file,createdAt:new Date(row.created_at).getTime()})}}
async function syncMediaInBackground(download=false){if(mediaSyncing||!session)return;mediaSyncing=true;setStatus(download?'Settings loaded • restoring media in background…':'Settings synced • media syncing in background…');try{if(download)await downloadMissingMedia();else await uploadMissingMedia();setStatus('Cloud fully synced')}catch(error){console.warn('Background media sync incomplete',error);setStatus(`Settings synced • media retry needed: ${error.message}`)}finally{mediaSyncing=false}}

function startCrossDeviceSync(){if(!supabase||!session||realtimeChannel)return;realtimeChannel=supabase.channel(`harmonic-city-${session.user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'portal_settings',filter:`owner_id=eq.${session.user.id}`},payload=>{const record=payload.new;if(!record||record.portal_key!==PORTAL_KEY)return;const manifest=record.settings||{};if(manifest.device_id===deviceId())return;applyRemoteWorkspace(record,{reload:true}).catch(error=>{console.error(error);setStatus(`Cross-device sync failed: ${error.message}`)})}).subscribe(status=>{if(status==='SUBSCRIBED'&&!syncing)setStatus('Cloud connected • ready')})}
function stopCrossDeviceSync(){if(realtimeChannel&&supabase)supabase.removeChannel(realtimeChannel);realtimeChannel=null}
async function initialCloudSync(){if(initialSyncStarted||!session)return;initialSyncStarted=true;try{setStatus('Checking Harmonic Cloud…');const record=await fetchRemoteRecord();if(record?.settings){await applyRemoteWorkspace(record,{reload:false});if(!sessionStorage.getItem('harmonic-city-cloud-reloaded')){sessionStorage.setItem('harmonic-city-cloud-reloaded','1');location.reload();return}setStatus('Cloud connected • ready');syncMediaInBackground(true)}else{await saveWorkspace({includeMedia:true})}}catch(error){console.error(error);setStatus(`Cloud sync failed: ${error.message}`)}}
function scheduleSave(delay=900){if(!session||applyingRemote)return;dirty=true;clearTimeout(syncTimer);syncTimer=setTimeout(()=>{if(dirty)saveWorkspace()},delay)}
const nativeSet=localStorage.setItem.bind(localStorage);localStorage.setItem=(key,value)=>{nativeSet(key,value);if(key===STATE_KEY||key===LAYOUT_KEY)scheduleSave()};
function cooldownRemaining(){const raw=Number(localStorage.getItem(MAGIC_LINK_SENT_KEY)||0);if(!raw)return 0;let left=Math.max(0,Math.ceil((raw-Date.now())/1000));if(left>MAX_COOLDOWN_SECONDS){left=MAX_COOLDOWN_SECONDS;nativeSet(MAGIC_LINK_SENT_KEY,String(Date.now()+MAX_COOLDOWN_SECONDS*1000))}return left}
function startCooldown(){nativeSet(MAGIC_LINK_SENT_KEY,String(Date.now()+MAX_COOLDOWN_SECONDS*1000));updateCooldownUI();clearInterval(cooldownTimer);cooldownTimer=setInterval(updateCooldownUI,1000)}
function clearCooldown(){localStorage.removeItem(MAGIC_LINK_SENT_KEY);clearInterval(cooldownTimer);updateCooldownUI()}
function updateCooldownUI(){const button=$('#cloudSendLink');if(!button)return;const left=cooldownRemaining();if(left>0){button.disabled=true;button.textContent=`Try again in ${left}s`}else{button.disabled=false;button.textContent='Email sign-in link';localStorage.removeItem(MAGIC_LINK_SENT_KEY);clearInterval(cooldownTimer)}}
function bindUI(){const modal=$('#cloudModal'),toggle=$('#cloudToggle'),close=$('#cloudClose'),saveConfig=$('#cloudSaveConfig'),sendLink=$('#cloudSendLink'),signOut=$('#cloudSignOut');if(!modal||!toggle)return;const c=config();$('#cloudUrl').value=c.url;$('#cloudAnonKey').value=c.anonKey;toggle.onclick=()=>{modal.classList.add('open');renderCloudState();updateCooldownUI()};close.onclick=()=>modal.classList.remove('open');modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});saveConfig.onclick=async()=>{localStorage.setItem(CONFIG_KEY,JSON.stringify({url:$('#cloudUrl').value.trim(),anonKey:$('#cloudAnonKey').value.trim()}));setStatus('Cloud configuration saved. Connecting…');initialSyncStarted=false;await connectClient()};sendLink.onclick=async()=>{if(cooldownRemaining())return;if(!supabase)await connectClient();if(!supabase){setStatus('Cloud setup is incomplete.');return}const email=$('#cloudEmail').value.trim();if(!email){setStatus('Enter your email address.');return}sendLink.disabled=true;setStatus('Requesting a fresh sign-in email…');const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:`${location.origin}${location.pathname}`,shouldCreateUser:true}});if(error){clearCooldown();sendLink.disabled=false;setStatus(/rate limit|too many/i.test(error.message)?'Email sign-in is temporarily rate-limited. Wait about a minute, then try once.':`Sign-in failed: ${error.message}`);return}startCooldown();setStatus('Fresh email sent. Open only the newest Harmonic City email.')};signOut.onclick=async()=>{stopCrossDeviceSync();if(supabase)await supabase.auth.signOut();session=null;initialSyncStarted=false;localStorage.removeItem(MAGIC_LINK_SENT_KEY);sessionStorage.removeItem('harmonic-city-cloud-reloaded');renderCloudState()};$('#cloudSyncNow').onclick=()=>saveWorkspace({includeMedia:true});updateCooldownUI()}

addEventListener('DOMContentLoaded',async()=>{bindUI();await connectClient();setInterval(checkRemoteUpdates,POLL_INTERVAL_MS);addEventListener('focus',checkRemoteUpdates);addEventListener('visibilitychange',()=>{if(!document.hidden)checkRemoteUpdates()});addEventListener('pagehide',()=>{if(session&&dirty)saveWorkspace()})});
