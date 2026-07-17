-- Bounded, catalog-scoped candidates for the personalized Pulse read path.
-- This deliberately returns filing metadata only. Raw SEC document bodies remain
-- on-demand through the filings MCP/detail paths and no LLM work is started here.

create index if not exists idx_sec_filing_events_pulse_preferred_ticker
  on public.sec_filing_events (env, ticker, occurred_at desc, id)
  where feed_eligible and processing_status = 'ready';

create index if not exists idx_sec_filing_events_pulse_available
  on public.sec_filing_events (env, feed_available_at desc, id)
  where feed_eligible and processing_status = 'ready';

create or replace function public.get_catalog_pulse_filing_candidates_v2(
  p_env text,
  p_snapshot_at timestamptz,
  p_preferred_tickers text[] default '{}'::text[],
  p_urgent_limit integer default 80,
  p_priority_limit integer default 100,
  p_preferred_limit integer default 80,
  p_discovery_limit integer default 40
)
returns table (
  filing_event_id uuid,
  ticker text,
  covered_tickers text[],
  cik text,
  accession_number text,
  form_type text,
  is_amendment boolean,
  filing_date date,
  report_date date,
  accepted_at timestamptz,
  first_seen_at timestamptz,
  occurred_at timestamptz,
  feed_available_at timestamptz,
  feed_expires_at timestamptz,
  feed_lane smallint,
  feed_priority_rank smallint,
  alert_priority text,
  primary_event_tag text,
  sec_items text[],
  event_tags text[],
  filing_detail_url text,
  primary_document_url text,
  source_metadata jsonb,
  processing_status text,
  form4_reported_purchase_value numeric,
  form4_reported_sale_value numeric,
  form4_tenb5_one_status text,
  form4_has_reported_open_market_trade boolean,
  candidate_bucket text
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
#variable_conflict use_column
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, now());
  v_urgent_limit integer := greatest(0, least(coalesce(p_urgent_limit, 80), 100));
  v_priority_limit integer := greatest(0, least(coalesce(p_priority_limit, 100), 120));
  v_preferred_limit integer := greatest(0, least(coalesce(p_preferred_limit, 80), 100));
  v_discovery_limit integer := greatest(0, least(coalesce(p_discovery_limit, 40), 80));
  v_preferred_tickers text[] := array(
    select ticker
    from (
      select distinct upper(trim(raw_ticker)) as ticker
      from unnest(coalesce(p_preferred_tickers, '{}'::text[])) as raw_ticker
      where char_length(trim(raw_ticker)) between 1 and 16
      order by upper(trim(raw_ticker))
      limit 100
    ) normalized_tickers
  );
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;

  return query
  with active_catalog_companies as (
    select
      company.sec_cik,
      array_agg(company.ticker order by company.ticker) as covered_tickers
    from public.ontology_catalog_releases release
    join public.ontology_companies company
      on company.env = release.env
     and company.release_id = release.release_id
    where release.env = v_env
      and release.active
      and company.sec_cik is not null
    group by company.sec_cik
  ),
  eligible as (
    select
      event.id as filing_event_id,
      event.ticker,
      active_catalog_companies.covered_tickers,
      event.cik,
      event.accession_number,
      event.form_type,
      event.is_amendment,
      event.filing_date,
      event.report_date,
      event.accepted_at,
      event.first_seen_at,
      event.occurred_at,
      event.feed_available_at,
      event.feed_expires_at,
      event.feed_lane,
      event.feed_priority_rank,
      event.alert_priority,
      event.primary_event_tag,
      event.sec_items,
      event.event_tags,
      event.filing_detail_url,
      event.primary_document_url,
      event.source_metadata,
      event.processing_status,
      summary.reported_purchase_value as form4_reported_purchase_value,
      summary.reported_sale_value as form4_reported_sale_value,
      summary.tenb5_one_status as form4_tenb5_one_status,
      summary.has_reported_open_market_trade as form4_has_reported_open_market_trade
    from public.sec_filing_events event
    join active_catalog_companies
      on active_catalog_companies.sec_cik = event.cik
    left join public.sec_form4_event_summaries summary
      on summary.filing_event_id = event.id
    where event.env = v_env
      and event.feed_eligible
      and event.processing_status = 'ready'
      and event.feed_available_at <= v_snapshot_at
      and (event.feed_expires_at is null or event.feed_expires_at > v_snapshot_at)
      -- The preferred-company bucket has the longest lookback. Restricting
      -- the shared CTE to it prevents old feed rows from being materialised
      -- for every bounded bucket below.
      and event.occurred_at >= v_snapshot_at - interval '14 days'
  ),
  urgent_candidates as (
    select eligible.*, 'urgent'::text as candidate_bucket, 0 as candidate_bucket_rank
    from eligible
    where alert_priority = 'urgent'
      and occurred_at >= v_snapshot_at - interval '72 hours'
    order by feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc
    limit v_urgent_limit
  ),
  priority_candidates as (
    select eligible.*, 'priority'::text as candidate_bucket, 1 as candidate_bucket_rank
    from eligible
    where alert_priority = 'normal'
      and occurred_at >= v_snapshot_at - interval '7 days'
    order by feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc
    limit v_priority_limit
  ),
  preferred_candidates as (
    select eligible.*, 'preferred'::text as candidate_bucket, 2 as candidate_bucket_rank
    from eligible
    where cardinality(v_preferred_tickers) > 0
      and ticker = any(v_preferred_tickers)
      and occurred_at >= v_snapshot_at - interval '14 days'
    order by feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc
    limit v_preferred_limit
  ),
  discovery_candidates as (
    select eligible.*, 'discovery'::text as candidate_bucket, 3 as candidate_bucket_rank
    from eligible
    where occurred_at >= v_snapshot_at - interval '7 days'
    order by feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc
    limit v_discovery_limit
  ),
  deduplicated as (
    select distinct on (filing_event_id) *
    from (
      select * from urgent_candidates
      union all
      select * from priority_candidates
      union all
      select * from preferred_candidates
      union all
      select * from discovery_candidates
    ) candidates
    order by filing_event_id, candidate_bucket_rank, feed_priority_rank asc nulls last, occurred_at desc
  )
  select
    filing_event_id,
    ticker,
    covered_tickers,
    cik,
    accession_number,
    form_type,
    is_amendment,
    filing_date,
    report_date,
    accepted_at,
    first_seen_at,
    occurred_at,
    feed_available_at,
    feed_expires_at,
    feed_lane,
    feed_priority_rank,
    alert_priority,
    primary_event_tag,
    sec_items,
    event_tags,
    filing_detail_url,
    primary_document_url,
    source_metadata,
    processing_status,
    form4_reported_purchase_value,
    form4_reported_sale_value,
    form4_tenb5_one_status,
    form4_has_reported_open_market_trade,
    candidate_bucket
  from deduplicated
  order by candidate_bucket_rank, feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc
  limit v_urgent_limit + v_priority_limit + v_preferred_limit + v_discovery_limit;
end;
$$;

create or replace function public.get_catalog_pulse_feed_status_v1(
  p_env text,
  p_since timestamptz,
  p_snapshot_at timestamptz default now()
)
returns table (
  new_filing_count integer,
  latest_filing_available_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, now());
  v_since timestamptz := coalesce(p_since, v_snapshot_at);
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;

  return query
  with active_catalog_companies as (
    select distinct company.sec_cik
    from public.ontology_catalog_releases release
    join public.ontology_companies company
      on company.env = release.env
     and company.release_id = release.release_id
    where release.env = v_env
      and release.active
      and company.sec_cik is not null
  )
  select
    least(count(*), 99)::integer as new_filing_count,
    max(event.feed_available_at) as latest_filing_available_at
  from public.sec_filing_events event
  join active_catalog_companies
    on active_catalog_companies.sec_cik = event.cik
  where event.env = v_env
    and event.feed_eligible
    and event.processing_status = 'ready'
    and event.feed_available_at > v_since
    and event.feed_available_at <= v_snapshot_at
    and (event.feed_expires_at is null or event.feed_expires_at > v_snapshot_at);
end;
$$;

revoke all on function public.get_catalog_pulse_filing_candidates_v2(text, timestamptz, text[], integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_catalog_pulse_filing_candidates_v2(text, timestamptz, text[], integer, integer, integer, integer)
  to service_role;

revoke all on function public.get_catalog_pulse_feed_status_v1(text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_catalog_pulse_feed_status_v1(text, timestamptz, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
