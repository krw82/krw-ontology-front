-- CIK-first filing monitoring. A filing belongs to an issuer (CIK), while a
-- user may subscribe through any of that issuer's tickers/share classes.

alter table public.sec_company_identifiers
  drop constraint if exists sec_company_identifiers_cik_key;

create index if not exists idx_sec_company_identifiers_cik
  on public.sec_company_identifiers (cik)
  where cik is not null;

alter table public.sec_filing_events
  add column if not exists first_seen_at timestamptz,
  add column if not exists sec_items text[] not null default '{}'::text[],
  add column if not exists event_tags text[] not null default '{}'::text[],
  add column if not exists primary_event_tag text,
  add column if not exists classification_source text not null default 'unclassified',
  add column if not exists classification_version integer not null default 1,
  add column if not exists enrichment_status text not null default 'not_requested';

update public.sec_filing_events
set first_seen_at = created_at
where first_seen_at is null;

alter table public.sec_filing_events
  alter column first_seen_at set not null,
  alter column first_seen_at set default now(),
  drop constraint if exists sec_filing_events_classification_source_check,
  add constraint sec_filing_events_classification_source_check
    check (classification_source in ('sec_items', 'metadata', 'unclassified')),
  drop constraint if exists sec_filing_events_enrichment_status_check,
  add constraint sec_filing_events_enrichment_status_check
    check (enrichment_status in ('not_requested', 'queued', 'ready', 'failed'));

create index if not exists idx_sec_filing_events_cik_accepted
  on public.sec_filing_events (cik, accepted_at desc nulls last, first_seen_at desc);

create table if not exists public.user_filing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null references public.sec_company_identifiers(ticker) on delete restrict,
  cik text not null,
  enabled boolean not null default true,
  subscribed_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_filing_subscriptions_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'),
  constraint user_filing_subscriptions_cik_check
    check (cik ~ '^[0-9]{10}$'),
  constraint user_filing_subscriptions_enabled_disabled_check
    check ((enabled and disabled_at is null) or ((not enabled) and disabled_at is not null)),
  constraint user_filing_subscriptions_user_ticker_key unique (user_id, ticker)
);

create index if not exists idx_user_filing_subscriptions_enabled_cik
  on public.user_filing_subscriptions (cik, user_id)
  where enabled;

create table if not exists public.sec_filing_poll_state (
  cik text primary key,
  enabled boolean not null default true,
  baseline_completed_at timestamptz,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  next_poll_at timestamptz not null default now(),
  consecutive_errors integer not null default 0,
  last_error text,
  worker_id text,
  claim_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_filing_poll_state_cik_check check (cik ~ '^[0-9]{10}$'),
  constraint sec_filing_poll_state_errors_check check (consecutive_errors >= 0),
  constraint sec_filing_poll_state_error_length check (last_error is null or char_length(last_error) <= 2000)
);

create index if not exists idx_sec_filing_poll_state_due
  on public.sec_filing_poll_state (next_poll_at, created_at)
  where enabled;

create table if not exists public.sec_filing_documents (
  id uuid primary key default gen_random_uuid(),
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  sequence integer,
  document_name text not null,
  document_type text,
  description text,
  document_url text not null,
  size_bytes bigint,
  is_primary boolean not null default false,
  recommendation_score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_filing_documents_name_length check (char_length(document_name) between 1 and 512),
  constraint sec_filing_documents_url_length check (char_length(document_url) between 1 and 4096),
  constraint sec_filing_documents_score_check check (recommendation_score between 0 and 100),
  constraint sec_filing_documents_event_name_key unique (filing_event_id, document_name)
);

create index if not exists idx_sec_filing_documents_event_score
  on public.sec_filing_documents (filing_event_id, recommendation_score desc, sequence asc nulls last);

alter table public.push_subscriptions
  add column if not exists endpoint_hash text;

create unique index if not exists idx_push_subscriptions_endpoint_hash
  on public.push_subscriptions (endpoint_hash)
  where endpoint_hash is not null;

drop trigger if exists trg_user_filing_subscriptions_updated_at on public.user_filing_subscriptions;
create trigger trg_user_filing_subscriptions_updated_at
  before update on public.user_filing_subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sec_filing_poll_state_updated_at on public.sec_filing_poll_state;
create trigger trg_sec_filing_poll_state_updated_at
  before update on public.sec_filing_poll_state
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sec_filing_documents_updated_at on public.sec_filing_documents;
create trigger trg_sec_filing_documents_updated_at
  before update on public.sec_filing_documents
  for each row execute function public.set_updated_at();

create or replace function public.claim_sec_filing_poll_targets(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns table (cik text, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or char_length(trim(p_worker_id)) = 0 then
    raise exception 'p_worker_id is required';
  end if;

  return query
  with candidates as (
    select state.cik
    from public.sec_filing_poll_state state
    where state.enabled
      and (
        state.next_poll_at <= now()
        or (state.lease_expires_at is not null and state.lease_expires_at <= now())
      )
    order by state.next_poll_at asc, state.created_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  ), claimed as (
    update public.sec_filing_poll_state state
    set worker_id = p_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
        last_polled_at = now(),
        updated_at = now()
    from candidates
    where state.cik = candidates.cik
    returning state.cik, state.claim_token
  )
  select claimed.cik, claimed.claim_token from claimed;
end;
$$;

revoke all on function public.claim_sec_filing_poll_targets(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_sec_filing_poll_targets(text, integer, integer) to service_role;

alter table public.user_filing_subscriptions enable row level security;
alter table public.sec_filing_poll_state enable row level security;
alter table public.sec_filing_documents enable row level security;

revoke all on table public.user_filing_subscriptions from public, anon, authenticated;
revoke all on table public.sec_filing_poll_state from public, anon, authenticated;
revoke all on table public.sec_filing_documents from public, anon, authenticated;

grant select, insert, update, delete on table public.user_filing_subscriptions to service_role;
grant select, insert, update, delete on table public.sec_filing_poll_state to service_role;
grant select, insert, update, delete on table public.sec_filing_documents to service_role;

grant select, insert, update on table public.user_filing_subscriptions to authenticated;

create policy "user_filing_subscriptions_own" on public.user_filing_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
