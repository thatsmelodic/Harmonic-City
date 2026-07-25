module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!url || !anonKey) {
    return res.status(503).json({
      ok: false,
      error: 'Supabase environment variables are not configured.'
    });
  }

  return res.status(200).json({ ok: true, url, anonKey });
};
