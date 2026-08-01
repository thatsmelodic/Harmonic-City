// Serves the owner's *current* portal content (state/layout/assets) to anonymous
// visitors, so the public site stays in sync automatically whenever the owner syncs
// a change via Creator Studio -- no manual re-deploy or code change required.
//
// portal_settings has row-level security restricting writes to their own owner_id
// (see supabase/schema.sql) -- but that only stops people from writing *someone
// else's* row, not from signing up as a brand-new user and writing their own row
// with the same portal_key. Anyone who knows the public Supabase URL/anon key
// (both meant to be public -- see api/config.js) can do that with nothing more
// than the standard Supabase Auth signup flow. Without the owner_id pin below,
// this endpoint would previously serve whichever portal_settings row for this
// portal_key was updated most recently, regardless of who wrote it -- i.e. a
// stranger's freshly-signed-up account could overwrite the live public site.
// OWNER_ID pins this to the one real owner's row; every other row is ignored.
//
// This endpoint runs server-side only, uses SUPABASE_SERVICE_ROLE_KEY to bypass
// RLS (required to read a row that isn't the caller's own), and re-exposes
// nothing except the same non-secret settings JSON that already determines page
// layout/content, scoped to the pinned owner. The service role key itself never
// leaves this function -- it is never included in the response body, logs, or
// error messages.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const url = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const portalKey = process.env.PORTAL_KEY || 'harmonic-city';
  const ownerId = process.env.OWNER_ID || '';

  if (!url || !serviceRoleKey || !ownerId) {
    // Not fully configured yet -- not an error. The client falls back to its
    // baked-in static defaults until these env vars are added in Vercel.
    // OWNER_ID is required, not optional: without it there is no safe way to
    // pick which row belongs to the real owner, so this fails closed rather
    // than falling back to the old "most recently updated, any owner" query.
    return res.status(200).json({ ok: true, configured: false, settings: null });
  }

  try {
    const endpoint = `${url.replace(/\/$/, '')}/rest/v1/portal_settings` +
      `?portal_key=eq.${encodeURIComponent(portalKey)}` +
      `&owner_id=eq.${encodeURIComponent(ownerId)}` +
      `&select=settings,updated_at&order=updated_at.desc&limit=1`;

    const response = await fetch(endpoint, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    });

    if (!response.ok) {
      return res.status(200).json({ ok: true, configured: true, settings: null });
    }

    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row?.settings) {
      return res.status(200).json({ ok: true, configured: true, settings: null });
    }

    const settings = { ...row.settings };
    if (settings.assets && typeof settings.assets === 'object') {
      const base = url.replace(/\/$/, '');
      settings.assets = Object.fromEntries(
        Object.entries(settings.assets).map(([kind, asset]) => {
          if (!asset?.bucket || !asset?.path) return [kind, asset];
          const encodedPath = asset.path.split('/').map(encodeURIComponent).join('/');
          return [kind, { ...asset, publicUrl: `${base}/storage/v1/object/public/${encodeURIComponent(asset.bucket)}/${encodedPath}` }];
        })
      );
    }

    return res.status(200).json({
      ok: true,
      configured: true,
      settings,
      updatedAt: row.updated_at
    });
  } catch {
    // Network/DB error -- degrade to "no live data" rather than leaking details.
    return res.status(200).json({ ok: true, configured: true, settings: null });
  }
};
