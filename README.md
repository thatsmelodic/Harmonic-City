# Harmonic City

Harmonic City is the public portal connecting **thatsmelodic**, **Schmakinn**, and **2Harmonic**.

## Current build

- Floating/orbiting world icons
- Same-page brand portfolios
- Editable titles, descriptions, typography, colors, icon scale, and orbit speed
- Collection theme packs: Lifted Beige, Royal Desert, Midnight Melody, Schmakinn Neon, Fried Em Gym, and Rose Gold
- Drag-and-drop background uploads for photos, GIFs, MP4, and WebM
- Separate intro-screen media uploader
- Audio uploader with play/pause and volume control
- Automatic browser saving
- Upload history for backgrounds, intro media, and audio
- Existing social links included
- Supabase schema ready for cross-device cloud persistence

## Preview locally

Serve the repository with a local web server. Opening `index.html` directly may restrict some browser features.

```bash
npx serve .
```

Then open the local URL shown in the terminal.

## Supabase setup

1. Open the SQL Editor in project `xsslskkhxyavwvuxyelf`.
2. Run `supabase/schema.sql`.
3. Copy `.env.example` to `.env`.
4. Add the project’s **public anon key**. Never expose the service-role key.

The browser also keeps a localStorage copy of the current state so the site still works offline/without Supabase. Signed-in owners can sync that local state to `portal_settings` for cross-device editing (see `cloud-sync-v2.js`).

## Public defaults & live sync

Anonymous visitors never authenticate, so `portal_settings` (which is owner-only via RLS) is invisible to them, and `app.js` never queries it directly. Instead:

- `app.js`'s `defaults` object and `defaultMedia` map are a **baked-in snapshot** of the real branding (colors, hero/world copy, background/intro/core/audio media, world icons in `defaults/icons/`). This is what every visitor sees if nothing else is available — it always works, with zero network dependency.
- `api/public-portal.js` is an optional serverless endpoint that reads the *current* `portal_settings` row server-side using `SUPABASE_SERVICE_ROLE_KEY` (bypassing RLS deliberately and safely, since it only re-exposes the same non-secret settings JSON) and returns it to any visitor. `app.js` fetches this on boot and, if the device has no real local edits of its own, applies it — so a change synced from Creator Studio shows up for every visitor automatically, without a redeploy.
- If `SUPABASE_SERVICE_ROLE_KEY` isn't set, or the fetch fails, the site silently falls back to the baked-in snapshot. Nothing breaks either way.

**To refresh the baked-in snapshot** (e.g. after a significant redesign, as a new fallback floor): export the current state via Creator Studio, update `defaults`/`defaultMedia` in `app.js` and the icons in `defaults/icons/`, and re-run `node scripts/diagnostic.mjs`.

**To enable live sync**: add `SUPABASE_SERVICE_ROLE_KEY` in the Vercel project's environment variables (Project Settings → API → `service_role` key in Supabase). Treat it like a root password — it is never sent to the browser, only read inside `api/public-portal.js`.

## Deployment

This static build can be deployed through GitHub Pages, Netlify, or Vercel. For Vercel or Netlify, set the Supabase environment variables in the hosting dashboard once cloud sync is connected.
