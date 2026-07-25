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
let saveTimer=null;
let pollTimer=null;
let suppressTracking=false;
let initialSyncStarted=false;

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
    if(response.ok){const data=await response.json();if(data?.ok&&data.url&&data.anonKey)runtime={url:data.url,anonKey:data.anonKey}}
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
    button.textContent=syncing?'☁ Syncing…':'☁ Cloud On';
    button.classList.add('cloud-connected');
    if(!syncing)setStatus(`Connected as ${session.user.email}. Changes autosave across devices.`);
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
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>saveWorkspace(),900);
}

async function fetchRemote(){
  if(!session)return null;
  const {data,error}=await supabase.from('portal_settings').select('settings,updated_at').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function saveWorkspace({force=false}={}){
  if(!session||syncing)return false;
  if(!force&&!localDirty)return true;
  syncing=true;
  render();
  setStatus('Saving workspace to Harmonic Cloud…');
  try{
    const settings=payload();
    const timestamp=new Date().toISOString();
    const {data,error}=await supabase.from('portal_settings').upsert({owner_id:session.user.id,portal_key:PORTAL_KEY,settings,updated_at:timestamp},{onConflict:'owner_id,portal_key'}).select('updated_at').single();
    if(error)throw error;
    lastCloudUpdatedAt=parseTime(data?.updated_at||timestamp);
    const value=meta();
    value.cloudUpdatedAt=lastCloudUpdatedAt;
    value.localUpdatedAt=lastCloudUpdatedAt;
    writeJson(CLOUD_META_KEY,value);
    localDirty=false;
    setStatus(`Cloud saved ${new Date().toLocaleTimeString()}`);
    return true;
  }catch(error){
    console.error('Cloud save failed',error);
    localDirty=true;
    setStatus(`Cloud save failed: ${error.message}`);
    return false;
  }finally{
    syncing=false;
    render();
  }
}

async function applyRemote(remote,{reload=true}={}){
  if(!remote?.settings)return false;
  suppressTracking=true;
  try{
    const settings=remote.settings;
    if(settings.state)nativeSet(STATE_KEY,JSON.stringify(settings.state));
    if(settings.layout)nativeSet(LAYOUT_KEY,JSON.stringify(settings.layout));
    const cloudTime=parseTime(remote.updated_at||settings.client_updated_at);
    const value=meta();
    value.cloudUpdatedAt=cloudTime;
    value.localUpdatedAt=cloudTime;
    value.deviceId=value.deviceId||ensureDeviceId();
    writeJson(CLOUD_META_KEY,value);
    lastCloudUpdatedAt=cloudTime;
    localDirty=false;
  }finally{suppressTracking=false}
  if(reload){setStatus('New cloud changes found. Refreshing…');setTimeout(()=>location.reload(),250)}
  return true;
}

async function initialSync(){
  if(initialSyncStarted||!session)return;
  initialSyncStarted=true;
  try{
    setStatus('Loading Harmonic Cloud workspace…');
    const remote=await fetchRemote();
    const localTime=Number(meta().localUpdatedAt||0);
    const remoteTime=parseTime(remote?.updated_at||remote?.settings?.client_updated_at);
    lastCloudUpdatedAt=remoteTime;
    if(!remote?.settings){
      localDirty=true;
      await saveWorkspace({force:true});
    }else if(localTime>remoteTime&&localTime>0){
      localDirty=true;
      await saveWorkspace({force:true});
    }else{
      await applyRemote(remote,{reload:false});
      if(!sessionStorage.getItem('harmonic-city-cloud-initialized')){
        sessionStorage.setItem('harmonic-city-cloud-initialized','1');
        setTimeout(()=>location.reload(),250);
        return;
      }
      setStatus('Cloud workspace loaded. Autosave is active.');
    }
    startPolling();
  }catch(error){
    console.error('Initial cloud sync failed',error);
    setStatus(`Cloud sync failed: ${error.message}`);
    initialSyncStarted=false;
    syncing=false;
    render();
  }
}

async function pollCloud(){
  if(!session||syncing||document.hidden)return;
  try{
    if(localDirty){await saveWorkspace();return}
    const remote=await fetchRemote();
    const remoteTime=parseTime(remote?.updated_at||remote?.settings?.client_updated_at);
    if(remote?.settings&&remoteTime>lastCloudUpdatedAt+500)await applyRemote(remote);
  }catch(error){console.warn('Cloud poll failed',error)}
}

function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(pollCloud,POLL_INTERVAL_MS)}

async function connect(){
  const config=await getConfig();
  if(!config.url||!config.anonKey){setStatus('Cloud configuration is missing.');return}
  supabase=createClient(config.url,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'harmonic-city-auth'}});
  const {data,error}=await supabase.auth.getSession();
  if(error)console.error(error);
  session=data?.session||null;
  supabase.auth.onAuthStateChange((_event,next)=>{session=next;render();if(session)initialSync()});
  render();
  if(session)initialSync();
}

function bindUI(){
  const modal=$('#cloudModal');
  const toggle=$('#cloudToggle');
  if(!modal||!toggle)return;
  toggle.onclick=()=>modal.classList.add('open');
  $('#cloudClose').onclick=()=>modal.classList.remove('open');
  modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.remove('open')});
  getConfig().then(config=>{if($('#cloudUrl'))$('#cloudUrl').value=config.url||'';if($('#cloudAnonKey'))$('#cloudAnonKey').value=config.anonKey||''});
  $('#cloudSaveConfig').onclick=async()=>{writeJson(CONFIG_KEY,{url:$('#cloudUrl').value.trim(),anonKey:$('#cloudAnonKey').value.trim()});setStatus('Cloud configuration saved. Connecting…');initialSyncStarted=false;await connect()};
  $('#cloudSyncNow').onclick=async()=>{if(!session){setStatus('Sign in first.');return}localDirty=true;await saveWorkspace({force:true})};
  $('#cloudSignOut').onclick=async()=>{if(supabase)await supabase.auth.signOut();session=null;initialSyncStarted=false;localDirty=false;clearInterval(pollTimer);sessionStorage.removeItem('harmonic-city-cloud-initialized');render()};
}

localStorage.setItem=(key,value)=>{nativeSet(key,value);if(key===STATE_KEY||key===LAYOUT_KEY)markLocalChange()};
localStorage.removeItem=(key)=>{nativeRemove(key);if(key===STATE_KEY||key===LAYOUT_KEY)markLocalChange()};

addEventListener('DOMContentLoaded',async()=>{
  ensureDeviceId();
  bindUI();
  await connect();
  addEventListener('focus',pollCloud);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollCloud()});
  addEventListener('online',()=>{localDirty?saveWorkspace():pollCloud()});
});