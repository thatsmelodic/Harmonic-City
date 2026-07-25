(() => {
  const STATE_KEY = 'harmonic-city-state-v2';
  const LAYOUT_KEY = 'harmonic-city-studio-layout-v1';
  const DB_NAME = 'harmonic-city-durable-backup';
  const STORE = 'records';
  const RELOAD_FLAG = 'harmonic-city-restored-once';
  const trackedKeys = new Set([STATE_KEY, LAYOUT_KEY]);

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function putRecord(key, value) {
    if (!trackedKeys.has(key)) return;
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, value, updatedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getRecord(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function isUsableJson(value) {
    if (!value) return false;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
    } catch {
      return false;
    }
  }

  async function restoreMissingLocalData() {
    let restored = false;
    for (const key of trackedKeys) {
      const local = localStorage.getItem(key);
      if (isUsableJson(local)) continue;
      const backup = await getRecord(key);
      if (backup?.value && isUsableJson(backup.value)) {
        localStorage.setItem(key, backup.value);
        restored = true;
      }
    }
    if (restored && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      location.reload();
    }
  }

  const nativeSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    nativeSetItem(key, value);
    if (trackedKeys.has(key)) putRecord(key, value).catch(console.error);
  };

  async function persistCurrent() {
    for (const key of trackedKeys) {
      const value = localStorage.getItem(key);
      if (isUsableJson(value)) await putRecord(key, value);
    }
  }

  async function requestDurableStorage() {
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch (error) {
      console.warn('Persistent browser storage request failed', error);
    }
  }

  window.harmonicPersistence = {
    persistNow: persistCurrent,
    async storageStatus() {
      const estimate = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      return { persisted: Boolean(persisted), usage: estimate?.usage || 0, quota: estimate?.quota || 0 };
    }
  };

  restoreMissingLocalData().catch(console.error);
  requestDurableStorage();
  setInterval(() => persistCurrent().catch(console.error), 1500);
  addEventListener('pagehide', () => persistCurrent().catch(console.error));
  addEventListener('beforeunload', () => persistCurrent().catch(console.error));
})();
