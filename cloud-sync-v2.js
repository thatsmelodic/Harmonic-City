import { getRuntimeConfig, getSupabaseClient, resetSupabaseClient } from './supabase-client.js';

const STATE_KEY = 'harmonic-city-state-v2';
const LAYOUT_KEY = 'harmonic-city-studio-layout-v1';
const CONFIG_KEY = 'harmonic-city-supabase-config-v1';
const META_KEY = 'harmonic-city-cloud-meta-v3';
const PORTAL_KEY = 'harmonic-city';
const BUCKET = 'harmonic-city-media';
const MEDIA_DB = 'harmonic-city-media';
const MEDIA_STORE = 'assets';
const MEDIA_KINDS = ['background', 'intro', 'audio', 'core'];
const POLL_MS = 60000;

const $ = selector => document.querySelector(selector);
const nativeSet = localStorage.setItem.bind(localStorage);
const nativeRemove = localStorage.removeItem.bind(localStorage);
let client;
let session;
let pollTimer;
let busy = false;
let suppressDirty = false;
let localDirty = false;
let awaitingDecision = false;
let pendingRemote = null;
let lastCloudTime = 0;
let statusMessage = '';

function readJson(key, fallback = {}) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
  catch { return fallback; }
}
function writeJson(key, value) { nativeSet(key, JSON.stringify(value)); }
function hasMeaningfulData(value) { return value && typeof value === 'object' && Object.keys(value).length > 0; }
function parseTime(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : 0; }
function setStatus(message) { statusMessage = message; if ($('#cloudStatus')) $('#cloudStatus').textContent = message; render(); }
function meta() { return readJson(META_KEY, { deviceId: '', lastCloudTime: 0 }); }
function deviceId() { const value = meta(); if (!value.deviceId) { value.deviceId = crypto.randomUUID(); writeJson(META_KEY, value); } return value.deviceId; }
function render() {
  const toggle = $('#cloudToggle');
  if (toggle) {
    toggle.classList.toggle('cloud-connected', Boolean(session));
    toggle.textContent = !session ? '☁ Connect Cloud' : busy ? '☁ Syncing…' : awaitingDecision ? '☁ Choose Version' : localDirty ? '☁ Local Changes' : '☁ Cloud On';
  }
  const decision = $('#cloudDecision');
  if (decision) decision.hidden = !awaitingDecision;
  const identity = $('#cloudIdentity');
  if (identity) identity.textContent = session?.user?.email ? `Signed in as ${session.user.email}` : 'Not signed in';
  const signOut = $('#cloudSignOut');
  if (signOut) signOut.hidden = !session;
}
function markDirty() {
  if (suppressDirty) return;
  localDirty = true;
  setStatus('Saved on this device. Cloud sync is waiting.');
}
function openMediaDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath: 'id' }).createIndex('kind', 'kind');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function mediaGet(id) {
  if (!id) return null;
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
async function mediaPut(item) {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    tx.objectStore(MEDIA_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function fetchRemote() {
  if (!session) return null;
  const { data, error } = await client.from('portal_settings').select('settings,updated_at,owner_id,portal_key').eq('owner_id', session.user.id).eq('portal_key', PORTAL_KEY).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function uploadAssets(state) {
  const assets = {};
  for (const kind of MEDIA_KINDS) {
    const id = state?.[`${kind}MediaId`];
    if (!id) continue;
    const item = await mediaGet(id);
    if (!item?.blob) throw new Error(`${kind} media is missing from this device.`);
    const cleanName = String(item.name || `${kind}-media`).replace(/[^a-zA-Z0-9._-]+/g, '-');
    const path = `${session.user.id}/${PORTAL_KEY}/${kind}/${crypto.randomUUID()}/${cleanName}`;
    const { error } = await client.storage.from(BUCKET).upload(path, item.blob, { contentType: item.type || item.blob.type, upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    assets[kind] = { id, kind, name: item.name, type: item.type || item.blob.type, size: item.blob.size, bucket: BUCKET, path, createdAt: item.createdAt || Date.now() };
  }
  return assets;
}
async function restoreAssets(assets = {}) {
  for (const [kind, asset] of Object.entries(assets)) {
    if (!MEDIA_KINDS.includes(kind) || !asset?.id || !asset?.path) continue;
    const existing = await mediaGet(asset.id);
    if (existing?.blob && existing.cloudPath === asset.path) continue;
    const { data, error } = await client.storage.from(asset.bucket || BUCKET).download(asset.path);
    if (error) throw error;
    await mediaPut({ id: asset.id, kind, name: asset.name, type: asset.type || data.type, blob: data, createdAt: asset.createdAt || Date.now(), cloudPath: asset.path });
  }
}
async function applyRemote(remote) {
  if (!remote?.settings) return false;
  busy = true; render();
  try {
    suppressDirty = true;
    nativeSet(STATE_KEY, JSON.stringify(remote.settings.state || {}));
    nativeSet(LAYOUT_KEY, JSON.stringify(remote.settings.layout || {}));
    await restoreAssets(remote.settings.assets || {});
    lastCloudTime = parseTime(remote.updated_at || remote.settings.client_updated_at);
    const value = meta(); value.lastCloudTime = lastCloudTime; writeJson(META_KEY, value);
    localDirty = false; awaitingDecision = false; pendingRemote = null;
    window.dispatchEvent(new CustomEvent('harmonic-cloud-applied'));
    setStatus('Cloud version loaded.');
    setTimeout(() => location.reload(), 250);
    return true;
  } finally { suppressDirty = false; busy = false; render(); }
}
async function uploadLocal() {
  if (!session || busy) return false;
  busy = true; render();
  try {
    const state = readJson(STATE_KEY, {});
    const timestamp = new Date().toISOString();
    const settings = { state, layout: readJson(LAYOUT_KEY, {}), assets: await uploadAssets(state), client_updated_at: timestamp, device_id: deviceId(), schema_version: 2 };
    const { data, error } = await client.from('portal_settings').upsert({ owner_id: session.user.id, portal_key: PORTAL_KEY, settings, updated_at: timestamp }, { onConflict: 'owner_id,portal_key' }).select('updated_at').single();
    if (error) throw error;
    lastCloudTime = parseTime(data?.updated_at || timestamp);
    localDirty = false; awaitingDecision = false; pendingRemote = null;
    setStatus('This device is now saved to Harmonic Cloud.');
    return true;
  } catch (error) { setStatus(`Sync failed: ${error.message}`); return false; }
  finally { busy = false; render(); }
}
async function establishFirstSync() {
  const remote = await fetchRemote();
  const localExists = hasMeaningfulData(readJson(STATE_KEY, {})) || hasMeaningfulData(readJson(LAYOUT_KEY, {}));
  const cloudExists = Boolean(remote?.settings);
  pendingRemote = remote;
  awaitingDecision = localExists || cloudExists;
  if (localExists && cloudExists) setStatus('Local and cloud versions both exist. Choose which one to use.');
  else if (cloudExists) setStatus('A cloud version exists. Choose Use cloud copy to load it.');
  else if (localExists) setStatus('This device has unsynced work. Choose Use this device to upload it.');
  else { awaitingDecision = false; setStatus('Cloud connected. No saved version exists yet.'); }
  render();
}
async function pollCloud() {
  if (!session || busy || awaitingDecision || localDirty || document.hidden) return;
  try {
    const remote = await fetchRemote();
    const remoteTime = parseTime(remote?.updated_at || remote?.settings?.client_updated_at);
    if (remote?.settings && remoteTime > lastCloudTime + 500) await applyRemote(remote);
  } catch (error) { console.warn('[Harmonic Cloud] poll failed', error); }
}
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(pollCloud, POLL_MS); }
async function connect() {
  try {
    const result = await getSupabaseClient();
    client = result.client;
    const fields = $('#cloudConfigFields');
    if (fields) fields.hidden = result.config.source === 'runtime';
    const { data } = await client.auth.getSession();
    session = data?.session || null;
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (session) queueMicrotask(async () => { await establishFirstSync(); startPolling(); });
      else { clearInterval(pollTimer); awaitingDecision = false; pendingRemote = null; setStatus('Signed out. Your current work remains on this device.'); render(); }
    });
    if (session) { await establishFirstSync(); startPolling(); }
    else setStatus('Not connected. Your work is still saved on this browser.');
  } catch (error) { setStatus(error.message); }
  render();
}
function bindUi() {
  const modal = $('#cloudModal');
  $('#cloudToggle')?.addEventListener('click', () => { modal?.removeAttribute('aria-hidden'); modal?.classList.add('open'); if (statusMessage) setStatus(statusMessage); });
  $('#cloudClose')?.addEventListener('click', () => { modal?.classList.remove('open'); modal?.setAttribute('aria-hidden', 'true'); });
  $('#cloudSaveConfig')?.addEventListener('click', async () => {
    const url = $('#cloudUrl')?.value.trim(); const anonKey = $('#cloudAnonKey')?.value.trim();
    if (!url || !anonKey) return setStatus('Enter the Supabase URL and public anon key.');
    writeJson(CONFIG_KEY, { url, anonKey }); resetSupabaseClient(); await connect();
  });
  $('#cloudSyncNow')?.addEventListener('click', async () => { if (!session) return setStatus('Sign in first.'); if (confirm('Use this device as the cloud version?')) await uploadLocal(); });
  $('#cloudLoadNow')?.addEventListener('click', async () => { if (!session) return setStatus('Sign in first.'); const remote = await fetchRemote(); if (remote?.settings && confirm('Replace this device with the cloud copy?')) await applyRemote(remote); });
  $('#cloudUseLocal')?.addEventListener('click', async () => { if (confirm('Upload this device and make it the cloud version?')) await uploadLocal(); });
  $('#cloudUseRemote')?.addEventListener('click', async () => { if (pendingRemote?.settings && confirm('Replace this device with the cloud copy?')) await applyRemote(pendingRemote); });
  $('#cloudCancelDecision')?.addEventListener('click', () => { awaitingDecision = false; pendingRemote = null; setStatus('No version was replaced. Cloud application is paused until you choose manually.'); });
}

localStorage.setItem = (key, value) => { nativeSet(key, value); if (key === STATE_KEY || key === LAYOUT_KEY) markDirty(); };
localStorage.removeItem = key => { nativeRemove(key); if (key === STATE_KEY || key === LAYOUT_KEY) markDirty(); };
window.HarmonicCloud = { syncThisDevice: uploadLocal, loadLatest: async () => { const remote = await fetchRemote(); return applyRemote(remote); }, getStatus: () => ({ connected: Boolean(session), localDirty, awaitingDecision, lastCloudTime }) };
addEventListener('DOMContentLoaded', async () => { deviceId(); bindUi(); await connect(); addEventListener('focus', pollCloud); document.addEventListener('visibilitychange', () => { if (!document.hidden) pollCloud(); }); });
