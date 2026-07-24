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
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  portal_key text not null default 'harmonic-city',
  kind text not null check (kind in ('background','intro','audio','icon')),
  name text not null,
  storage_path text not null,
  mime_type text,
  created_at timestamptz not null default now()
);

alter table public.portal_settings enable row level security;
alter table public.portal_media enable row level security;

create policy "owners manage portal settings"
on public.portal_settings for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "owners manage portal media"
on public.portal_media for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

insert into storage.buckets (id, name, public)
values ('harmonic-city-media', 'harmonic-city-media', true)
on conflict (id) do nothing;

create policy "public can view harmonic city media"
on storage.objects for select
using (bucket_id = 'harmonic-city-media');

create policy "authenticated users upload harmonic city media"
on storage.objects for insert to authenticated
with check (bucket_id = 'harmonic-city-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owners update harmonic city media"
on storage.objects for update to authenticated
using (bucket_id = 'harmonic-city-media' and owner_id = auth.uid());

create policy "owners delete harmonic city media"
on storage.objects for delete to authenticated
using (bucket_id = 'harmonic-city-media' and owner_id = auth.uid());
