-- A Form 4/A can correct one transaction from an earlier Form 4 while the
-- earlier filing still contains other valid transactions. Keep the raw SEC
-- facts immutable, but let the Pulse read path use only the latest effective
-- transaction for each corrected row.

create table if not exists public.sec_form4_transaction_supersessions (
  superseded_transaction_id uuid primary key
    references public.sec_form4_transactions(id) on delete cascade,
  superseded_filing_event_id uuid not null
    references public.sec_filing_events(id) on delete cascade,
  superseding_transaction_id uuid not null unique
    references public.sec_form4_transactions(id) on delete cascade,
  superseding_filing_event_id uuid not null
    references public.sec_filing_events(id) on delete cascade,
  match_strategy text not null default 'transaction_fingerprint'
    check (match_strategy in ('transaction_fingerprint')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_form4_transaction_supersessions_different_events
    check (superseded_filing_event_id <> superseding_filing_event_id)
);

create index if not exists idx_sec_form4_transaction_supersessions_superseding_event
  on public.sec_form4_transaction_supersessions (superseding_filing_event_id, created_at desc);

create index if not exists idx_sec_form4_transaction_supersessions_superseded_event
  on public.sec_form4_transaction_supersessions (superseded_filing_event_id, created_at desc);

drop trigger if exists trg_sec_form4_transaction_supersessions_updated_at
  on public.sec_form4_transaction_supersessions;
create trigger trg_sec_form4_transaction_supersessions_updated_at
  before update on public.sec_form4_transaction_supersessions
  for each row execute function public.set_updated_at();

alter table public.sec_form4_transaction_supersessions enable row level security;
revoke all on table public.sec_form4_transaction_supersessions from public, anon, authenticated;
grant select, insert, update, delete on table public.sec_form4_transaction_supersessions to service_role;

-- Match only a unique, same-issuer/same-owner transaction fingerprint. The
-- SEC does not expose an amendment-to-original accession relationship for
-- Form 4s, so ambiguous matches intentionally remain unlinked and visible.
-- Price is intentionally excluded: correcting price is the common Form 4/A
-- case and all other transaction identity fields must still agree.
create or replace function public.sync_sec_form4_transaction_supersessions(
  p_amendment_filing_event_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_amendment public.sec_filing_events%rowtype;
  v_linked integer := 0;
begin
  select * into v_amendment
  from public.sec_filing_events
  where id = p_amendment_filing_event_id;

  delete from public.sec_form4_transaction_supersessions
  where superseding_filing_event_id = p_amendment_filing_event_id;

  if v_amendment.id is null
    or v_amendment.form_type is distinct from '4/A'
    or v_amendment.is_amendment is not true then
    return 0;
  end if;

  with amendment_transactions as (
    select tx.*
    from public.sec_form4_transactions tx
    where tx.filing_event_id = v_amendment.id
      and tx.reported_value_basis = 'p_or_s'
      and tx.transaction_code in ('P', 'S')
  ), candidate_pairs as (
    select
      amendment_tx.id as superseding_transaction_id,
      superseded_tx.id as superseded_transaction_id,
      superseded_event.id as superseded_filing_event_id
    from amendment_transactions amendment_tx
    join public.sec_form4_reporting_owners amendment_owner
      on amendment_owner.filing_event_id = amendment_tx.filing_event_id
     and amendment_owner.reporting_owner_index = amendment_tx.reporting_owner_index
    join public.sec_form4_transactions superseded_tx
      on superseded_tx.filing_event_id <> amendment_tx.filing_event_id
     and superseded_tx.reported_value_basis = 'p_or_s'
     and superseded_tx.transaction_code in ('P', 'S')
     and superseded_tx.security_kind = amendment_tx.security_kind
     and superseded_tx.security_title = amendment_tx.security_title
     and superseded_tx.transaction_date is not distinct from amendment_tx.transaction_date
     and superseded_tx.transaction_code is not distinct from amendment_tx.transaction_code
     and superseded_tx.transaction_shares is not distinct from amendment_tx.transaction_shares
     and superseded_tx.acquired_disposed_code is not distinct from amendment_tx.acquired_disposed_code
     and superseded_tx.shares_owned_following is not distinct from amendment_tx.shares_owned_following
     and superseded_tx.direct_indirect_code is not distinct from amendment_tx.direct_indirect_code
    join public.sec_filing_events superseded_event
      on superseded_event.id = superseded_tx.filing_event_id
     and superseded_event.env = v_amendment.env
     and superseded_event.cik = v_amendment.cik
     and superseded_event.form_type in ('4', '4/A')
     and coalesce(superseded_event.accepted_at, superseded_event.first_seen_at)
         <= coalesce(v_amendment.accepted_at, v_amendment.first_seen_at)
     and coalesce(v_amendment.accepted_at, v_amendment.first_seen_at)
         - coalesce(superseded_event.accepted_at, superseded_event.first_seen_at)
         <= interval '45 days'
    join public.sec_form4_reporting_owners superseded_owner
      on superseded_owner.filing_event_id = superseded_tx.filing_event_id
     and superseded_owner.reporting_owner_index = superseded_tx.reporting_owner_index
     and coalesce(superseded_owner.owner_cik, '') = coalesce(amendment_owner.owner_cik, '')
     and lower(trim(superseded_owner.owner_name)) = lower(trim(amendment_owner.owner_name))
    where not exists (
      select 1
      from public.sec_form4_transaction_supersessions existing
      where existing.superseded_transaction_id = superseded_tx.id
    )
  ), unique_superseding as (
    select superseding_transaction_id
    from candidate_pairs
    group by superseding_transaction_id
    having count(*) = 1
  ), unique_superseded as (
    select superseded_transaction_id
    from candidate_pairs
    group by superseded_transaction_id
    having count(*) = 1
  )
  insert into public.sec_form4_transaction_supersessions as link (
    superseded_transaction_id,
    superseded_filing_event_id,
    superseding_transaction_id,
    superseding_filing_event_id,
    match_strategy
  )
  select
    pair.superseded_transaction_id,
    pair.superseded_filing_event_id,
    pair.superseding_transaction_id,
    v_amendment.id,
    'transaction_fingerprint'
  from candidate_pairs pair
  join unique_superseding on unique_superseding.superseding_transaction_id = pair.superseding_transaction_id
  join unique_superseded on unique_superseded.superseded_transaction_id = pair.superseded_transaction_id
  on conflict (superseded_transaction_id) do update
  set superseded_filing_event_id = excluded.superseded_filing_event_id,
      superseding_transaction_id = excluded.superseding_transaction_id,
      superseding_filing_event_id = excluded.superseding_filing_event_id,
      match_strategy = excluded.match_strategy,
      updated_at = now();

  get diagnostics v_linked = row_count;
  return v_linked;
end;
$$;

create or replace function public.pulse_effective_form4_summary(
  p_filing_event_id uuid
)
returns table (
  reported_purchase_value numeric,
  reported_sale_value numeric,
  has_reported_open_market_trade boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with effective_transactions as (
    select tx.*
    from public.sec_form4_transactions tx
    where tx.filing_event_id = p_filing_event_id
      and tx.reported_value_basis = 'p_or_s'
      and tx.transaction_code in ('P', 'S')
      and not exists (
        select 1
        from public.sec_form4_transaction_supersessions link
        where link.superseded_transaction_id = tx.id
      )
  )
  select
    sum(transaction_value) filter (where transaction_code = 'P') as reported_purchase_value,
    sum(transaction_value) filter (where transaction_code = 'S') as reported_sale_value,
    count(*) > 0 as has_reported_open_market_trade
  from (
    select
      tx.transaction_code,
      tx.reported_transaction_value as transaction_value
    from effective_transactions tx
  ) as effective_values;
$$;

-- The existing candidate payload stays compact and immutable. This RPC
-- overlays only the effective Form 4 totals at read time, so a newly linked
-- amendment immediately invalidates the shared candidate cache without a
-- per-user fan-out or destructive rewrite of SEC data.
create or replace function public.get_pulse_global_filing_candidates_v1(
  p_env text,
  p_snapshot_at timestamptz default now(),
  p_preferred_tickers text[] default '{}'::text[],
  p_urgent_limit integer default 24,
  p_priority_limit integer default 32,
  p_preferred_limit integer default 40,
  p_discovery_limit integer default 24
)
returns table (
  filing_event_id uuid,
  payload jsonb,
  candidate_bucket text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with bounds as (
    select
      lower(trim(p_env)) as env,
      coalesce(p_snapshot_at, now()) as snapshot_at,
      greatest(0, least(coalesce(p_urgent_limit, 24), 50)) as urgent_limit,
      greatest(0, least(coalesce(p_priority_limit, 32), 60)) as priority_limit,
      greatest(0, least(coalesce(p_preferred_limit, 40), 60)) as preferred_limit,
      greatest(0, least(coalesce(p_discovery_limit, 24), 50)) as discovery_limit,
      array(
        select distinct upper(trim(ticker))
        from unnest(coalesce(p_preferred_tickers, '{}'::text[])) as ticker
        where char_length(trim(ticker)) between 1 and 16
        order by upper(trim(ticker))
        limit 100
      ) as preferred_tickers
  ), effective_candidates as (
    select
      candidate.env,
      candidate.filing_event_id,
      candidate.alert_priority,
      candidate.priority_rank,
      candidate.occurred_at,
      candidate.available_at,
      candidate.expires_at,
      candidate.payload->>'form_type' as form_type,
      form4.has_reported_open_market_trade as form4_has_reported_open_market_trade,
      case
        when candidate.payload->>'form_type' in ('4', '4/A') then candidate.payload || jsonb_build_object(
          'form4_reported_purchase_value', form4.reported_purchase_value,
          'form4_reported_sale_value', form4.reported_sale_value,
          'form4_has_reported_open_market_trade', coalesce(form4.has_reported_open_market_trade, false)
        )
        else candidate.payload
      end as payload
    from public.pulse_global_filing_candidates candidate
    left join lateral public.pulse_effective_form4_summary(candidate.filing_event_id) form4
      on candidate.payload->>'form_type' in ('4', '4/A')
  ), eligible as (
    select candidate.*
    from effective_candidates candidate
    join bounds on bounds.env = candidate.env
    where bounds.env in ('dev', 'staging', 'prod')
      and candidate.available_at <= bounds.snapshot_at
      and (candidate.expires_at is null or candidate.expires_at > bounds.snapshot_at)
      and (
        coalesce(candidate.form_type, '') not in ('4', '4/A')
        or coalesce(candidate.form4_has_reported_open_market_trade, false)
      )
  ), urgent as (
    select eligible.filing_event_id, eligible.payload, 'urgent'::text as bucket, 0 as bucket_rank,
      eligible.priority_rank, eligible.occurred_at
    from eligible cross join bounds
    where eligible.alert_priority = 'urgent'
      and eligible.occurred_at >= bounds.snapshot_at - interval '72 hours'
    order by eligible.priority_rank asc nulls last, eligible.occurred_at desc, eligible.filing_event_id desc
    limit (select urgent_limit from bounds)
  ), priority as (
    select eligible.filing_event_id, eligible.payload, 'priority'::text as bucket, 1 as bucket_rank,
      eligible.priority_rank, eligible.occurred_at
    from eligible cross join bounds
    where eligible.alert_priority = 'normal'
      and eligible.occurred_at >= bounds.snapshot_at - interval '7 days'
    order by eligible.priority_rank asc nulls last, eligible.occurred_at desc, eligible.filing_event_id desc
    limit (select priority_limit from bounds)
  ), preferred as (
    select distinct on (eligible.filing_event_id)
      eligible.filing_event_id, eligible.payload, 'preferred'::text as bucket, 2 as bucket_rank,
      eligible.priority_rank, eligible.occurred_at
    from eligible
    join public.pulse_global_candidate_tickers tickers
      on tickers.env = eligible.env and tickers.filing_event_id = eligible.filing_event_id
    cross join bounds
    where cardinality(bounds.preferred_tickers) > 0
      and tickers.ticker = any(bounds.preferred_tickers)
      and eligible.occurred_at >= bounds.snapshot_at - interval '14 days'
    order by eligible.filing_event_id, eligible.priority_rank asc nulls last, eligible.occurred_at desc
  ), preferred_limited as (
    select * from preferred
    order by priority_rank asc nulls last, occurred_at desc, filing_event_id desc
    limit (select preferred_limit from bounds)
  ), discovery as (
    select eligible.filing_event_id, eligible.payload, 'discovery'::text as bucket, 3 as bucket_rank,
      eligible.priority_rank, eligible.occurred_at
    from eligible cross join bounds
    where eligible.occurred_at >= bounds.snapshot_at - interval '7 days'
    order by eligible.priority_rank asc nulls last, eligible.occurred_at desc, eligible.filing_event_id desc
    limit (select discovery_limit from bounds)
  ), combined as (
    select * from urgent
    union all select * from priority
    union all select * from preferred_limited
    union all select * from discovery
  ), deduplicated as (
    select distinct on (filing_event_id) *
    from combined
    order by filing_event_id, bucket_rank, priority_rank asc nulls last, occurred_at desc
  )
  select filing_event_id, payload, bucket
  from deduplicated
  order by bucket_rank, priority_rank asc nulls last, occurred_at desc, filing_event_id desc;
$$;

create or replace function public.refresh_sec_form4_transaction_supersessions_from_summary()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.sec_filing_events%rowtype;
  v_amendment_id uuid;
begin
  select * into v_event
  from public.sec_filing_events
  where id = new.filing_event_id;

  if not found or v_event.form_type not in ('4', '4/A') then
    return new;
  end if;

  if v_event.form_type = '4/A' and v_event.is_amendment then
    perform public.sync_sec_form4_transaction_supersessions(v_event.id);
  else
    -- Handle an out-of-order ingest: if the original finished enrichment after
    -- its amendment, only re-evaluate nearby amendments from the same issuer.
    for v_amendment_id in
      select amendment.id
      from public.sec_filing_events amendment
      where amendment.env = v_event.env
        and amendment.cik = v_event.cik
        and amendment.form_type = '4/A'
        and amendment.is_amendment
        and coalesce(amendment.accepted_at, amendment.first_seen_at)
            >= coalesce(v_event.accepted_at, v_event.first_seen_at)
        and coalesce(amendment.accepted_at, amendment.first_seen_at)
            - coalesce(v_event.accepted_at, v_event.first_seen_at)
            <= interval '45 days'
    loop
      perform public.sync_sec_form4_transaction_supersessions(v_amendment_id);
    end loop;
  end if;

  -- Candidate rows are shared and cached by this revision. The RPC overlays
  -- the effective totals, so one bump safely refreshes both original and
  -- amendment without rewriting either SEC record.
  perform public.bump_pulse_global_feed_revision(v_event.env);
  return new;
end;
$$;

drop trigger if exists trg_z_refresh_sec_form4_transaction_supersessions
  on public.sec_form4_event_summaries;
create trigger trg_z_refresh_sec_form4_transaction_supersessions
  after insert or update on public.sec_form4_event_summaries
  for each row execute function public.refresh_sec_form4_transaction_supersessions_from_summary();

do $$
declare
  v_amendment_id uuid;
  v_env text;
begin
  for v_amendment_id in
    select id
    from public.sec_filing_events
    where form_type = '4/A' and is_amendment
  loop
    perform public.sync_sec_form4_transaction_supersessions(v_amendment_id);
  end loop;

  for v_env in
    select distinct env
    from public.sec_filing_events
    where form_type in ('4', '4/A')
  loop
    if v_env in ('dev', 'staging', 'prod') then
      perform public.bump_pulse_global_feed_revision(v_env);
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_sec_form4_transaction_supersessions(uuid) from public, anon, authenticated;
revoke all on function public.pulse_effective_form4_summary(uuid) from public, anon, authenticated;
revoke all on function public.refresh_sec_form4_transaction_supersessions_from_summary() from public, anon, authenticated;
revoke all on function public.get_pulse_global_filing_candidates_v1(text, timestamptz, text[], integer, integer, integer, integer) from public, anon, authenticated;

grant execute on function public.sync_sec_form4_transaction_supersessions(uuid) to service_role;
grant execute on function public.pulse_effective_form4_summary(uuid) to service_role;
grant execute on function public.get_pulse_global_filing_candidates_v1(text, timestamptz, text[], integer, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
