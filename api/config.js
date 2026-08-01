module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  // Not a secret -- it's a user id, already publicly visible in every synced
  // media URL. Exposed here so the client can decide whether the current
  // visitor's Supabase session belongs to the owner, and only then reveal the
  // Edit/Connect Cloud controls (see owner-gate.js).
  const ownerId = process.env.OWNER_ID || '';

  if (!url || !anonKey) {
    return res.status(503).json({
      ok: false,
      error: 'Supabase environment variables are not configured.'
    });
  }

  return res.status(200).json({ ok: true, url, anonKey, ownerId: ownerId || null });
};
