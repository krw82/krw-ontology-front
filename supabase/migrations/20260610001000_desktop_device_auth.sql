-- Desktop device authentication for KRW Desktop.
-- Tokens are opaque client secrets; only SHA-256 hashes are stored.

create table if not exists public.desktop_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null,
  platform text,
  arch text,
  app_version text,
  protocol_version text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_desktop_devices_user_status
  on public.desktop_devices (user_id, status, updated_at desc);

create table if not exists public.desktop_device_login_codes (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique,
  user_code_hash text not null unique,
  user_code_display text not null,
  device_name text not null,
  platform text,
  arch text,
  app_version text,
  protocol_version text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'expired', 'complete')),
  user_id uuid references auth.users(id) on delete cascade,
  device_id uuid references public.desktop_devices(id) on delete set null,
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_desktop_device_login_codes_status_expires
  on public.desktop_device_login_codes (status, expires_at);

create table if not exists public.desktop_access_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.desktop_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_desktop_access_tokens_device_status
  on public.desktop_access_tokens (device_id, status, expires_at);

create table if not exists public.desktop_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.desktop_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'rotated', 'expired')),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_desktop_refresh_tokens_device_status
  on public.desktop_refresh_tokens (device_id, status, expires_at);

alter table public.desktop_devices enable row level security;
alter table public.desktop_device_login_codes enable row level security;
alter table public.desktop_access_tokens enable row level security;
alter table public.desktop_refresh_tokens enable row level security;

revoke all on table public.desktop_devices from anon, authenticated;
revoke all on table public.desktop_device_login_codes from anon, authenticated;
revoke all on table public.desktop_access_tokens from anon, authenticated;
revoke all on table public.desktop_refresh_tokens from anon, authenticated;

grant select, insert, update, delete on table public.desktop_devices to service_role;
grant select, insert, update, delete on table public.desktop_device_login_codes to service_role;
grant select, insert, update, delete on table public.desktop_access_tokens to service_role;
grant select, insert, update, delete on table public.desktop_refresh_tokens to service_role;
