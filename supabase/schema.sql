create extension if not exists pgcrypto;

create table if not exists public.portal_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  portal_key text not null default 'harmonic-city',
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(owner_id, portal_key)
);

create table if not exists public.portal_media (
  id uuid primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  portal_key text not null default 'harmonic-city',
  kind text not null,
  name text not null,
  storage_path text not null,
  mime_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.portal_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  portal_key text not null default 'harmonic-city',
  label text not null default 'Automatic backup',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.portal_settings enable row level security;
alter table public.portal_media enable row level security;
alter table public.portal_versions enable row level security;

drop policy if exists "owners manage portal settings" on public.portal_settings;
create policy "owners manage portal settings" on public.portal_settings for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "owners manage portal media" on public.portal_media;
create policy "owners manage portal media" on public.portal_media for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "owners manage portal versions" on public.portal_versions;
create policy "owners manage portal versions" on public.portal_versions for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public)
values ('harmonic-city-media', 'harmonic-city-media', true)
on conflict (id) do update set public = true;

drop policy if exists "public can view harmonic city media" on storage.objects;
create policy "public can view harmonic city media" on storage.objects for select using (bucket_id = 'harmonic-city-media');

drop policy if exists "authenticated users upload harmonic city media" on storage.objects;
create policy "authenticated users upload harmonic city media" on storage.objects for insert to authenticated with check (bucket_id = 'harmonic-city-media' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));

drop policy if exists "owners update harmonic city media" on storage.objects;
create policy "owners update harmonic city media" on storage.objects for update to authenticated using (bucket_id = 'harmonic-city-media' and owner_id = (select auth.uid()::text)) with check (bucket_id = 'harmonic-city-media' and owner_id = (select auth.uid()::text));

drop policy if exists "owners delete harmonic city media" on storage.objects;
create policy "owners delete harmonic city media" on storage.objects for delete to authenticated using (bucket_id = 'harmonic-city-media' and owner_id = (select auth.uid()::text));
