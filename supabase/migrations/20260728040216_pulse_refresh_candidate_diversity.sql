-- A global Pulse reservoir must contain genuinely distinct ordinary filings.
-- Previously the discovery CTE re-read the same recent priority rows and the
-- final DISTINCT removed nearly all of it, which left a Form 4-heavy first
-- screen with little material for a device-local refresh to rotate into.
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
    where eligible.occurred_at >= bounds.snapshot_at - interval '14 days'
      -- Form 4 has a dedicated expandable stack. Discovery is the reserve of
      -- distinct, broadly useful filings that makes feed refresh meaningful.
      and coalesce(eligible.form_type, '') not in ('4', '4/A')
      and not exists (
        select 1 from urgent
        where urgent.filing_event_id = eligible.filing_event_id
      )
      and not exists (
        select 1 from priority
        where priority.filing_event_id = eligible.filing_event_id
      )
      and not exists (
        select 1 from preferred_limited
        where preferred_limited.filing_event_id = eligible.filing_event_id
      )
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

-- This is an internal service-role RPC. Keep the security-definer boundary
-- and explicit grants unchanged while replacing the query body.
revoke all on function public.get_pulse_global_filing_candidates_v1(text, timestamptz, text[], integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_pulse_global_filing_candidates_v1(text, timestamptz, text[], integer, integer, integer, integer)
  to service_role;

notify pgrst, 'reload schema';
