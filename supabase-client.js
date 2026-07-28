import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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
        return { url: data.url, anonKey: data.anonKey, source: 'runtime' };
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
      client: createClient(config.url, config.anonKey, {
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
