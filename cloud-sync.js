import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STATE_KEY = 'harmonic-city-state-v2';
const LAYOUT_KEY = 'harmonic-city-studio-layout-v1';
const CONFIG_KEY = 'harmonic-city-supabase-config-v1';
const CLOUD_META_KEY = 'harmonic-city-cloud-meta-v2';
const APPLIED_KEY = 'harmonic-city-cloud-applied-v3';
const PORTAL_KEY = 'harmonic-city';
const POLL_INTERVAL_MS = 10000;
const MEDIA_DB = 'harmonic-city-media';
const MEDIA_STORE = 'assets';
const MEDIA_KINDS = ['background', 'intro', 'audio', 'core'];
const STORAGE_BUCKET = 'harmonic-city-media';

let supabase = null;
let session = null;
let syncing = false;
let localDirty = false;
let lastCloudUpdatedAt = 0;
let pollTimer = null;
let suppressTracking = false;
let loadedUserId = '';
let cloudConfig = { url: '', anonKey: '' };
let connectPromise = null;
let cloudState = 'disconnected';
let cloudMessage = '';

const $ = selector => document.querySelector(selector);
const nativeSet = localStorage.setItem.bind(localStorage);
const nativeRemove = localStorage.removeItem.bind(localStorage);

function readJson(key, fallback = {}) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  nativeSet(key, JSON.stringify(value));
}

function parseTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function simpleHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function setStatus(text) {
  cloudMessage = text;
  const element = $('#cloudStatus');
  if (element) element.textContent = text;
}

function meta() {
  return readJson(CLOUD_META_KEY, {
    localUpdatedAt: 0,
    cloudUpdatedAt: 0,
    deviceId: ''
  });
}

function ensureDeviceId() {
  const value = meta();
  if (!value.deviceId) {
    value.deviceId = crypto.randomUUID();
    writeJson(CLOUD_META_KEY, value);
  }
  return value.deviceId;
}

function safeName(value) {
  return String(value || 'media')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120) || 'media';
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Unknown cloud error');
  if (/bucket.*not found|not found.*bucket/i.test(message)) {
    return 'Harmonic Cloud storage is not configured yet (missing harmonic-city-media bucket).';
  }
  if (/row-level security|unauthorized|403/i.test(message)) {
    return 'Harmonic Cloud permission was denied. Check the Supabase policies.';
  }
  if (/failed to fetch|networkerror|status 0/i.test(message)) {
    return 'This device could not reach Harmonic Cloud. Check the connection and try again.';
  }
  return message;
}

function encodeStoragePath(path) {
  return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

function render() {
  const button = $('#cloudToggle');
  if (!button) return;

  if (!session) {
    button.textContent = '☁ Connect Cloud';
    button.classList.remove('cloud-connected');
    return;
  }

  button.classList.add('cloud-connected');

  if (syncing || cloudState === 'connecting' || cloudState === 'loading') {
    button.textContent = '☁ Syncing…';
  } else if (localDirty) {
    button.textContent = '☁ Local Changes';
  } else if (cloudState === 'ready') {
    button.textContent = '☁ Cloud Synced';
  } else if (cloudState === 'empty') {
    button.textContent = '☁ Cloud Empty';
  } else if (cloudState === 'error') {
    button.textContent = '☁ Cloud Error';
  } else {
    button.textContent = '☁ Cloud Connected';
  }
}

function markLocalChange() {
  if (suppressTracking) return;
  const value = meta();
  value.localUpdatedAt = Date.now();
  value.deviceId = value.deviceId || ensureDeviceId();
  writeJson(CLOUD_META_KEY, value);
  localDirty = true;
  render();
  setStatus('Local changes are not synced. Press Sync to make this device the cloud version.');
}

function notifyCloudApplied(detail) {
  try {
    window.dispatchEvent(new CustomEvent('harmonic-cloud-applied', { detail }));
    window.dispatchEvent(new StorageEvent('storage', {
      key: STATE_KEY,
      newValue: localStorage.getItem(STATE_KEY),
      storageArea: localStorage,
      url: location.href
    }));
  } catch (error) {
    console.warn('[Harmonic Cloud] apply notification failed', error);
  }
}

function openMediaDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const store = db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
        store.createIndex('kind', 'kind');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function mediaGet(id) {
  if (!id) return null;
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function mediaPut(item) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE, 'readwrite');
    transaction.objectStore(MEDIA_STORE).put(item);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getConfig() {
  let runtime = null;
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (data?.ok && data.url && data.anonKey) {
        runtime = { url: data.url, anonKey: data.anonKey };
      }
    }
  } catch (error) {
    console.warn('[Harmonic Cloud] runtime config unavailable', error);
  }

  const saved = readJson(CONFIG_KEY, {});
  const config = {
    url: runtime?.url || saved.url || '',
    anonKey: runtime?.anonKey || saved.anonKey || ''
  };

  if (config.url && config.anonKey) writeJson(CONFIG_KEY, config);
  cloudConfig = config;
  return config;
}

async function fetchRemote() {
  if (!session) return null;
  const { data, error } = await supabase
    .from('portal_settings')
    .select('settings,updated_at,owner_id,portal_key')
    .eq('owner_id', session.user.id)
    .eq('portal_key', PORTAL_KEY)
    .maybeSingle();

  if (error) throw error;
  console.info('[Harmonic Cloud] remote lookup', {
    userId: session.user.id,
    found: Boolean(data),
    updatedAt: data?.updated_at || null
  });
  return data || null;
}

function browserUpload(item, path, kind) {
  return new Promise((resolve, reject) => {
    const base = cloudConfig.url.replace(/\/$/, '');
    const endpoint = `${base}/storage/v1/object/${encodeURIComponent(STORAGE_BUCKET)}/${encodeStoragePath(path)}`;
    const xhr = new XMLHttpRequest();

    xhr.open('POST', endpoint, true);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', cloudConfig.anonKey);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.setRequestHeader('cache-control', '3600');
    xhr.setRequestHeader('content-type', item.type || item.blob.type || 'application/octet-stream');

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setStatus(`Uploading ${kind} media… ${percent}%`);
    };

    xhr.onerror = () => reject(new Error(`Storage upload network failure (status ${xhr.status || 0}).`));
    xhr.onabort = () => reject(new Error(`${kind} upload was canceled.`));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(path);
        return;
      }
      let detail = xhr.responseText || `HTTP ${xhr.status}`;
      try {
        const parsed = JSON.parse(xhr.responseText);
        detail = parsed.message || parsed.error || detail;
      } catch {}
      reject(new Error(`Storage upload failed (${xhr.status}): ${detail}`));
    };
    xhr.send(item.blob);
  });
}

async function uploadSelectedAssets(state) {
  const assets = {};
  for (const kind of MEDIA_KINDS) {
    const id = state?.[`${kind}MediaId`];
    if (!id) continue;
    const item = await mediaGet(id);
    if (!item?.blob) throw new Error(`${kind} media is selected but its local file is missing.`);
    const path = `${session.user.id}/${PORTAL_KEY}/${kind}/${item.id}-${safeName(item.name)}`;
    await browserUpload(item, path, kind);
    assets[kind] = {
      id: item.id,
      kind,
      name: item.name || `${kind}-media`,
      type: item.type || item.blob.type || 'application/octet-stream',
      size: item.blob.size,
      createdAt: item.createdAt || Date.now(),
      bucket: STORAGE_BUCKET,
      path
    };
  }
  return assets;
}

async function assetNeedsRefresh(asset) {
  if (!asset?.id || !asset?.path) return false;
  const existing = await mediaGet(asset.id);
  if (!existing?.blob) return true;
  if (existing.cloudPath !== asset.path) return true;
  if (Number(asset.size) > 0 && existing.blob.size !== Number(asset.size)) return true;
  if (asset.type && existing.blob.type && existing.blob.type !== asset.type) return true;
  return false;
}

async function restoreSelectedAssets(assets = {}) {
  let downloaded = 0;
  const failures = [];

  for (const [kind, asset] of Object.entries(assets)) {
    if (!MEDIA_KINDS.includes(kind) || !asset?.id || !asset?.path) continue;
    try {
      if (!(await assetNeedsRefresh(asset))) continue;
      setStatus(`Downloading ${kind} media from Harmonic Cloud…`);
      const { data, error } = await supabase.storage
        .from(asset.bucket || STORAGE_BUCKET)
        .download(asset.path);
      if (error) throw error;
      await mediaPut({
        id: asset.id,
        kind,
        name: asset.name || `${kind}-media`,
        type: asset.type || data.type || 'application/octet-stream',
        blob: data,
        createdAt: asset.createdAt || Date.now(),
        cloudPath: asset.path,
        cloudSize: Number(asset.size) || data.size
      });
      downloaded += 1;
    } catch (error) {
      failures.push({ kind, error: friendlyError(error) });
      console.error('[Harmonic Cloud] media restore failed', { kind, path: asset?.path, error });
    }
  }

  return { downloaded, failures };
}

async function uploadCurrentDevice() {
  if (!session) {
    setStatus('Sign in first.');
    return false;
  }
  if (syncing) return false;

  syncing = true;
  cloudState = 'loading';
  render();

  try {
    const state = readJson(STATE_KEY, {});
    setStatus('Preparing Harmonic Cloud sync…');
    const assets = await uploadSelectedAssets(state);
    setStatus('Saving layout and media references…');

    const timestamp = new Date().toISOString();
    const settings = {
      state,
      layout: readJson(LAYOUT_KEY, {}),
      assets,
      client_updated_at: timestamp,
      device_id: ensureDeviceId()
    };

    const { data, error } = await supabase
      .from('portal_settings')
      .upsert({
        owner_id: session.user.id,
        portal_key: PORTAL_KEY,
        settings,
        updated_at: timestamp
      }, { onConflict: 'owner_id,portal_key' })
      .select('updated_at')
      .single();

    if (error) throw error;

    lastCloudUpdatedAt = parseTime(data?.updated_at || timestamp);
    const value = meta();
    value.cloudUpdatedAt = lastCloudUpdatedAt;
    value.localUpdatedAt = lastCloudUpdatedAt;
    writeJson(CLOUD_META_KEY, value);
    writeJson(APPLIED_KEY, {
      userId: session.user.id,
      hash: simpleHash(settings),
      updatedAt: lastCloudUpdatedAt
    });

    localDirty = false;
    cloudState = 'ready';
    setStatus(`Cloud synced at ${new Date().toLocaleTimeString()}. This device is now the cloud version.`);
    return true;
  } catch (error) {
    cloudState = 'error';
    console.error('[Harmonic Cloud] sync failed', error);
    setStatus(`Sync failed: ${friendlyError(error)}`);
    return false;
  } finally {
    syncing = false;
    render();
  }
}

async function loadLatestCloudCopy({ force = false } = {}) {
  if (!session || syncing) return false;

  syncing = true;
  cloudState = 'loading';
  render();
  setStatus('Loading the latest synced version…');

  try {
    const remote = await fetchRemote();
    if (!remote?.settings) {
      cloudState = 'empty';
      setStatus('Cloud connected, but no synced version exists for this account yet. Open the laptop version and press Sync once.');
      return false;
    }

    const nextState = remote.settings.state || {};
    const nextLayout = remote.settings.layout || {};
    const nextAssets = remote.settings.assets || {};
    const currentState = readJson(STATE_KEY, {});
    const currentLayout = readJson(LAYOUT_KEY, {});
    const stateChanged = stableStringify(currentState) !== stableStringify(nextState)
      || stableStringify(currentLayout) !== stableStringify(nextLayout);
    const cloudTime = parseTime(remote.updated_at || remote.settings.client_updated_at);
    const remoteHash = simpleHash({ state: nextState, layout: nextLayout, assets: nextAssets });
    const applied = readJson(APPLIED_KEY, {});

    suppressTracking = true;
    try {
      if (force || stateChanged) {
        nativeSet(STATE_KEY, JSON.stringify(nextState));
        nativeSet(LAYOUT_KEY, JSON.stringify(nextLayout));
      }
      lastCloudUpdatedAt = cloudTime;
      const value = meta();
      value.cloudUpdatedAt = cloudTime;
      value.localUpdatedAt = cloudTime;
      writeJson(CLOUD_META_KEY, value);
      localDirty = false;
    } finally {
      suppressTracking = false;
    }

    const mediaResult = await restoreSelectedAssets(nextAssets);
    writeJson(APPLIED_KEY, {
      userId: session.user.id,
      hash: remoteHash,
      updatedAt: cloudTime
    });

    cloudState = mediaResult.failures.length ? 'error' : 'ready';
    notifyCloudApplied({
      stateChanged,
      downloadedMedia: mediaResult.downloaded,
      cloudTime,
      remoteHash
    });

    const needsVisualRefresh = force || stateChanged || mediaResult.downloaded > 0;
    const alreadyReloadedThisSession = sessionStorage.getItem(APPLIED_KEY) === remoteHash;

    if (needsVisualRefresh && !alreadyReloadedThisSession) {
      sessionStorage.setItem(APPLIED_KEY, remoteHash);
      setStatus('Latest cloud version downloaded. Refreshing the app once…');
      setTimeout(() => location.reload(), 350);
      return true;
    }

    if (mediaResult.failures.length) {
      setStatus(`Cloud data loaded, but ${mediaResult.failures.length} media file${mediaResult.failures.length === 1 ? '' : 's'} could not download.`);
    } else if (stateChanged || mediaResult.downloaded > 0 || force) {
      setStatus(`Latest cloud version loaded from ${new Date(cloudTime || Date.now()).toLocaleString()}.`);
    } else if (applied.hash === remoteHash) {
      setStatus(`Cloud is synced. Latest version: ${new Date(cloudTime || Date.now()).toLocaleString()}.`);
    } else {
      setStatus('Latest cloud version loaded.');
    }

    console.info('[Harmonic Cloud] hydration complete', {
      userId: session.user.id,
      cloudTime,
      stateChanged,
      downloadedMedia: mediaResult.downloaded,
      mediaFailures: mediaResult.failures,
      remoteHash
    });
    return true;
  } catch (error) {
    cloudState = 'error';
    console.error('[Harmonic Cloud] load failed', error);
    setStatus(`Cloud load failed: ${friendlyError(error)}`);
    return false;
  } finally {
    syncing = false;
    render();
  }
}

async function pollCloud() {
  if (!session || syncing || document.hidden) return;
  try {
    const remote = await fetchRemote();
    const remoteTime = parseTime(remote?.updated_at || remote?.settings?.client_updated_at);
    if (remote?.settings && remoteTime > lastCloudUpdatedAt + 500) {
      await loadLatestCloudCopy();
    }
  } catch (error) {
    console.warn('[Harmonic Cloud] poll failed', error);
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(pollCloud, POLL_INTERVAL_MS);
}

async function handleSession() {
  if (!session) return;
  if (loadedUserId === session.user.id && cloudState === 'ready') return;
  loadedUserId = session.user.id;
  await loadLatestCloudCopy();
  startPolling();
}

async function connect() {
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    cloudState = 'connecting';
    render();
    const config = await getConfig();

    if (!config.url || !config.anonKey) {
      cloudState = 'error';
      setStatus('Cloud configuration is missing.');
      render();
      return;
    }

    supabase = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'harmonic-city-auth'
      }
    });

    const { data, error } = await supabase.auth.getSession();
    if (error) console.error('[Harmonic Cloud] getSession failed', error);
    session = data?.session || null;

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (session) {
        cloudState = 'connecting';
        render();
        queueMicrotask(() => handleSession());
      } else {
        cloudState = 'disconnected';
        loadedUserId = '';
        lastCloudUpdatedAt = 0;
        clearInterval(pollTimer);
        render();
      }
    });

    render();
    if (session) await handleSession();
  })().finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

function simplifyActions() {
  $('#cloudSendLink')?.remove();
  $('#cloudSignOut')?.remove();
  const syncButton = $('#cloudSyncNow');
  if (syncButton) syncButton.textContent = 'Sync This Device';
  const loadButton = $('#cloudLoadNow');
  if (loadButton) loadButton.textContent = 'Load Latest Cloud Version';
}

function bindUI() {
  const modal = $('#cloudModal');
  const toggle = $('#cloudToggle');
  if (!modal || !toggle) return;

  simplifyActions();

  toggle.onclick = () => {
    modal.removeAttribute('aria-hidden');
    modal.classList.add('open');
    if (cloudMessage) setStatus(cloudMessage);
  };

  $('#cloudClose').onclick = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };

  modal.addEventListener('click', event => {
    if (event.target === modal) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  });

  getConfig().then(config => {
    if ($('#cloudUrl')) $('#cloudUrl').value = config.url || '';
    if ($('#cloudAnonKey')) $('#cloudAnonKey').value = config.anonKey || '';
  });

  const saveButton = $('#cloudSaveConfig');
  if (saveButton) {
    saveButton.onclick = async () => {
      writeJson(CONFIG_KEY, {
        url: $('#cloudUrl')?.value.trim() || '',
        anonKey: $('#cloudAnonKey')?.value.trim() || ''
      });
      setStatus('Connection saved.');
      loadedUserId = '';
      await connect();
    };
  }

  const syncButton = $('#cloudSyncNow');
  if (syncButton) {
    syncButton.onclick = async () => {
      if (!session) {
        setStatus('Sign in first.');
        return;
      }
      const ok = confirm('Make this device the cloud version? This replaces the current cloud copy for your other devices.');
      if (ok) await uploadCurrentDevice();
    };
  }

  const loadButton = $('#cloudLoadNow');
  if (loadButton) {
    loadButton.onclick = async () => {
      if (!session) {
        setStatus('Sign in first.');
        return;
      }
      await loadLatestCloudCopy({ force: true });
    };
  }
}

localStorage.setItem = (key, value) => {
  nativeSet(key, value);
  if (key === STATE_KEY || key === LAYOUT_KEY) markLocalChange();
};

localStorage.removeItem = key => {
  nativeRemove(key);
  if (key === STATE_KEY || key === LAYOUT_KEY) markLocalChange();
};

window.HarmonicCloud = {
  loadLatest: () => loadLatestCloudCopy({ force: true }),
  syncThisDevice: uploadCurrentDevice,
  getStatus: () => ({
    state: cloudState,
    message: cloudMessage,
    userId: session?.user?.id || null,
    lastCloudUpdatedAt
  })
};

addEventListener('DOMContentLoaded', async () => {
  ensureDeviceId();
  bindUI();
  await connect();
  addEventListener('focus', pollCloud);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollCloud();
  });
});
