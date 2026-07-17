-- Global SEC filing discovery, phase B.
-- Event coverage is intentionally independent from the mutable catalog company
-- rows so a release re-publish cannot invalidate historical Pulse access.

create table if not exists public.sec_filing_event_catalog_coverage (
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  env text not null check (env in ('dev', 'staging', 'prod')),
  release_id text not null,
  ticker text not null,
  covered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (filing_event_id, env, release_id, ticker),
  constraint sec_filing_event_catalog_coverage_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$')
);

create index if not exists idx_sec_filing_event_catalog_coverage_env_event
  on public.sec_filing_event_catalog_coverage (env, filing_event_id);

create index if not exists idx_sec_filing_event_catalog_coverage_env_ticker_event
  on public.sec_filing_event_catalog_coverage (env, ticker, filing_event_id);

create table if not exists public.sec_filing_discovery_checkpoints (
  env text not null check (env in ('dev', 'staging', 'prod')),
  source_key text not null,
  enabled boolean not null default true,
  watermark_at timestamptz,
  watermark_accession text,
  next_poll_at timestamptz not null default now(),
  last_success_at timestamptz,
  consecutive_errors integer not null default 0 check (consecutive_errors >= 0),
  gap_risk boolean not null default false,
  worker_id text,
  claim_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (env, source_key),
  constraint sec_filing_discovery_checkpoints_source_key_check
    check (source_key in ('atom:8-K', 'atom:8-K/A', 'atom:6-K', 'atom:6-K/A', 'atom:4', 'atom:4/A', 'daily_index:master')),
  constraint sec_filing_discovery_checkpoints_error_length
    check (last_error is null or char_length(last_error) <= 2000)
);

create index if not exists idx_sec_filing_discovery_checkpoints_due
  on public.sec_filing_discovery_checkpoints (env, next_poll_at, created_at)
  where enabled;

create table if not exists public.sec_catalog_filing_reconciliation_state (
  env text not null check (env in ('dev', 'staging', 'prod')),
  cik text not null check (cik ~ '^[0-9]{10}$'),
  enabled boolean not null default true,
  coverage_started_at timestamptz not null default now(),
  baseline_completed_at timestamptz,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  next_poll_at timestamptz not null default now(),
  consecutive_errors integer not null default 0 check (consecutive_errors >= 0),
  last_error text,
  worker_id text,
  claim_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (env, cik),
  constraint sec_catalog_filing_reconciliation_state_error_length
    check (last_error is null or char_length(last_error) <= 2000)
);

create index if not exists idx_sec_catalog_filing_reconciliation_state_due
  on public.sec_catalog_filing_reconciliation_state (env, next_poll_at, created_at)
  where enabled;

create table if not exists public.sec_filing_worker_leases (
  env text not null check (env in ('dev', 'staging', 'prod')),
  lease_key text not null,
  deployment_id text not null,
  worker_id text not null,
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (env, lease_key),
  constraint sec_filing_worker_leases_key_check
    check (lease_key = 'sec_request_scheduler'),
  constraint sec_filing_worker_leases_deployment_id_length
    check (char_length(trim(deployment_id)) between 1 and 200),
  constraint sec_filing_worker_leases_worker_id_length
    check (char_length(trim(worker_id)) between 1 and 200)
);

create index if not exists idx_sec_filing_worker_leases_expiry
  on public.sec_filing_worker_leases (env, lease_expires_at);

drop trigger if exists trg_sec_filing_discovery_checkpoints_updated_at on public.sec_filing_discovery_checkpoints;
create trigger trg_sec_filing_discovery_checkpoints_updated_at
  before update on public.sec_filing_discovery_checkpoints
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sec_catalog_filing_reconciliation_state_updated_at on public.sec_catalog_filing_reconciliation_state;
create trigger trg_sec_catalog_filing_reconciliation_state_updated_at
  before update on public.sec_catalog_filing_reconciliation_state
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sec_filing_worker_leases_updated_at on public.sec_filing_worker_leases;
create trigger trg_sec_filing_worker_leases_updated_at
  before update on public.sec_filing_worker_leases
  for each row execute function public.set_updated_at();

create or replace function public.get_active_catalog_sec_targets(p_env text)
returns table (cik text, release_id text)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select distinct company.sec_cik, release.release_id
  from public.ontology_catalog_releases release
  join public.ontology_companies company
    on company.env = release.env
   and company.release_id = release.release_id
  where release.env = lower(trim(p_env))
    and release.active
    and company.sec_cik is not null
  order by company.sec_cik;
$$;

create or replace function public.sync_catalog_sec_filing_reconciliation_targets(p_env text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_count integer := 0;
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;

  insert into public.sec_catalog_filing_reconciliation_state (
    env,
    cik,
    enabled,
    coverage_started_at,
    next_poll_at
  )
  select
    v_env,
    target.cik,
    true,
    now(),
    now() + make_interval(secs => (abs(hashtext(target.cik)) % 1800))
  from public.get_active_catalog_sec_targets(v_env) target
  on conflict (env, cik) do update
  set enabled = true,
      updated_at = now();
  get diagnostics v_count = row_count;

  update public.sec_catalog_filing_reconciliation_state state
  set enabled = false,
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where state.env = v_env
    and state.enabled
    and not exists (
      select 1
      from public.get_active_catalog_sec_targets(v_env) target
      where target.cik = state.cik
    );

  return v_count;
end;
$$;

create or replace function public.ensure_sec_filing_discovery_sources(p_env text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_count integer := 0;
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;

  insert into public.sec_filing_discovery_checkpoints (env, source_key, enabled, next_poll_at)
  select v_env, source_key, true, now()
  from unnest(array['atom:8-K', 'atom:8-K/A', 'atom:6-K', 'atom:6-K/A', 'atom:4', 'atom:4/A', 'daily_index:master']::text[]) source_key
  on conflict (env, source_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.claim_sec_filing_discovery_checkpoint(
  p_env text,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  env text,
  source_key text,
  watermark_at timestamptz,
  watermark_accession text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_worker_id text := trim(coalesce(p_worker_id, ''));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;
  if v_worker_id = '' then
    raise exception 'p_worker_id is required';
  end if;

  return query
  with candidate as (
    select checkpoint.env, checkpoint.source_key
    from public.sec_filing_discovery_checkpoints checkpoint
    where checkpoint.env = v_env
      and checkpoint.enabled
      and (
        checkpoint.next_poll_at <= now()
        or (checkpoint.lease_expires_at is not null and checkpoint.lease_expires_at <= now())
      )
    order by checkpoint.next_poll_at asc, checkpoint.source_key asc
    limit 1
    for update skip locked
  ), claimed as (
    update public.sec_filing_discovery_checkpoints checkpoint
    set worker_id = v_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        updated_at = now()
    from candidate
    where checkpoint.env = candidate.env
      and checkpoint.source_key = candidate.source_key
    returning checkpoint.env, checkpoint.source_key, checkpoint.watermark_at,
      checkpoint.watermark_accession, checkpoint.claim_token
  )
  select * from claimed;
end;
$$;

create or replace function public.claim_catalog_sec_filing_reconciliation_targets(
  p_env text,
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns table (
  env text,
  cik text,
  release_id text,
  coverage_started_at timestamptz,
  baseline_completed_at timestamptz,
  claim_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_worker_id text := trim(coalesce(p_worker_id, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;
  if v_worker_id = '' then
    raise exception 'p_worker_id is required';
  end if;

  perform public.sync_catalog_sec_filing_reconciliation_targets(v_env);

  return query
  with target_release as (
    select target.cik, min(target.release_id) as release_id
    from public.get_active_catalog_sec_targets(v_env) target
    group by target.cik
  ), candidates as (
    select state.cik
    from public.sec_catalog_filing_reconciliation_state state
    join target_release target on target.cik = state.cik
    where state.env = v_env
      and state.enabled
      and (
        state.next_poll_at <= now()
        or (state.lease_expires_at is not null and state.lease_expires_at <= now())
      )
    order by state.next_poll_at asc, state.created_at asc
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.sec_catalog_filing_reconciliation_state state
    set worker_id = v_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        last_polled_at = now(),
        updated_at = now()
    from candidates
    where state.env = v_env
      and state.cik = candidates.cik
    returning state.env, state.cik, state.coverage_started_at,
      state.baseline_completed_at, state.claim_token
  )
  select claimed.env, claimed.cik, target_release.release_id,
    claimed.coverage_started_at, claimed.baseline_completed_at, claimed.claim_token
  from claimed
  join target_release on target_release.cik = claimed.cik;
end;
$$;

create or replace function public.claim_sec_filing_scheduler_leader(
  p_env text,
  p_deployment_id text,
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns table (claim_token uuid, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_deployment_id text := trim(coalesce(p_deployment_id, ''));
  v_worker_id text := trim(coalesce(p_worker_id, ''));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 90), 300));
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;
  if v_deployment_id = '' or v_worker_id = '' then
    raise exception 'p_deployment_id and p_worker_id are required';
  end if;

  return query
  insert into public.sec_filing_worker_leases as lease (
    env,
    lease_key,
    deployment_id,
    worker_id,
    claim_token,
    lease_expires_at,
    heartbeat_at
  )
  values (
    v_env,
    'sec_request_scheduler',
    v_deployment_id,
    v_worker_id,
    gen_random_uuid(),
    now() + make_interval(secs => v_lease_seconds),
    now()
  )
  on conflict (env, lease_key) do update
  set deployment_id = excluded.deployment_id,
      worker_id = excluded.worker_id,
      claim_token = case
        when lease.worker_id = v_worker_id then lease.claim_token
        else gen_random_uuid()
      end,
      lease_expires_at = now() + make_interval(secs => v_lease_seconds),
      heartbeat_at = now(),
      updated_at = now()
  where lease.lease_expires_at <= now()
     or lease.worker_id = v_worker_id
  returning lease.claim_token, lease.lease_expires_at;
end;
$$;

alter table public.sec_filing_event_catalog_coverage enable row level security;
alter table public.sec_filing_discovery_checkpoints enable row level security;
alter table public.sec_catalog_filing_reconciliation_state enable row level security;
alter table public.sec_filing_worker_leases enable row level security;

revoke all on table public.sec_filing_event_catalog_coverage from public, anon, authenticated;
revoke all on table public.sec_filing_discovery_checkpoints from public, anon, authenticated;
revoke all on table public.sec_catalog_filing_reconciliation_state from public, anon, authenticated;
revoke all on table public.sec_filing_worker_leases from public, anon, authenticated;

grant select, insert, update, delete on table public.sec_filing_event_catalog_coverage to service_role;
grant select, insert, update, delete on table public.sec_filing_discovery_checkpoints to service_role;
grant select, insert, update, delete on table public.sec_catalog_filing_reconciliation_state to service_role;
grant select, insert, update, delete on table public.sec_filing_worker_leases to service_role;

revoke all on function public.get_active_catalog_sec_targets(text) from public, anon, authenticated;
revoke all on function public.sync_catalog_sec_filing_reconciliation_targets(text) from public, anon, authenticated;
revoke all on function public.ensure_sec_filing_discovery_sources(text) from public, anon, authenticated;
revoke all on function public.claim_sec_filing_discovery_checkpoint(text, text, integer) from public, anon, authenticated;
revoke all on function public.claim_catalog_sec_filing_reconciliation_targets(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_sec_filing_scheduler_leader(text, text, text, integer) from public, anon, authenticated;

grant execute on function public.get_active_catalog_sec_targets(text) to service_role;
grant execute on function public.sync_catalog_sec_filing_reconciliation_targets(text) to service_role;
grant execute on function public.ensure_sec_filing_discovery_sources(text) to service_role;
grant execute on function public.claim_sec_filing_discovery_checkpoint(text, text, integer) to service_role;
grant execute on function public.claim_catalog_sec_filing_reconciliation_targets(text, text, integer, integer) to service_role;
grant execute on function public.claim_sec_filing_scheduler_leader(text, text, text, integer) to service_role;
