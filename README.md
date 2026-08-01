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
5. Look up the owner's Supabase auth user id (Authentication → Users) and set `OWNER_ID`. This is required for both live public sync and for the Edit/Customize/Connect Cloud controls to appear for the owner — see `.env.example` for why.
6. Optional, defense-in-depth: run `supabase/harden-owner-only-writes.sql` in the SQL Editor to stop anyone but the owner's uid from writing to `portal_settings`/`portal_media`/`portal_versions` at all (not just making other rows harmless, as `OWNER_ID` alone already does).

The browser also keeps a localStorage copy of the current state so the site still works offline/without Supabase. Signed-in owners can sync that local state to `portal_settings` for cross-device editing (see `cloud-sync-v2.js`).

## Editing is owner-only

The Edit (Creator Studio), Customize, and Connect Cloud buttons are hidden by default for every visitor (`hidden` attribute in `index.html`). `owner-gate.js` reveals them only once the current browser's Supabase session matches `OWNER_ID`. On a device that has never signed in before, visit the site once with `?owner=1` to reveal Connect Cloud and sign in — the session then persists (via Supabase's `persistSession`) and the controls appear automatically on every later visit from that device, no query param needed again.

`?owner=1` is a convenience, not a security boundary — it's visible in `owner-gate.js`'s source, same as the buttons used to be unconditionally visible before this change. The actual boundary is: writes still require real Supabase credentials, and (see below) only `OWNER_ID`'s data is ever served to the public. Someone finding `?owner=1` can see the buttons and edit their own local browser view, same as before this change, but they can't make an edit that goes live.

## Public defaults & live sync

Anonymous visitors never authenticate, so `portal_settings` (which is owner-only via RLS) is invisible to them, and `app.js` never queries it directly. Instead:

- `app.js`'s `defaults` object and `defaultMedia` map are a **baked-in snapshot** of the real branding (colors, hero/world copy, background/intro/core/audio media, world icons in `defaults/icons/`). This is what every visitor sees if nothing else is available — it always works, with zero network dependency.
- `api/public-portal.js` is an optional serverless endpoint that reads the *current* `portal_settings` row server-side using `SUPABASE_SERVICE_ROLE_KEY` (bypassing RLS deliberately and safely, since it only re-exposes the same non-secret settings JSON) and returns it to any visitor. `app.js` fetches this on boot and, if the device has no real local edits of its own, applies it — so a change synced from Creator Studio shows up for every visitor automatically, without a redeploy.
- The query is pinned to `OWNER_ID`: it's not "whichever `portal_settings` row for this portal was updated most recently," it's specifically the owner's row. RLS on `portal_settings` only stops someone from writing *someone else's* row — it doesn't stop a stranger from signing up for their own new Supabase account and writing their *own* row with the same `portal_key`. Without the `OWNER_ID` pin, that row could otherwise briefly become the most-recently-updated one and get served to every visitor.
- If `SUPABASE_SERVICE_ROLE_KEY` or `OWNER_ID` isn't set, or the fetch fails, the site silently falls back to the baked-in snapshot. Nothing breaks either way.

**To refresh the baked-in snapshot** (e.g. after a significant redesign, as a new fallback floor): export the current state via Creator Studio, update `defaults`/`defaultMedia` in `app.js` and the icons in `defaults/icons/`, and re-run `node scripts/diagnostic.mjs`.

**To enable live sync**: add `SUPABASE_SERVICE_ROLE_KEY` in the Vercel project's environment variables (Project Settings → API → `service_role` key in Supabase). Treat it like a root password — it is never sent to the browser, only read inside `api/public-portal.js`.

## Deployment

This static build can be deployed through GitHub Pages, Netlify, or Vercel. For Vercel or Netlify, set the Supabase environment variables in the hosting dashboard once cloud sync is connected.
