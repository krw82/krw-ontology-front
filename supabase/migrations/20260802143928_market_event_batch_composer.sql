-- Group same-ticker raw materials briefly before a single composer request.
-- The composer may project one batch into multiple independent market issues.

create table if not exists public.market_event_composition_batches (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  ticker text not null check (ticker = upper(ticker) and char_length(trim(ticker)) between 1 and 16),
  bucket_starts_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'retry', 'succeeded', 'failed')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_by text,
  lease_expires_at timestamptz,
  source_context_hash text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (env, ticker, bucket_starts_at)
);

create index if not exists market_event_composition_batches_claim_idx
  on public.market_event_composition_batches (env, status, available_at, created_at);

create table if not exists public.market_event_composition_batch_items (
  batch_id uuid not null references public.market_event_composition_batches(id) on delete cascade,
  source_item_id uuid not null references public.market_source_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (batch_id, source_item_id)
);

create index if not exists market_event_composition_batch_items_source_idx
  on public.market_event_composition_batch_items (source_item_id, batch_id);

create or replace function public.claim_market_event_composition_batch(
  p_env text,
  p_worker_id text,
  p_lease_seconds integer default 180
)
returns setof public.market_event_composition_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.market_event_composition_batches;
begin
  with candidate as (
    select id
    from public.market_event_composition_batches
    where env = p_env
      and available_at <= now()
      and (status in ('pending', 'retry') or (status = 'running' and lease_expires_at < now()))
    order by available_at asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.market_event_composition_batches as batch
  set status = 'running',
      claimed_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))),
      attempt_count = batch.attempt_count + 1,
      updated_at = now()
  from candidate
  where batch.id = candidate.id
  returning batch.* into claimed;

  if found then return next claimed; end if;
end;
$$;

alter table public.market_event_composition_batches enable row level security;
alter table public.market_event_composition_batch_items enable row level security;

revoke all on table public.market_event_composition_batches, public.market_event_composition_batch_items from anon, authenticated, public;
grant select, insert, update, delete on table public.market_event_composition_batches, public.market_event_composition_batch_items to service_role;

revoke all on function public.claim_market_event_composition_batch(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_market_event_composition_batch(text, text, integer) to service_role;
