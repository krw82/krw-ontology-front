-- Keep the global Pulse candidate set bounded to the active feed window.
-- Retaining every previously materialized candidate makes catalog publication
-- grow without bound and can exceed the PostgREST statement timeout.
create or replace function public.rebuild_pulse_global_filing_candidates(
  p_env text,
  p_snapshot_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, now());
  v_changed integer := 0;
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid pulse env';
  end if;

  with desired as materialized (
    select
      event.id as filing_event_id,
      event.ticker,
      coverage.covered_tickers,
      event.alert_priority,
      event.feed_priority_rank as priority_rank,
      event.occurred_at,
      event.feed_available_at as available_at,
      event.feed_expires_at as expires_at,
      jsonb_build_object(
        'ticker', event.ticker,
        'covered_tickers', coverage.covered_tickers,
        'form_type', event.form_type,
        'is_amendment', event.is_amendment,
        'first_seen_at', event.first_seen_at,
        'occurred_at', event.occurred_at,
        'feed_available_at', event.feed_available_at,
        'feed_expires_at', event.feed_expires_at,
        'alert_priority', event.alert_priority,
        'primary_event_tag', event.primary_event_tag,
        'sec_items', event.sec_items,
        'form4_reported_purchase_value', form4.reported_purchase_value,
        'form4_reported_sale_value', form4.reported_sale_value,
        'form4_tenb5_one_status', form4.tenb5_one_status,
        'form4_has_reported_open_market_trade', form4.has_reported_open_market_trade,
        'filing_brief_headline_ko', brief.headline_ko,
        'filing_brief_summary_sentences', brief.summary_sentences,
        'filing_brief_facts', brief.facts,
        'filing_brief_question_suggestions', brief.question_suggestions,
        'filing_brief_generated_at', brief.generated_at
      ) as payload
    from public.sec_filing_events event
    join public.ontology_catalog_releases release
      on release.env = event.env
     and release.active
    join lateral (
      select array_agg(company.ticker order by company.ticker) as covered_tickers
      from public.ontology_companies company
      where company.env = release.env
        and company.release_id = release.release_id
        and company.sec_cik = event.cik
    ) coverage on cardinality(coverage.covered_tickers) > 0
    left join public.sec_filing_briefs brief
      on brief.filing_event_id = event.id
     and brief.locale = 'ko-KR'
    left join public.sec_form4_event_summaries form4
      on form4.filing_event_id = event.id
    where event.env = v_env
      and event.feed_eligible
      and event.processing_status = 'ready'
      and event.feed_available_at is not null
      and event.feed_available_at <= v_snapshot_at
      and (event.feed_expires_at is null or event.feed_expires_at > v_snapshot_at)
      and event.occurred_at >= v_snapshot_at - interval '14 days'
  ),
  upserted as (
    insert into public.pulse_global_filing_candidates as candidate (
      env, filing_event_id, ticker, covered_tickers, alert_priority,
      priority_rank, occurred_at, available_at, expires_at, payload, candidate_updated_at
    )
    select
      v_env, desired.filing_event_id, desired.ticker, desired.covered_tickers,
      desired.alert_priority, desired.priority_rank, desired.occurred_at,
      desired.available_at, desired.expires_at, desired.payload, now()
    from desired
    on conflict (env, filing_event_id) do update
    set ticker = excluded.ticker,
        covered_tickers = excluded.covered_tickers,
        alert_priority = excluded.alert_priority,
        priority_rank = excluded.priority_rank,
        occurred_at = excluded.occurred_at,
        available_at = excluded.available_at,
        expires_at = excluded.expires_at,
        payload = excluded.payload,
        candidate_updated_at = excluded.candidate_updated_at
    where (candidate.ticker, candidate.covered_tickers, candidate.alert_priority,
           candidate.priority_rank, candidate.occurred_at, candidate.available_at,
           candidate.expires_at, candidate.payload)
      is distinct from
          (excluded.ticker, excluded.covered_tickers, excluded.alert_priority,
           excluded.priority_rank, excluded.occurred_at, excluded.available_at,
           excluded.expires_at, excluded.payload)
    returning filing_event_id
  ),
  removed as (
    delete from public.pulse_global_filing_candidates candidate
    where candidate.env = v_env
      and not exists (
        select 1
        from desired
        where desired.filing_event_id = candidate.filing_event_id
      )
    returning filing_event_id
  ),
  affected as (
    select filing_event_id from upserted
    union all
    select filing_event_id from removed
  )
  select count(*) into v_changed from affected;

  if v_changed > 0 then
    delete from public.pulse_global_candidate_tickers
    where env = v_env;

    insert into public.pulse_global_candidate_tickers (env, filing_event_id, ticker)
    select candidate.env, candidate.filing_event_id, ticker.ticker
    from public.pulse_global_filing_candidates candidate
    cross join lateral unnest(candidate.covered_tickers) as ticker(ticker)
    where candidate.env = v_env
    on conflict do nothing;

    perform public.bump_pulse_global_feed_revision(v_env);
  end if;

  return v_changed;
end;
$$;
