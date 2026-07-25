-- Run once in Supabase SQL Editor for the Harmonic City project.
-- Creates a private bucket and restricts every file to its authenticated owner folder.

insert into storage.buckets (id, name, public, file_size_limit)
values ('harmonic-city-media', 'harmonic-city-media', false, 104857600)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

alter table storage.objects enable row level security;

drop policy if exists "harmonic city media select own" on storage.objects;
create policy "harmonic city media select own"
on storage.objects for select
using (
  bucket_id = 'harmonic-city-media'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "harmonic city media insert own" on storage.objects;
create policy "harmonic city media insert own"
on storage.objects for insert
with check (
  bucket_id = 'harmonic-city-media'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "harmonic city media update own" on storage.objects;
create policy "harmonic city media update own"
on storage.objects for update
using (
  bucket_id = 'harmonic-city-media'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'harmonic-city-media'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "harmonic city media delete own" on storage.objects;
create policy "harmonic city media delete own"
on storage.objects for delete
using (
  bucket_id = 'harmonic-city-media'
  and auth.uid()::text = (storage.foldername(name))[1]
);
