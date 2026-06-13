-- Local development seed.
-- Keep this file present because supabase/config.toml enables db.seed for local resets.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'dev@krw-ontology.local',
  null,
  '2026-01-01T00:00:00.000Z',
  '{"provider":"dev-auth-bypass","providers":["dev-auth-bypass"]}'::jsonb,
  '{"name":"Dev User","full_name":"Dev User"}'::jsonb,
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
)
on conflict (id) do update set
  email = excluded.email,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = excluded.updated_at;
