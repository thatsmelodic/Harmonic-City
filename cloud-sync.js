import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STATE_KEY='harmonic-city-state-v2';
const LAYOUT_KEY='harmonic-city-studio-layout-v1';
const CONFIG_KEY='harmonic-city-supabase-config-v1';
const PORTAL_KEY='harmonic-city';
const MEDIA_DB='harmonic-city-media';
const MEDIA_STORE='assets';
const MAGIC_LINK_SENT_KEY='harmonic-city-magic-link-sent-at';
const MAX_COOLDOWN_SECONDS=60;
let supabase=null,session=null,syncTimer=null,syncing=false,cooldownTimer=null,authListener=null,initialSyncStarted=false;
const $=s=>document.querySelector(s);

function readJson(key,fallback={}){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch{return fallback}}
function setStatus(text){const el=$('#cloudStatus');if(el)el.textContent=text}
function config(){return readJson(CONFIG_KEY,{url:'https://xsslskkhxyavwvuxyelf.supabase.co',anonKey:''})}
function cleanAuthUrl(){history.replaceState({},document.title,location.pathname)}
function openMediaDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(MEDIA_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(MEDIA_STORE)){const store=db.createObjectStore(MEDIA_STORE,{keyPath:'id'});store.createIndex('kind','kind')}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function allLocalMedia(){const db=await openMediaDB();return new Promise((resolve,reject)=>{const req=db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}
async function putLocalMedia(item){const db=await openMediaDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MEDIA_STORE,'readwrite');tx.objectStore(MEDIA_STORE).put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
function safeName(name='asset'){return name.replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-100)}

function readAuthError(){
  const search=new URLSearchParams(location.search);
  const hash=new URLSearchParams(location.hash.replace(/^#/,'')||'');
  return search.get('error_description')||search.get('error')||hash.get('error_description')||hash.get('error')||'';
}

async function consumeAuthCallback(){
  if(!supabase)return false;
  const authError=readAuthError();
  if(authError){
    localStorage.removeItem(MAGIC_LINK_SENT_KEY);
    cleanAuthUrl();
    throw new Error(decodeURIComponent(authError.replace(/\+/g,' ')));
  }
  const hash=new URLSearchParams(location.hash.replace(/^#/,'')||'');
  const access_token=hash.get('access_token');
  const refresh_token=hash.get('refresh_token');
  if(access_token&&refresh_token){
    const {data,error}=await supabase.auth.setSession({access_token,refresh_token});
    if(error)throw error;
    session=data.session;
    localStorage.removeItem(MAGIC_LINK_SENT_KEY);
    cleanAuthUrl();
    return Boolean(session);
  }
  const code=new URLSearchParams(location.search).get('code');
  if(code){
    const {data,error}=await supabase.auth.exchangeCodeForSession(code);
    if(error)throw error;
    session=data.session;
    localStorage.removeItem(MAGIC_LINK_SENT_KEY);
    cleanAuthUrl();
    return Boolean(session);
  }
  return false;
}

async function connectClient(){
  const c=config();
  if(!c.url||!c.anonKey){setStatus('Add the Supabase anon key first.');return null}
  if(authListener){authListener.unsubscribe();authListener=null}
  supabase=createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'implicit',storageKey:'harmonic-city-auth'}});
  try{await consumeAuthCallback()}catch(error){console.error(error);setStatus(error.message.toLowerCase().includes('expired')?'That email link expired. Request one fresh link below.':`Sign-in failed: ${error.message}`)}
  const {data,error}=await supabase.auth.getSession();
  if(error)console.error(error);
  session=data?.session||session||null;
  const subscription=supabase.auth.onAuthStateChange((_event,next)=>{
    session=next;
    renderCloudState();
    if(session&&!initialSyncStarted)initialCloudSync();
  });
  authListener=subscription.data.subscription;
  renderCloudState();
  if(session&&!initialSyncStarted)initialCloudSync();
  return supabase;
}

function renderCloudState(){
  const btn=$('#cloudToggle');if(!btn)return;
  if(session){btn.textContent='☁ Cloud On';btn.classList.add('cloud-connected');setStatus(`Connected as ${session.user.email}`)}
  else{btn.textContent='☁ Connect Cloud';btn.classList.remove('cloud-connected');if(!cooldownRemaining()&&!readAuthError())setStatus('Not connected. Request one sign-in email, then use only the newest link.')}
}

async function saveWorkspace(){
  if(!session||syncing){if(!session)setStatus('Sign in first, then press Sync now.');return}
  syncing=true;
  try{
    const settings={state:readJson(STATE_KEY,{}),layout:readJson(LAYOUT_KEY,{})};
    const {error}=await supabase.from('portal_settings').upsert({owner_id:session.user.id,portal_key:PORTAL_KEY,settings,updated_at:new Date().toISOString()},{onConflict:'owner_id,portal_key'});
    if(error)throw error;
    await uploadMissingMedia();
    setStatus(`Cloud saved ${new Date().toLocaleTimeString()}`)
  }catch(error){console.error(error);setStatus(`Cloud save failed: ${error.message}`)}finally{syncing=false}
}

async function loadWorkspace(){
  if(!session)return false;
  const {data,error}=await supabase.from('portal_settings').select('settings,updated_at').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).maybeSingle();
  if(error)throw error;
  if(!data?.settings)return false;
  const remote=data.settings;
  if(remote.state&&Object.keys(remote.state).length)localStorage.setItem(STATE_KEY,JSON.stringify(remote.state));
  if(remote.layout&&Object.keys(remote.layout).length)localStorage.setItem(LAYOUT_KEY,JSON.stringify(remote.layout));
  await downloadMissingMedia();
  return true;
}

async function uploadMissingMedia(){
  const items=await allLocalMedia();if(!items.length)return;
  const {data:rows,error}=await supabase.from('portal_media').select('id').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY);if(error)throw error;
  const existing=new Set((rows||[]).map(x=>x.id));
  for(const item of items){
    if(existing.has(item.id))continue;
    const path=`${session.user.id}/${item.kind}/${item.id}-${safeName(item.name)}`;
    const {error:uploadError}=await supabase.storage.from('harmonic-city-media').upload(path,item.blob,{contentType:item.type,upsert:true,cacheControl:'31536000'});if(uploadError)throw uploadError;
    const {error:rowError}=await supabase.from('portal_media').upsert({id:item.id,owner_id:session.user.id,portal_key:PORTAL_KEY,kind:item.kind,name:item.name,storage_path:path,mime_type:item.type});if(rowError)throw rowError;
  }
}

async function downloadMissingMedia(){
  const local=await allLocalMedia();const existing=new Set(local.map(x=>x.id));
  const {data,error}=await supabase.from('portal_media').select('*').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).order('created_at',{ascending:false});if(error)throw error;
  for(const row of data||[]){
    if(existing.has(row.id))continue;
    const {data:file,error:downloadError}=await supabase.storage.from('harmonic-city-media').download(row.storage_path);if(downloadError){console.warn(downloadError);continue}
    await putLocalMedia({id:row.id,kind:row.kind,name:row.name,type:row.mime_type||file.type,blob:file,createdAt:new Date(row.created_at).getTime()});
  }
}

async function initialCloudSync(){
  if(initialSyncStarted||!session)return;
  initialSyncStarted=true;
  try{
    setStatus('Loading your cloud workspace…');
    const loaded=await loadWorkspace();
    if(loaded&&!sessionStorage.getItem('harmonic-city-cloud-reloaded')){
      sessionStorage.setItem('harmonic-city-cloud-reloaded','1');
      location.reload();return;
    }
    await saveWorkspace();
  }catch(error){console.error(error);setStatus(`Cloud sync failed: ${error.message}`)}
}

function scheduleSave(){if(!session)return;clearTimeout(syncTimer);syncTimer=setTimeout(saveWorkspace,900)}
const nativeSet=localStorage.setItem.bind(localStorage);localStorage.setItem=(key,value)=>{nativeSet(key,value);if(key===STATE_KEY||key===LAYOUT_KEY)scheduleSave()};
function cooldownRemaining(){const raw=Number(localStorage.getItem(MAGIC_LINK_SENT_KEY)||0);if(!raw)return 0;let left=Math.max(0,Math.ceil((raw-Date.now())/1000));if(left>MAX_COOLDOWN_SECONDS){left=MAX_COOLDOWN_SECONDS;nativeSet(MAGIC_LINK_SENT_KEY,String(Date.now()+MAX_COOLDOWN_SECONDS*1000))}return left}
function startCooldown(){nativeSet(MAGIC_LINK_SENT_KEY,String(Date.now()+MAX_COOLDOWN_SECONDS*1000));updateCooldownUI();clearInterval(cooldownTimer);cooldownTimer=setInterval(updateCooldownUI,1000)}
function clearCooldown(){localStorage.removeItem(MAGIC_LINK_SENT_KEY);clearInterval(cooldownTimer);updateCooldownUI()}
function updateCooldownUI(){const button=$('#cloudSendLink');if(!button)return;const left=cooldownRemaining();if(left>0){button.disabled=true;button.textContent=`Try again in ${left}s`}else{button.disabled=false;button.textContent='Email sign-in link';localStorage.removeItem(MAGIC_LINK_SENT_KEY);clearInterval(cooldownTimer)}}

function bindUI(){
  const modal=$('#cloudModal'),toggle=$('#cloudToggle'),close=$('#cloudClose'),saveConfig=$('#cloudSaveConfig'),sendLink=$('#cloudSendLink'),signOut=$('#cloudSignOut');
  if(!modal||!toggle)return;
  const c=config();$('#cloudUrl').value=c.url;$('#cloudAnonKey').value=c.anonKey;
  toggle.onclick=()=>{modal.classList.add('open');renderCloudState();updateCooldownUI()};
  close.onclick=()=>modal.classList.remove('open');
  modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});
  saveConfig.onclick=async()=>{localStorage.setItem(CONFIG_KEY,JSON.stringify({url:$('#cloudUrl').value.trim(),anonKey:$('#cloudAnonKey').value.trim()}));setStatus('Cloud configuration saved. Connecting…');initialSyncStarted=false;await connectClient()};
  sendLink.onclick=async()=>{
    if(cooldownRemaining())return;
    if(!supabase)await connectClient();
    if(!supabase){setStatus('Add the Supabase anon key first.');return}
    const email=$('#cloudEmail').value.trim();if(!email){setStatus('Enter your email address.');return}
    sendLink.disabled=true;setStatus('Requesting a fresh sign-in email…');
    const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:`${location.origin}${location.pathname}`,shouldCreateUser:true}});
    if(error){
      clearCooldown();
      sendLink.disabled=false;
      const rateLimited=/rate limit|too many/i.test(error.message);
      setStatus(rateLimited?'Supabase is still rate-limiting email. Wait about a minute, then try once.':`Sign-in failed: ${error.message}`);
      return;
    }
    startCooldown();
    setStatus('Fresh email sent. Open only the newest Harmonic City email.');
  };
  signOut.onclick=async()=>{if(supabase)await supabase.auth.signOut();session=null;initialSyncStarted=false;localStorage.removeItem(MAGIC_LINK_SENT_KEY);sessionStorage.removeItem('harmonic-city-cloud-reloaded');renderCloudState()};
  $('#cloudSyncNow').onclick=saveWorkspace;updateCooldownUI();
}

addEventListener('DOMContentLoaded',async()=>{bindUI();await connectClient();setInterval(()=>{if(session)saveWorkspace()},15000);addEventListener('pagehide',()=>{if(session)saveWorkspace()})});