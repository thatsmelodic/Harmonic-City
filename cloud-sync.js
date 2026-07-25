import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Upload } from 'https://esm.sh/tus-js-client@4';

const STATE_KEY='harmonic-city-state-v2';
const LAYOUT_KEY='harmonic-city-studio-layout-v1';
const CONFIG_KEY='harmonic-city-supabase-config-v1';
const CLOUD_META_KEY='harmonic-city-cloud-meta-v2';
const PORTAL_KEY='harmonic-city';
const POLL_INTERVAL_MS=4000;
const MEDIA_DB='harmonic-city-media';
const MEDIA_STORE='assets';
const MEDIA_KINDS=['background','intro','audio','core'];
const STORAGE_BUCKET='harmonic-city-media';

let supabase=null;
let session=null;
let syncing=false;
let localDirty=false;
let lastCloudUpdatedAt=0;
let pollTimer=null;
let suppressTracking=false;
let loadedUserId='';
let cloudConfig={url:'',anonKey:''};

const $=selector=>document.querySelector(selector);
const nativeSet=localStorage.setItem.bind(localStorage);
const nativeRemove=localStorage.removeItem.bind(localStorage);

function readJson(key,fallback={}){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch{return fallback}}
function writeJson(key,value){nativeSet(key,JSON.stringify(value))}
function parseTime(value){const time=Date.parse(value||'');return Number.isFinite(time)?time:0}
function setStatus(text){const el=$('#cloudStatus');if(el)el.textContent=text}
function meta(){return readJson(CLOUD_META_KEY,{localUpdatedAt:0,cloudUpdatedAt:0,deviceId:''})}
function ensureDeviceId(){const value=meta();if(!value.deviceId){value.deviceId=crypto.randomUUID();writeJson(CLOUD_META_KEY,value)}return value.deviceId}
function safeName(value){return String(value||'media').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-120)||'media'}
function friendlyError(error){const message=String(error?.message||error||'Unknown cloud error');if(/bucket.*not found|not found.*bucket/i.test(message))return 'Harmonic Cloud storage is not configured yet (missing harmonic-city-media bucket).';if(/row-level security|unauthorized|403/i.test(message))return 'Harmonic Cloud storage permission was denied. Apply the storage policies for this project.';if(/failed to fetch|networkerror/i.test(message))return 'Unable to reach Harmonic Cloud. Check the connection and try again.';return message}

function openMediaDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open(MEDIA_DB,1);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(MEDIA_STORE)){const store=db.createObjectStore(MEDIA_STORE,{keyPath:'id'});store.createIndex('kind','kind')}};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function mediaGet(id){if(!id)return null;const db=await openMediaDB();return new Promise((resolve,reject)=>{const request=db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).get(id);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)})}
async function mediaPut(item){const db=await openMediaDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MEDIA_STORE,'readwrite');tx.objectStore(MEDIA_STORE).put(item);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)})}

async function getConfig(){let runtime=null;try{const response=await fetch('/api/config',{cache:'no-store'});if(response.ok){const data=await response.json();if(data?.ok&&data.url&&data.anonKey)runtime={url:data.url,anonKey:data.anonKey}}}catch(error){console.warn('Runtime config unavailable',error)}const saved=readJson(CONFIG_KEY,{});const config={url:runtime?.url||saved.url||'',anonKey:runtime?.anonKey||saved.anonKey||''};if(config.url&&config.anonKey)writeJson(CONFIG_KEY,config);cloudConfig=config;return config}
function render(){const button=$('#cloudToggle');if(!button)return;if(session){button.textContent=syncing?'☁ Syncing…':localDirty?'☁ Local Changes':'☁ Cloud On';button.classList.add('cloud-connected')}else{button.textContent='☁ Connect Cloud';button.classList.remove('cloud-connected')}}
function markLocalChange(){if(suppressTracking)return;const value=meta();value.localUpdatedAt=Date.now();value.deviceId=value.deviceId||ensureDeviceId();writeJson(CLOUD_META_KEY,value);localDirty=true;render();setStatus('Local changes are not synced. Press Sync to upload this device.')}
async function fetchRemote(){if(!session)return null;const {data,error}=await supabase.from('portal_settings').select('settings,updated_at').eq('owner_id',session.user.id).eq('portal_key',PORTAL_KEY).maybeSingle();if(error)throw error;return data||null}

function resumableUpload(item,path,kind){return new Promise((resolve,reject)=>{const endpoint=`${cloudConfig.url.replace(/\/$/,'')}/storage/v1/upload/resumable`;const upload=new Upload(item.blob,{endpoint,retryDelays:[0,1000,3000,5000,10000],headers:{authorization:`Bearer ${session.access_token}`,apikey:cloudConfig.anonKey,'x-upsert':'true'},uploadSize:item.blob.size,chunkSize:6*1024*1024,removeFingerprintOnSuccess:true,metadata:{bucketName:STORAGE_BUCKET,objectName:path,contentType:item.type||item.blob.type||'application/octet-stream',cacheControl:'3600'},onError:error=>reject(error),onProgress:(sent,total)=>{const percent=total?Math.round(sent/total*100):0;setStatus(`Uploading ${kind} media… ${percent}%`)},onSuccess:()=>resolve(path)});upload.findPreviousUploads().then(previous=>{if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject)})}

async function uploadSelectedAssets(state){const assets={};for(const kind of MEDIA_KINDS){const id=state?.[`${kind}MediaId`];if(!id)continue;const item=await mediaGet(id);if(!item?.blob)throw new Error(`${kind} media is selected but its local file is missing.`);const path=`${session.user.id}/${PORTAL_KEY}/${kind}/${item.id}-${safeName(item.name)}`;await resumableUpload(item,path,kind);assets[kind]={id:item.id,kind,name:item.name||`${kind}-media`,type:item.type||item.blob.type||'application/octet-stream',size:item.blob.size,createdAt:item.createdAt||Date.now(),bucket:STORAGE_BUCKET,path}}return assets}
async function restoreSelectedAssets(assets={}){for(const [kind,asset] of Object.entries(assets)){if(!MEDIA_KINDS.includes(kind)||!asset?.id||!asset?.path)continue;const existing=await mediaGet(asset.id);if(existing?.blob)continue;setStatus(`Downloading ${kind} media from Harmonic Cloud…`);const {data,error}=await supabase.storage.from(asset.bucket||STORAGE_BUCKET).download(asset.path);if(error)throw error;await mediaPut({id:asset.id,kind,name:asset.name||`${kind}-media`,type:asset.type||data.type||'application/octet-stream',blob:data,createdAt:asset.createdAt||Date.now()})}}

async function uploadCurrentDevice(){if(!session){setStatus('Sign in first.');return false}if(syncing)return false;syncing=true;render();try{const state=readJson(STATE_KEY,{});setStatus('Preparing Harmonic Cloud sync…');const assets=await uploadSelectedAssets(state);setStatus('Saving layout and media references…');const timestamp=new Date().toISOString();const settings={state,layout:readJson(LAYOUT_KEY,{}),assets,client_updated_at:timestamp,device_id:ensureDeviceId()};const {data,error}=await supabase.from('portal_settings').upsert({owner_id:session.user.id,portal_key:PORTAL_KEY,settings,updated_at:timestamp},{onConflict:'owner_id,portal_key'}).select('updated_at').single();if(error)throw error;lastCloudUpdatedAt=parseTime(data?.updated_at||timestamp);const value=meta();value.cloudUpdatedAt=lastCloudUpdatedAt;value.localUpdatedAt=lastCloudUpdatedAt;writeJson(CLOUD_META_KEY,value);localDirty=false;setStatus(`Synced ${new Date().toLocaleTimeString()}. This device is now the cloud version.`);return true}catch(error){console.error('Cloud sync failed',error);setStatus(`Sync failed: ${friendlyError(error)}`);return false}finally{syncing=false;render()}}

async function loadLatestCloudCopy(){if(!session||syncing)return false;syncing=true;render();setStatus('Loading the latest synced version…');try{const remote=await fetchRemote();if(!remote?.settings){setStatus('No synced cloud version exists yet.');return false}const nextState=remote.settings.state||{};const nextLayout=remote.settings.layout||{};const currentState=readJson(STATE_KEY,{});const currentLayout=readJson(LAYOUT_KEY,{});let missingAsset=false;for(const kind of MEDIA_KINDS){const id=nextState?.[`${kind}MediaId`];if(id&&!(await mediaGet(id))){missingAsset=true;break}}const changed=JSON.stringify(currentState)!==JSON.stringify(nextState)||JSON.stringify(currentLayout)!==JSON.stringify(nextLayout)||missingAsset;suppressTracking=true;try{await restoreSelectedAssets(remote.settings.assets||{});if(changed){nativeSet(STATE_KEY,JSON.stringify(nextState));nativeSet(LAYOUT_KEY,JSON.stringify(nextLayout))}const cloudTime=parseTime(remote.updated_at||remote.settings.client_updated_at);lastCloudUpdatedAt=cloudTime;const value=meta();value.cloudUpdatedAt=cloudTime;value.localUpdatedAt=cloudTime;writeJson(CLOUD_META_KEY,value);localDirty=false}finally{suppressTracking=false}if(changed){const reloadKey=`harmonic-city-applied-${session.user.id}`;const cloudStamp=String(lastCloudUpdatedAt);if(sessionStorage.getItem(reloadKey)!==cloudStamp){sessionStorage.setItem(reloadKey,cloudStamp);setStatus('Latest synced version loaded. Refreshing once…');setTimeout(()=>location.reload(),300);return true}}setStatus('Latest synced version loaded.');return true}catch(error){console.error('Cloud load failed',error);setStatus(`Cloud load failed: ${friendlyError(error)}`);return false}finally{syncing=false;render()}}

async function pollCloud(){if(!session||syncing||document.hidden)return;try{const remote=await fetchRemote();const remoteTime=parseTime(remote?.updated_at||remote?.settings?.client_updated_at);if(remote?.settings&&remoteTime>lastCloudUpdatedAt+500)await loadLatestCloudCopy()}catch(error){console.warn('Cloud poll failed',error)}}
function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(pollCloud,POLL_INTERVAL_MS)}
async function handleSession(){if(!session)return;if(loadedUserId===session.user.id)return;loadedUserId=session.user.id;await loadLatestCloudCopy();startPolling()}
async function connect(){const config=await getConfig();if(!config.url||!config.anonKey){setStatus('Cloud configuration is missing.');return}supabase=createClient(config.url,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'harmonic-city-auth'}});const {data,error}=await supabase.auth.getSession();if(error)console.error(error);session=data?.session||null;supabase.auth.onAuthStateChange(async(_event,next)=>{session=next;render();if(session)await handleSession();else{loadedUserId='';clearInterval(pollTimer)}});render();if(session)await handleSession()}
function simplifyActions(){$('#cloudSendLink')?.remove();$('#cloudLoadNow')?.remove();$('#cloudSignOut')?.remove();const syncButton=$('#cloudSyncNow');if(syncButton)syncButton.textContent='Sync'}
function bindUI(){const modal=$('#cloudModal');const toggle=$('#cloudToggle');if(!modal||!toggle)return;simplifyActions();toggle.onclick=()=>modal.classList.add('open');$('#cloudClose').onclick=()=>modal.classList.remove('open');modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.remove('open')});getConfig().then(config=>{if($('#cloudUrl'))$('#cloudUrl').value=config.url||'';if($('#cloudAnonKey'))$('#cloudAnonKey').value=config.anonKey||''});$('#cloudSaveConfig').onclick=async()=>{writeJson(CONFIG_KEY,{url:$('#cloudUrl').value.trim(),anonKey:$('#cloudAnonKey').value.trim()});setStatus('Connection saved.');loadedUserId='';await connect()};const syncButton=$('#cloudSyncNow');if(syncButton){syncButton.onclick=async()=>{if(!session){setStatus('Sign in first.');return}const ok=confirm('Sync this device now? This will replace the cloud copy on every device.');if(ok)await uploadCurrentDevice()}}}
localStorage.setItem=(key,value)=>{nativeSet(key,value);if(key===STATE_KEY||key===LAYOUT_KEY)markLocalChange()};
localStorage.removeItem=(key)=>{nativeRemove(key);if(key===STATE_KEY||key===LAYOUT_KEY)markLocalChange()};
addEventListener('DOMContentLoaded',async()=>{ensureDeviceId();bindUI();await connect();addEventListener('focus',pollCloud);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollCloud()})});