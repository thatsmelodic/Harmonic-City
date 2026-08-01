// The SDK is loaded from ./vendor/supabase-js.umd.js (a plain <script> tag in
// index.html, before this module runs) instead of a third-party CDN import,
// so cloud sync no longer depends on an external module host being reachable.
function getCreateClient() {
  if (typeof window !== 'undefined' && window.supabase?.createClient) {
    return window.supabase.createClient;
  }
  throw new Error('Supabase SDK failed to load.');
}

const CONFIG_KEY = 'harmonic-city-supabase-config-v1';
const AUTH_KEY = 'harmonic-city-auth';
let clientPromise;

function readSavedConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
  } catch {
    return {};
  }
}

export async function getRuntimeConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (data?.ok && data.url && data.anonKey) {
        return { url: data.url, anonKey: data.anonKey, ownerId: data.ownerId || null, source: 'runtime' };
      }
    }
  } catch (error) {
    console.warn('[Harmonic Cloud] Runtime config unavailable.', error);
  }

  const saved = readSavedConfig();
  if (saved.url && saved.anonKey) return { ...saved, source: 'local-debug' };
  throw new Error('Harmonic Cloud is not configured.');
}

export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = getRuntimeConfig().then(config => ({
      client: getCreateClient()(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
          storageKey: AUTH_KEY
        }
      }),
      config
    }));
  }
  return clientPromise;
}

export function resetSupabaseClient() {
  clientPromise = undefined;
}
