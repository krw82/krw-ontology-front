-- The local Finnhub worker writes a Korean public projection. Original title
-- and summary are kept in a separate service-only table; provider metadata
-- and source identifiers remain exclusively in the encrypted local vault.

alter table public.market_issues
  add column if not exists local_news_stage text not null default 'standard',
  add column if not exists local_news_verification_state text not null default 'not_requested';

alter table public.market_issues
  drop constraint if exists market_issues_local_news_stage_check;
alter table public.market_issues
  add constraint market_issues_local_news_stage_check
  check (local_news_stage in ('standard', 'translated', 'ai_verified'));

alter table public.market_issues
  drop constraint if exists market_issues_local_news_verification_state_check;
alter table public.market_issues
  add constraint market_issues_local_news_verification_state_check
  check (local_news_verification_state in ('not_requested', 'pending', 'processing', 'verified', 'failed'));

-- This is deliberately separate from the public issue projection. It stores
-- only the original headline and summary needed for later verification; it
-- never contains provider, URL, provider article ID, source times, or hashes.
create table if not exists public.market_local_news_private_materials (
  issue_id uuid primary key references public.market_issues(id) on delete cascade,
  original_headline text not null,
  original_summary text not null,
  original_language text not null default 'en' check (original_language ~ '^[a-z]{2,8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_local_news_verification_requests (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  issue_id uuid not null references public.market_issues(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'retry', 'succeeded', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_by text,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (env, issue_id)
);

create index if not exists market_local_news_verification_claim_idx
  on public.market_local_news_verification_requests (env, status, available_at, created_at);

create or replace function public.claim_market_local_news_verification_request(
  p_env text,
  p_worker_id text,
  p_lease_seconds integer default 180
)
returns setof public.market_local_news_verification_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.market_local_news_verification_requests;
begin
  if lower(trim(coalesce(p_env, ''))) not in ('dev', 'staging', 'prod') then
    raise exception 'invalid market issue env';
  end if;
  if nullif(trim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'worker id is required';
  end if;

  with candidate as (
    select id
    from public.market_local_news_verification_requests
    where env = p_env
      and available_at <= now()
      and (
        status in ('pending', 'retry')
        or (status = 'running' and lease_expires_at < now())
      )
    order by available_at asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.market_local_news_verification_requests as request
  set status = 'running',
      claimed_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))),
      attempt_count = request.attempt_count + 1,
      updated_at = now()
  from candidate
  where request.id = candidate.id
  returning request.* into claimed;

  if found then
    return next claimed;
  end if;
end;
$$;

alter table public.market_local_news_verification_requests enable row level security;
alter table public.market_local_news_private_materials enable row level security;

revoke all on table
  public.market_local_news_verification_requests,
  public.market_local_news_private_materials
from public, anon, authenticated;
grant select, insert, update, delete on table
  public.market_local_news_verification_requests,
  public.market_local_news_private_materials
to service_role;

revoke all on function public.claim_market_local_news_verification_request(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_market_local_news_verification_request(text, text, integer)
  to service_role;
