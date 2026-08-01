// Creator Studio, Customize, and Connect Cloud all start hidden (see the
// `hidden` attribute on their buttons in index.html) -- editing content/layout
// used to be one click away for any visitor, with nothing checking who was
// asking. This script is the only thing that reveals them again, and only for
// the real owner.
//
// Bootstrapping problem: on a brand-new device the owner has never signed in
// on before, there's no session yet to check -- so there's nothing to compare
// against ownerId. Visiting with ?owner=1 once reveals the controls so the
// owner can sign in via Connect Cloud; after that, the session persists
// (see cloud-sync-v2.js/getSupabaseClient) and every future visit on that
// device is recognized automatically without the query param.
//
// ?owner=1 is not a security boundary -- it's discoverable in this file's
// source, same as the buttons themselves used to be unconditionally visible.
// The actual boundary is unchanged: writes still require real Supabase
// credentials, and only the pinned OWNER_ID's data is ever served publicly
// (see api/public-portal.js). Anyone can still reveal these buttons; nobody
// but the owner can make an edit that goes live.
(() => {
  const controls = ['studioToggle', 'cloudToggle', 'openCustomizer']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (!controls.length) return;

  function reveal() {
    controls.forEach(el => el.removeAttribute('hidden'));
  }

  if (new URLSearchParams(location.search).has('owner')) {
    reveal();
    return;
  }

  import('./supabase-client.js').then(async ({ getSupabaseClient }) => {
    try {
      const { client, config } = await getSupabaseClient();
      if (!config.ownerId) return; // not configured -- stay hidden
      const check = session => { if (session?.user?.id === config.ownerId) reveal(); };
      const { data } = await client.auth.getSession();
      check(data?.session);
      client.auth.onAuthStateChange((_event, session) => check(session));
    } catch {
      // Supabase unreachable/misconfigured -- stay hidden rather than fail open.
    }
  });
})();
