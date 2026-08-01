-- Optional, defense-in-depth. Run manually in the Supabase SQL Editor after
-- schema.sql -- not applied automatically by anything in this repo.
--
-- schema.sql's RLS policies allow any authenticated user to write rows they
-- own (owner_id = auth.uid()). That's correct in general, but it means
-- anyone who signs up for a Supabase account against this project's public
-- anon key can still insert their own portal_settings/portal_media/
-- portal_versions row. api/public-portal.js (pinned to OWNER_ID) already
-- makes those rows harmless -- they're never served to the public -- but
-- they can still be created and sit in the table.
--
-- This tightens the policies so ONLY the real owner's uid can write at all,
-- for any portal_key. Replace the placeholder below with the owner's actual
-- Supabase auth user id (Authentication -> Users in the dashboard) before
-- running this -- it must match the OWNER_ID used in api/public-portal.js
-- and owner-gate.js, or the real owner will be locked out too.

-- Replace 'b7387b68-4169-4c9b-a4cc-64d576cdeca8' in all three policies below
-- with the confirmed owner uid if it differs from this candidate value.

drop policy if exists "owners manage portal settings" on public.portal_settings;
create policy "owners manage portal settings" on public.portal_settings
  for all to authenticated
  using ((select auth.uid()) = owner_id and owner_id = 'b7387b68-4169-4c9b-a4cc-64d576cdeca8'::uuid)
  with check ((select auth.uid()) = owner_id and owner_id = 'b7387b68-4169-4c9b-a4cc-64d576cdeca8'::uuid);

drop policy if exists "owners manage portal media" on public.portal_media;
create policy "owners manage portal media" on public.portal_media
  for all to authenticated
  using ((select auth.uid()) = owner_id and owner_id = 'b7387b68-4169-4c9b-a4cc-64d576cdeca8'::uuid)
  with check ((select auth.uid()) = owner_id and owner_id = 'b7387b68-4169-4c9b-a4cc-64d576cdeca8'::uuid);

drop policy if exists "owners manage portal versions" on public.portal_versions;
create policy "owners manage portal versions" on public.portal_versions
  for all to authenticated
  using ((select auth.uid()) = owner_id and owner_id = 'b7387b68-4169-4c9b-a4cc-64d576cdeca8'::uuid)
  with check ((select auth.uid()) = owner_id and owner_id = 'b7387b68-4169-4c9b-a4cc-64d576cdeca8'::uuid);
