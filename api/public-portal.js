// Serves the owner's *current* portal content (state/layout/assets) to anonymous
// visitors, so the public site stays in sync automatically whenever the owner syncs
// a change via Creator Studio -- no manual re-deploy or code change required.
//
// portal_settings has row-level security restricting reads to the authenticated
// owner (see supabase/schema.sql), which is correct for the private cross-device
// sync path in cloud-sync-v2.js. This endpoint is a separate, deliberate exception:
// it runs server-side only, uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS, and
// re-exposes nothing except the same non-secret settings JSON that already
// determines page layout/content. The service role key itself never leaves this
// function -- it is never included in the response body, logs, or error messages.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const url = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const portalKey = process.env.PORTAL_KEY || 'harmonic-city';

  if (!url || !serviceRoleKey) {
    // Not configured yet -- not an error. The client falls back to its baked-in
    // static defaults until this env var is added in Vercel.
    return res.status(200).json({ ok: true, configured: false, settings: null });
  }

  try {
    const endpoint = `${url.replace(/\/$/, '')}/rest/v1/portal_settings` +
      `?portal_key=eq.${encodeURIComponent(portalKey)}` +
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
