import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STATE_KEY='harmonic-city-state-v2';
const LAYOUT_KEY='harmonic-city-studio-layout-v1';
const CONFIG_KEY='harmonic-city-supabase-config-v1';
const CLOUD_META_KEY='harmonic-city-cloud-meta-v2';
const PORTAL_KEY='harmonic-city';
const POLL_INTERVAL_MS=4000;

let supabase=null;
let session=null;
let syncing=false;
let localDirty=false;
let lastCloudUpdatedAt=0;
let pollTimer=null;
let suppressTracking=false;
let loadedUserId='';

const $=selector=>document.querySelector(selector);
const nativeSet=localStorage.setItem.bind(localStorage);
const nativeRemove=localStorage.removeItem.bind(localStorage);

function readJson(key,fallback={}){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch{return fallback}}
function writeJson(key,value){nativeSet(key,JSON.stringify(value))}
function parseTime(value){const time=Date.parse(value||'');return Number.isFinite(time)?time:0}
function setStatus(text){const el=$('#cloudStatus');if(el)el.textContent=text}
function meta(){return readJson(CLOUD_META_KEY,{localUpdatedAt:0,cloudUpdatedAt:0,deviceId:''})}
function ensureDeviceId(){const value=meta();if(!value.deviceId){value.deviceId=crypto.randomUUID();writeJson(CLOUD_META_KEY,value)}return value.deviceId}

async function getConfig(){
  let runtime=null;
  try{
    const response=await fetch('/api/config',{cache:'no-store'});
    if(response.ok){
      const data=await response.json();
      if(data?.ok&&data.url&&data.anonKey)runtime={url:data.url,anonKey:data.anonKey};
    }
  }catch(error){console.warn('Runtime config unavailable',error)}
  const saved=readJson(CONFIG_KEY,{});
  const config={url:runtime?.url||saved.url||'',anonKey:runtime?.anonKey||saved.anonKey||''};
  if(config.url&&config.anonKey)writeJson(CONFIG_KEY,config);
  return config;
}

function render(){
  const button=$('#cloudToggle');
  if(!button)return;
  if(session){
    button.textContent=syncing?'☁ Syncing…':localDirty?'☁ Local Changes':'☁ Cloud On';
    button.classList.add('cloud-connected');
  }else{
    button.textContent='☁ Connect Cloud';
    button.classList.remove('cloud-connected');
  }
}

function payload(){
  return {
    state:readJson(STATE_KEY,{}),
    layout:readJson(LAYOUT_KEY,{}),
    client_updated_at:new Date().toISOString(),
    device_id:ensureDeviceId()
  };
}

function markLocalChange(){
  if(suppressTracking)return;
  const value=meta();
  value.localUpdatedAt=Date.now();
  value.deviceId=value.deviceId||ensureDeviceId();
  writeJson(CLOUD_META_KEY,value);
  localDirty=true;
  render();
  setStatus('Local changes are not synced. Press Sync to upload this device.');
}

async function fetchRemote(){
  if(!session)return null;
  const {data,error}=await supabase.from('portal_settings').select('settings,updated_at').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function uploadCurrentDevice(){
  if(!session){setStatus('Sign in first.');return false}
  if(syncing)return false;
  syncing=true;
  render();
  setStatus('Uploading this device to Harmonic Cloud…');
  try{
    const timestamp=new Date().toISOString();
    const {data,error}=await supabase.from('portal_settings').upsert({
      owner_id:session.user.id,
      portal_key:PORTAL_KEY,
      settings:payload(),
      updated_at:timestamp
    },{onConflict:'owner_id,portal_key'}).select('updated_at').single();
    if(error)throw error;
    lastCloudUpdatedAt=parseTime(data?.updated_at||timestamp);
    const value=meta();
    value.cloudUpdatedAt=lastCloudUpdatedAt;
    value.localUpdatedAt=lastCloudUpdatedAt;
    writeJson(CLOUD_META_KEY,value);
    localDirty=false;
    setStatus(`Synced ${new Date().toLocaleTimeString()}. This is now the cloud version.`);
    return true;
  }catch(error){
    console.error('Cloud sync failed',error);
    setStatus(`Sync failed: ${error.message}`);
    return false;
  }finally{
    syncing=false;
    render();
  }
}

async function loadLatestCloudCopy(){
  if(!session||syncing)return false;
  syncing=true;
  render();
  setStatus('Loading the latest synced version…');
  try{
    const remote=await fetchRemote();
    if(!remote?.settings){setStatus('No synced cloud version exists yet.');return false}

    const nextState=remote.settings.state||{};
    const nextLayout=remote.settings.layout||{};
    const currentState=readJson(STATE_KEY,{});
    const currentLayout=readJson(LAYOUT_KEY,{});
    const changed=JSON.stringify(currentState)!==JSON.stringify(nextState)||JSON.stringify(currentLayout)!==JSON.stringify(nextLayout);

    suppressTracking=true;
    try{
      if(changed){
        nativeSet(STATE_KEY,JSON.stringify(nextState));
        nativeSet(LAYOUT_KEY,JSON.stringify(nextLayout));
      }
      const cloudTime=parseTime(remote.updated_at||remote.settings.client_updated_at);
      lastCloudUpdatedAt=cloudTime;
      const value=meta();
      value.cloudUpdatedAt=cloudTime;
      value.localUpdatedAt=cloudTime;
      writeJson(CLOUD_META_KEY,value);
      localDirty=false;
    }finally{suppressTracking=false}

    if(changed){
      const reloadKey=`harmonic-city-applied-${session.user.id}`;
      const cloudStamp=String(lastCloudUpdatedAt);
      if(sessionStorage.getItem(reloadKey)!==cloudStamp){
        sessionStorage.setItem(reloadKey,cloudStamp);
        setStatus('Latest synced version loaded. Refreshing once…');
        setTimeout(()=>location.reload(),250);
        return true;
      }
    }

    setStatus('Latest synced version loaded.');
    return true;
  }catch(error){
    console.error('Cloud load failed',error);
    setStatus(`Cloud load failed: ${error.message}`);
    return false;
  }finally{
    syncing=false;
    render();
  }
}

async function pollCloud(){
  if(!session||syncing||document.hidden)return;
  try{
    const remote=await fetchRemote();
    const remoteTime=parseTime(remote?.updated_at||remote?.settings?.client_updated_at);
    if(remote?.settings&&remoteTime>lastCloudUpdatedAt+500)await loadLatestCloudCopy();
  }catch(error){console.warn('Cloud poll failed',error)}
}

function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(pollCloud,POLL_INTERVAL_MS)}

async function handleSession(){
  if(!session)return;
  if(loadedUserId===session.user.id)return;
  loadedUserId=session.user.id;
  await loadLatestCloudCopy();
  startPolling();
}

async function connect(){
  const config=await getConfig();
  if(!config.url||!config.anonKey){setStatus('Cloud configuration is missing.');return}
  supabase=createClient(config.url,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'harmonic-city-auth'}});
  const {data,error}=await supabase.auth.getSession();
  if(error)console.error(error);
  session=data?.session||null;
  supabase.auth.onAuthStateChange(async(_event,next)=>{
    session=next;
    render();
    if(session)await handleSession();
    else{loadedUserId='';clearInterval(pollTimer)}
  });
  render();
  if(session)await handleSession();
}

function simplifyActions(){
  $('#cloudSendLink')?.remove();
  $('#cloudLoadNow')?.remove();
  $('#cloudSignOut')?.remove();
  const syncButton=$('#cloudSyncNow');
  if(syncButton)syncButton.textContent='Sync';
}

function bindUI(){
  const modal=$('#cloudModal');
  const toggle=$('#cloudToggle');
  if(!modal||!toggle)return;
  simplifyActions();
  toggle.onclick=()=>modal.classList.add('open');
  $('#cloudClose').onclick=()=>modal.classList.remove('open');
  modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.remove('open')});
  getConfig().then(config=>{
    if($('#cloudUrl'))$('#cloudUrl').value=config.url||'';
    if($('#cloudAnonKey'))$('#cloudAnonKey').value=config.anonKey||'';
  });
  $('#cloudSaveConfig').onclick=async()=>{
    writeJson(CONFIG_KEY,{url:$('#cloudUrl').value.trim(),anonKey:$('#cloudAnonKey').value.trim()});
    setStatus('Connection saved.');
    loadedUserId='';
    await connect();
  };
  const syncButton=$('#cloudSyncNow');
  if(syncButton){
    syncButton.onclick=async()=>{
      if(!session){setStatus('Sign in first.');return}
      const ok=confirm('Sync this device now? This will replace the cloud copy on every device.');
      if(ok)await uploadCurrentDevice();
    };
  }
}

localStorage.setItem=(key,value)=>{nativeSet(key,value);if(key===STATE_KEY||key===LAYOUT_KEY)markLocalChange()};
localStorage.removeItem=(key)=>{nativeRemove(key);if(key===STATE_KEY||key===LAYOUT_KEY)markLocalChange()};

addEventListener('DOMContentLoaded',async()=>{
  ensureDeviceId();
  bindUI();
  await connect();
  addEventListener('focus',pollCloud);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollCloud()});
});