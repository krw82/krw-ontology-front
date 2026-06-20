-- Desktop LLM gateway jobs.
--
-- KRW Desktop never receives a raw provider API key. The web control plane
-- mints a short-lived run-scoped job token and the dedicated gateway verifies
-- both the signed token and this durable job row before forwarding to DeepSeek.

alter table public.desktop_devices
  add column if not exists installation_id text;

alter table public.desktop_device_login_codes
  add column if not exists installation_id text;

alter table public.desktop_devices
  drop constraint if exists desktop_devices_user_installation_key;

alter table public.desktop_devices
  add constraint desktop_devices_user_installation_key
  unique (user_id, installation_id);

create table if not exists public.desktop_authorization_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  redirect_uri text not null,
  state text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256'
    check (code_challenge_method = 'S256'),
  installation_id text not null,
  device_name text not null,
  platform text,
  arch text,
  app_version text,
  protocol_version text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'consumed', 'expired')),
  user_id uuid references auth.users(id) on delete cascade,
  device_id uuid references public.desktop_devices(id) on delete set null,
  authorization_code_hash text unique,
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_desktop_authorization_requests_status_expires
  on public.desktop_authorization_requests (status, expires_at);

create index if not exists idx_desktop_authorization_requests_user_created
  on public.desktop_authorization_requests (user_id, created_at desc);

alter table public.desktop_authorization_requests enable row level security;
revoke all on table public.desktop_authorization_requests from public;
revoke all on table public.desktop_authorization_requests from anon;
revoke all on table public.desktop_authorization_requests from authenticated;
grant select, insert, update, delete
  on table public.desktop_authorization_requests
  to service_role;

create or replace function public.complete_desktop_device_login(
  p_device_code_hash text,
  p_new_access_token_hash text,
  p_new_access_expires_at timestamptz,
  p_new_refresh_token_hash text,
  p_new_refresh_expires_at timestamptz,
  p_now timestamptz default now()
)
returns table (
  completed boolean,
  user_id uuid,
  device_id uuid,
  device_name text,
  device_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code public.desktop_device_login_codes%rowtype;
  v_device public.desktop_devices%rowtype;
begin
  select *
    into v_code
    from public.desktop_device_login_codes as login_code
   where login_code.device_code_hash = p_device_code_hash
     and login_code.status = 'approved'
     and login_code.user_id is not null
     and login_code.consumed_at is null
     and login_code.expires_at > p_now
   for update;

  if not found then
    return query
      select false, null::uuid, null::uuid, null::text, null::text;
    return;
  end if;

  insert into public.desktop_devices (
    user_id,
    device_name,
    installation_id,
    platform,
    arch,
    app_version,
    protocol_version,
    status,
    last_seen_at,
    revoked_at,
    updated_at
  )
  values (
    v_code.user_id,
    v_code.device_name,
    v_code.installation_id,
    v_code.platform,
    v_code.arch,
    v_code.app_version,
    v_code.protocol_version,
    'active',
    p_now,
    null,
    p_now
  )
  on conflict on constraint desktop_devices_user_installation_key
  do update set
    device_name = excluded.device_name,
    platform = excluded.platform,
    arch = excluded.arch,
    app_version = excluded.app_version,
    protocol_version = excluded.protocol_version,
    status = 'active',
    last_seen_at = excluded.last_seen_at,
    revoked_at = null,
    updated_at = excluded.updated_at
  returning *
    into v_device;

  insert into public.desktop_access_tokens (
    device_id,
    user_id,
    token_hash,
    expires_at
  )
  values (
    v_device.id,
    v_code.user_id,
    p_new_access_token_hash,
    p_new_access_expires_at
  );

  insert into public.desktop_refresh_tokens (
    device_id,
    user_id,
    token_hash,
    expires_at
  )
  values (
    v_device.id,
    v_code.user_id,
    p_new_refresh_token_hash,
    p_new_refresh_expires_at
  );

  update public.desktop_device_login_codes
     set status = 'complete',
         device_id = v_device.id,
         consumed_at = p_now,
         updated_at = p_now
   where id = v_code.id;

  return query
    select true, v_code.user_id, v_device.id, v_device.device_name, v_device.status;
end;
$$;

revoke all on function public.complete_desktop_device_login(
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.complete_desktop_device_login(
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) to service_role;

create or replace function public.exchange_desktop_authorization_code(
  p_authorization_code_hash text,
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text,
  p_new_access_token_hash text,
  p_new_access_expires_at timestamptz,
  p_new_refresh_token_hash text,
  p_new_refresh_expires_at timestamptz,
  p_now timestamptz default now()
)
returns table (
  exchanged boolean,
  user_id uuid,
  device_id uuid,
  device_name text,
  device_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.desktop_authorization_requests%rowtype;
  v_device public.desktop_devices%rowtype;
begin
  select *
    into v_request
    from public.desktop_authorization_requests as authorization_request
   where authorization_request.authorization_code_hash =
           p_authorization_code_hash
     and authorization_request.client_id = p_client_id
     and authorization_request.redirect_uri = p_redirect_uri
     and authorization_request.code_challenge = p_code_challenge
     and authorization_request.code_challenge_method = 'S256'
     and authorization_request.status = 'approved'
     and authorization_request.user_id is not null
     and authorization_request.consumed_at is null
     and authorization_request.expires_at > p_now
   for update;

  if not found then
    return query
      select false, null::uuid, null::uuid, null::text, null::text;
    return;
  end if;

  insert into public.desktop_devices (
    user_id,
    device_name,
    installation_id,
    platform,
    arch,
    app_version,
    protocol_version,
    status,
    last_seen_at,
    revoked_at,
    updated_at
  )
  values (
    v_request.user_id,
    v_request.device_name,
    v_request.installation_id,
    v_request.platform,
    v_request.arch,
    v_request.app_version,
    v_request.protocol_version,
    'active',
    p_now,
    null,
    p_now
  )
  on conflict on constraint desktop_devices_user_installation_key
  do update set
    device_name = excluded.device_name,
    platform = excluded.platform,
    arch = excluded.arch,
    app_version = excluded.app_version,
    protocol_version = excluded.protocol_version,
    status = 'active',
    last_seen_at = excluded.last_seen_at,
    revoked_at = null,
    updated_at = excluded.updated_at
  returning *
    into v_device;

  insert into public.desktop_access_tokens (
    device_id,
    user_id,
    token_hash,
    expires_at
  )
  values (
    v_device.id,
    v_request.user_id,
    p_new_access_token_hash,
    p_new_access_expires_at
  );

  insert into public.desktop_refresh_tokens (
    device_id,
    user_id,
    token_hash,
    expires_at
  )
  values (
    v_device.id,
    v_request.user_id,
    p_new_refresh_token_hash,
    p_new_refresh_expires_at
  );

  update public.desktop_authorization_requests
     set status = 'consumed',
         device_id = v_device.id,
         consumed_at = p_now,
         updated_at = p_now
   where id = v_request.id;

  return query
    select true, v_request.user_id, v_device.id, v_device.device_name, v_device.status;
end;
$$;

revoke all on function public.exchange_desktop_authorization_code(
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.exchange_desktop_authorization_code(
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) to service_role;

create or replace function public.rotate_desktop_refresh_token(
  p_device_id uuid,
  p_current_token_hash text,
  p_new_access_token_hash text,
  p_new_access_expires_at timestamptz,
  p_new_refresh_token_hash text,
  p_new_refresh_expires_at timestamptz,
  p_now timestamptz default now()
)
returns table (
  rotated boolean,
  user_id uuid,
  device_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_refresh public.desktop_refresh_tokens%rowtype;
  v_device public.desktop_devices%rowtype;
begin
  select *
    into v_refresh
    from public.desktop_refresh_tokens as refresh_token
   where refresh_token.token_hash = p_current_token_hash
     and refresh_token.device_id = p_device_id
     and refresh_token.status = 'active'
     and refresh_token.rotated_at is null
     and refresh_token.expires_at > p_now
   for update;

  if not found then
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  select *
    into v_device
    from public.desktop_devices as desktop_device
   where desktop_device.id = v_refresh.device_id
     and desktop_device.user_id = v_refresh.user_id
     and desktop_device.status = 'active'
   for update;

  if not found then
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  update public.desktop_refresh_tokens
     set status = 'rotated',
         last_used_at = p_now,
         rotated_at = p_now
   where id = v_refresh.id;

  insert into public.desktop_access_tokens (
    device_id,
    user_id,
    token_hash,
    expires_at
  )
  values (
    v_refresh.device_id,
    v_refresh.user_id,
    p_new_access_token_hash,
    p_new_access_expires_at
  );

  insert into public.desktop_refresh_tokens (
    device_id,
    user_id,
    token_hash,
    expires_at
  )
  values (
    v_refresh.device_id,
    v_refresh.user_id,
    p_new_refresh_token_hash,
    p_new_refresh_expires_at
  );

  return query
    select true, v_refresh.user_id, v_refresh.device_id;
end;
$$;

revoke all on function public.rotate_desktop_refresh_token(
  uuid,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.rotate_desktop_refresh_token(
  uuid,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) to service_role;

create table if not exists public.desktop_llm_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.desktop_devices(id) on delete set null,
  local_session_id text,
  local_run_id text not null,
  runtime text not null default 'claude-sdk'
    check (runtime in ('claude-sdk')),
  token_jti text not null unique,
  token_hash text not null unique,
  status text not null default 'active'
    check (status in ('active', 'completed', 'failed', 'expired', 'revoked')),
  provider text not null default 'deepseek'
    check (provider in ('deepseek')),
  model_profile text not null,
  sdk_model text not null,
  upstream_model text not null,
  gateway_base_url text not null,
  max_budget_usd numeric(12, 6) check (max_budget_usd is null or max_budget_usd >= 0),
  max_request_count integer not null default 128 check (max_request_count > 0),
  request_count integer not null default 0 check (request_count >= 0),
  max_input_tokens integer check (max_input_tokens is null or max_input_tokens > 0),
  max_output_tokens integer check (max_output_tokens is null or max_output_tokens > 0),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  finalized_at timestamptz,
  usage_input_tokens integer not null default 0 check (usage_input_tokens >= 0),
  usage_output_tokens integer not null default 0 check (usage_output_tokens >= 0),
  usage_cache_read_input_tokens integer not null default 0 check (usage_cache_read_input_tokens >= 0),
  usage_cache_creation_input_tokens integer not null default 0 check (usage_cache_creation_input_tokens >= 0),
  actual_provider_cost_usd numeric(12, 6) check (actual_provider_cost_usd is null or actual_provider_cost_usd >= 0),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_desktop_llm_jobs_user_created
  on public.desktop_llm_jobs (user_id, created_at desc);

create index if not exists idx_desktop_llm_jobs_device_created
  on public.desktop_llm_jobs (device_id, created_at desc);

create index if not exists idx_desktop_llm_jobs_status_expires
  on public.desktop_llm_jobs (status, expires_at);

create index if not exists idx_desktop_llm_jobs_local_run
  on public.desktop_llm_jobs (user_id, local_run_id, created_at desc);

alter table public.desktop_llm_jobs enable row level security;

revoke all on table public.desktop_llm_jobs from public;
revoke all on table public.desktop_llm_jobs from anon;
revoke all on table public.desktop_llm_jobs from authenticated;
grant select, insert, update, delete on table public.desktop_llm_jobs to service_role;

create or replace function public.record_desktop_llm_job_usage(
  p_job_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_input_tokens integer,
  p_cache_creation_input_tokens integer,
  p_upstream_ok boolean,
  p_now timestamptz default now()
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.desktop_llm_jobs
     set usage_input_tokens =
           usage_input_tokens + greatest(p_input_tokens, 0),
         usage_output_tokens =
           usage_output_tokens + greatest(p_output_tokens, 0),
         usage_cache_read_input_tokens =
           usage_cache_read_input_tokens + greatest(p_cache_read_input_tokens, 0),
         usage_cache_creation_input_tokens =
           usage_cache_creation_input_tokens
             + greatest(p_cache_creation_input_tokens, 0),
         error_code = case
           when p_upstream_ok then error_code
           else 'upstream_error'
         end,
         updated_at = p_now
   where id = p_job_id;
$$;

revoke all on function public.record_desktop_llm_job_usage(
  uuid,
  integer,
  integer,
  integer,
  integer,
  boolean,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.record_desktop_llm_job_usage(
  uuid,
  integer,
  integer,
  integer,
  integer,
  boolean,
  timestamptz
) to service_role;
