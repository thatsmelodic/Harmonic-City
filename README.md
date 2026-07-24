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

The current browser version uses localStorage so it works before Supabase authentication is connected. The next integration step is replacing local media data URLs with Supabase Storage uploads and syncing `portal_settings` after each change.

## Deployment

This static build can be deployed through GitHub Pages, Netlify, or Vercel. For Vercel or Netlify, set the Supabase environment variables in the hosting dashboard once cloud sync is connected.
