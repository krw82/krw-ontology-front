-- Keep target synchronization idempotent. The filing worker can safely call
-- this after a catalog release changes; unchanged targets must not generate a
-- heap/index update or WAL record on every worker tick.
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

  insert into public.sec_catalog_filing_reconciliation_state as state (
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
      updated_at = now()
  where state.enabled is distinct from true;
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

-- Synchronization is now release-driven by the worker. Claiming work must not
-- repeat the full catalog sync on every 15-second poll.
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

revoke all on function public.sync_catalog_sec_filing_reconciliation_targets(text)
  from public, anon, authenticated;
revoke all on function public.claim_catalog_sec_filing_reconciliation_targets(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.sync_catalog_sec_filing_reconciliation_targets(text) to service_role;
grant execute on function public.claim_catalog_sec_filing_reconciliation_targets(text, text, integer, integer)
  to service_role;

-- Discovery is intentionally idempotent. Rediscovery still refreshes a field
-- when the incoming value is better, but an identical candidate must not touch
-- the event or its processing job.
create or replace function public.record_catalog_sec_filing_discovery(
  p_env text,
  p_release_id text,
  p_cik text,
  p_accession_number text,
  p_form_type text,
  p_filing_date date,
  p_report_date date,
  p_accepted_at timestamptz,
  p_primary_document_name text,
  p_filing_detail_url text,
  p_primary_document_url text,
  p_source_metadata jsonb,
  p_discovery_source text,
  p_seen_at timestamptz default now()
)
returns table (filing_event_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
#variable_conflict use_column
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_release_id text := trim(coalesce(p_release_id, ''));
  v_cik text := trim(coalesce(p_cik, ''));
  v_accession text := trim(coalesce(p_accession_number, ''));
  v_form text := upper(trim(coalesce(p_form_type, '')));
  v_source text := lower(trim(coalesce(p_discovery_source, '')));
  v_ticker text;
  v_event_id uuid;
  v_event_cik text;
  v_event_form text;
  v_inserted boolean := false;
  v_catalog_company_count integer := 0;
  v_event_family text;
  v_priority integer;
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;
  if v_release_id = '' then
    raise exception 'p_release_id is required';
  end if;
  if v_cik !~ '^[0-9]{10}$' then
    raise exception 'invalid CIK';
  end if;
  if v_accession !~ '^\d{10}-\d{2}-\d{6}$' then
    raise exception 'invalid accession number';
  end if;
  if v_form not in ('8-K', '8-K/A', '6-K', '6-K/A', '4', '4/A') then
    raise exception 'unsupported filing form %', v_form;
  end if;
  if v_source not in ('atom', 'submissions', 'daily_index') then
    raise exception 'invalid discovery source';
  end if;
  if p_filing_date is null then
    raise exception 'p_filing_date is required';
  end if;
  if p_filing_detail_url is null or p_filing_detail_url !~ '^https://www\.sec\.gov/' then
    raise exception 'filing detail URL must be a SEC Archives URL';
  end if;
  if p_primary_document_url is not null and p_primary_document_url !~ '^https://www\.sec\.gov/' then
    raise exception 'primary document URL must be a SEC Archives URL';
  end if;

  perform 1
  from public.ontology_catalog_releases release
  where release.env = v_env
    and release.release_id = v_release_id
    and release.active
  for share;
  if not found then
    raise exception 'catalog release %/% is not active', v_env, v_release_id;
  end if;

  select count(*), min(company.ticker)
    into v_catalog_company_count, v_ticker
  from public.ontology_companies company
  where company.env = v_env
    and company.release_id = v_release_id
    and company.sec_cik = v_cik;
  if v_catalog_company_count = 0 or v_ticker is null then
    raise exception 'CIK % is not covered by active catalog release', v_cik;
  end if;

  v_event_family := case when v_form in ('4', '4/A') then 'insider_trade' else 'material_event' end;
  v_priority := 75;
  if coalesce(p_source_metadata ->> 'discoveryBaseline', 'false') = 'true' then
    v_priority := 55;
  end if;

  insert into public.sec_filing_events as event (
    env,
    ticker,
    cik,
    accession_number,
    form_type,
    is_amendment,
    filing_date,
    report_date,
    accepted_at,
    primary_document_name,
    filing_detail_url,
    primary_document_url,
    source_metadata,
    first_seen_at,
    event_family,
    discovery_source,
    processing_status,
    feed_eligible,
    occurred_at,
    parser_version,
    original_filing_date,
    enrichment_status
  )
  values (
    v_env,
    v_ticker,
    v_cik,
    v_accession,
    v_form,
    v_form like '%/A',
    p_filing_date,
    p_report_date,
    p_accepted_at,
    nullif(trim(coalesce(p_primary_document_name, '')), ''),
    p_filing_detail_url,
    nullif(trim(coalesce(p_primary_document_url, '')), ''),
    coalesce(p_source_metadata, '{}'::jsonb),
    coalesce(p_seen_at, now()),
    v_event_family,
    v_source,
    'discovered',
    false,
    coalesce(p_accepted_at, p_filing_date::timestamptz, p_seen_at, now()),
    1,
    p_filing_date,
    'queued'
  )
  on conflict (env, accession_number) do update
  set filing_date = case
        when excluded.discovery_source = 'submissions' then excluded.filing_date
        else event.filing_date
      end,
      report_date = coalesce(event.report_date, excluded.report_date),
      accepted_at = case
        when excluded.discovery_source = 'submissions' and excluded.accepted_at is not null
          then excluded.accepted_at
        else coalesce(event.accepted_at, excluded.accepted_at)
      end,
      primary_document_name = coalesce(event.primary_document_name, excluded.primary_document_name),
      primary_document_url = coalesce(event.primary_document_url, excluded.primary_document_url),
      occurred_at = case
        when excluded.discovery_source = 'submissions' and excluded.accepted_at is not null
          then excluded.accepted_at
        else event.occurred_at
      end,
      source_metadata = event.source_metadata || excluded.source_metadata,
      first_seen_at = least(event.first_seen_at, excluded.first_seen_at),
      discovery_source = case
        when event.discovery_source = 'daily_index' then event.discovery_source
        when excluded.discovery_source = 'daily_index' then excluded.discovery_source
        when event.discovery_source = 'submissions' then event.discovery_source
        else excluded.discovery_source
      end,
      updated_at = now()
  where event.cik = excluded.cik
    and event.form_type = excluded.form_type
    and (
      event.filing_date is distinct from case
        when excluded.discovery_source = 'submissions' then excluded.filing_date
        else event.filing_date
      end
      or event.report_date is distinct from coalesce(event.report_date, excluded.report_date)
      or event.accepted_at is distinct from case
        when excluded.discovery_source = 'submissions' and excluded.accepted_at is not null
          then excluded.accepted_at
        else coalesce(event.accepted_at, excluded.accepted_at)
      end
      or event.primary_document_name is distinct from coalesce(event.primary_document_name, excluded.primary_document_name)
      or event.primary_document_url is distinct from coalesce(event.primary_document_url, excluded.primary_document_url)
      or event.occurred_at is distinct from case
        when excluded.discovery_source = 'submissions' and excluded.accepted_at is not null
          then excluded.accepted_at
        else event.occurred_at
      end
      or event.source_metadata is distinct from (event.source_metadata || excluded.source_metadata)
      or event.first_seen_at is distinct from least(event.first_seen_at, excluded.first_seen_at)
      or event.discovery_source is distinct from case
        when event.discovery_source = 'daily_index' then event.discovery_source
        when excluded.discovery_source = 'daily_index' then excluded.discovery_source
        when event.discovery_source = 'submissions' then event.discovery_source
        else excluded.discovery_source
      end
    )
  returning event.id, event.cik, event.form_type, (xmax = 0)
    into v_event_id, v_event_cik, v_event_form, v_inserted;

  if v_event_id is null then
    select event.id, event.cik, event.form_type
      into v_event_id, v_event_cik, v_event_form
    from public.sec_filing_events event
    where event.env = v_env
      and event.accession_number = v_accession;
    if not found then
      raise exception 'failed to persist filing accession %', v_accession;
    end if;
    if v_event_cik <> v_cik or v_event_form <> v_form then
      raise exception 'accession % conflicts with stored filing (% / %, expected % / %)',
        v_accession, v_event_cik, v_event_form, v_cik, v_form;
    end if;
    v_inserted := false;
  end if;

  insert into public.sec_filing_event_catalog_coverage (
    filing_event_id,
    env,
    release_id,
    ticker
  )
  select v_event_id, v_env, v_release_id, company.ticker
  from public.ontology_companies company
  where company.env = v_env
    and company.release_id = v_release_id
    and company.sec_cik = v_cik
  on conflict do nothing;

  insert into public.sec_filing_processing_jobs as job (
    env,
    filing_event_id,
    stage,
    status,
    priority,
    next_attempt_at
  )
  values (v_env, v_event_id, 'enrich', 'queued', v_priority, now())
  on conflict on constraint sec_filing_processing_jobs_unique_stage do update
  set priority = greatest(job.priority, excluded.priority),
      next_attempt_at = least(job.next_attempt_at, excluded.next_attempt_at),
      status = case
        when job.status = 'completed' then job.status
        when job.status = 'claimed' and job.lease_expires_at > now() then job.status
        else 'queued'
      end,
      worker_id = case
        when job.status = 'claimed' and job.lease_expires_at > now() then job.worker_id
        else null
      end,
      claim_token = case
        when job.status = 'claimed' and job.lease_expires_at > now() then job.claim_token
        else null
      end,
      lease_expires_at = case
        when job.status = 'claimed' and job.lease_expires_at > now() then job.lease_expires_at
        else null
      end,
      last_error = case when job.status = 'completed' then job.last_error else null end,
      updated_at = now()
  where job.priority is distinct from greatest(job.priority, excluded.priority)
     or job.next_attempt_at is distinct from least(job.next_attempt_at, excluded.next_attempt_at)
     or job.status is distinct from case
          when job.status = 'completed' then job.status
          when job.status = 'claimed' and job.lease_expires_at > now() then job.status
          else 'queued'
        end
     or job.worker_id is distinct from case
          when job.status = 'claimed' and job.lease_expires_at > now() then job.worker_id
          else null
        end
     or job.claim_token is distinct from case
          when job.status = 'claimed' and job.lease_expires_at > now() then job.claim_token
          else null
        end
     or job.lease_expires_at is distinct from case
          when job.status = 'claimed' and job.lease_expires_at > now() then job.lease_expires_at
          else null
        end
     or job.last_error is distinct from case when job.status = 'completed' then job.last_error else null end;

  return query select v_event_id, v_inserted;
end;
$$;

revoke all on function public.record_catalog_sec_filing_discovery(
  text, text, text, text, text, date, date, timestamptz, text, text, text, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_catalog_sec_filing_discovery(
  text, text, text, text, text, date, date, timestamptz, text, text, text, jsonb, text, timestamptz
) to service_role;

-- The batch RPC keeps its public contract but performs one set-based event
-- upsert, one coverage insert, and one job upsert. Validation remains bounded
-- by the existing 100-candidate limit and happens before any write.
create or replace function public.record_catalog_sec_filing_discoveries(
  p_candidates jsonb
)
returns table (filing_event_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
  v_candidate record;
  v_conflict record;
begin
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'p_candidates must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_candidates);
  if v_count > 100 then
    raise exception 'p_candidates must contain at most 100 candidates';
  end if;
  if v_count = 0 then
    return;
  end if;

  create temporary table sec_discovery_batch (
    ordinal integer primary key,
    env text not null,
    release_id text not null,
    cik text not null,
    accession_number text not null,
    form_type text not null,
    filing_date date,
    report_date date,
    accepted_at timestamptz,
    primary_document_name text,
    filing_detail_url text,
    primary_document_url text,
    source_metadata jsonb not null,
    discovery_source text not null,
    seen_at timestamptz,
    ticker text,
    event_family text,
    priority integer
  ) on commit drop;

  insert into pg_temp.sec_discovery_batch (
    ordinal,
    env,
    release_id,
    cik,
    accession_number,
    form_type,
    filing_date,
    report_date,
    accepted_at,
    primary_document_name,
    filing_detail_url,
    primary_document_url,
    source_metadata,
    discovery_source,
    seen_at
  )
  select
    candidate.ordinal::integer,
    lower(trim(coalesce(candidate.value ->> 'env', ''))),
    trim(coalesce(candidate.value ->> 'release_id', '')),
    trim(coalesce(candidate.value ->> 'cik', '')),
    trim(coalesce(candidate.value ->> 'accession_number', '')),
    upper(trim(coalesce(candidate.value ->> 'form_type', ''))),
    nullif(candidate.value ->> 'filing_date', '')::date,
    nullif(candidate.value ->> 'report_date', '')::date,
    nullif(candidate.value ->> 'accepted_at', '')::timestamptz,
    nullif(trim(coalesce(candidate.value ->> 'primary_document_name', '')), ''),
    candidate.value ->> 'filing_detail_url',
    nullif(candidate.value ->> 'primary_document_url', ''),
    coalesce(candidate.value -> 'source_metadata', '{}'::jsonb),
    lower(trim(coalesce(candidate.value ->> 'discovery_source', ''))),
    nullif(candidate.value ->> 'seen_at', '')::timestamptz
  from jsonb_array_elements(p_candidates) with ordinality as candidate(value, ordinal);

  for v_candidate in
    select * from pg_temp.sec_discovery_batch order by ordinal
  loop
    if v_candidate.env not in ('dev', 'staging', 'prod') then
      raise exception 'invalid filing env';
    end if;
    if v_candidate.release_id = '' then
      raise exception 'p_release_id is required';
    end if;
    if v_candidate.cik !~ '^[0-9]{10}$' then
      raise exception 'invalid CIK';
    end if;
    if v_candidate.accession_number !~ '^\d{10}-\d{2}-\d{6}$' then
      raise exception 'invalid accession number';
    end if;
    if v_candidate.form_type not in ('8-K', '8-K/A', '6-K', '6-K/A', '4', '4/A') then
      raise exception 'unsupported filing form %', v_candidate.form_type;
    end if;
    if v_candidate.discovery_source not in ('atom', 'submissions', 'daily_index') then
      raise exception 'invalid discovery source';
    end if;
    if v_candidate.filing_date is null then
      raise exception 'p_filing_date is required';
    end if;
    if v_candidate.filing_detail_url is null
       or v_candidate.filing_detail_url !~ '^https://www\.sec\.gov/' then
      raise exception 'filing detail URL must be a SEC Archives URL';
    end if;
    if v_candidate.primary_document_url is not null
       and v_candidate.primary_document_url !~ '^https://www\.sec\.gov/' then
      raise exception 'primary document URL must be a SEC Archives URL';
    end if;
  end loop;

  if exists (
    select 1
    from pg_temp.sec_discovery_batch candidate
    group by candidate.env, candidate.accession_number
    having count(*) > 1
  ) then
    raise exception 'p_candidates contains duplicate environment/accession values';
  end if;

  if exists (
    select 1
    from pg_temp.sec_discovery_batch candidate
    left join public.ontology_catalog_releases release
      on release.env = candidate.env
     and release.release_id = candidate.release_id
     and release.active
    where release.release_id is null
  ) then
    select candidate.env, candidate.release_id
      into v_conflict
    from pg_temp.sec_discovery_batch candidate
    left join public.ontology_catalog_releases release
      on release.env = candidate.env
     and release.release_id = candidate.release_id
     and release.active
    where release.release_id is null
    order by candidate.ordinal
    limit 1;
    raise exception 'catalog release %/% is not active', v_conflict.env, v_conflict.release_id;
  end if;

  update pg_temp.sec_discovery_batch candidate
  set ticker = company.ticker,
      event_family = case
        when candidate.form_type in ('4', '4/A') then 'insider_trade'
        else 'material_event'
      end,
      priority = case
        when coalesce(candidate.source_metadata ->> 'discoveryBaseline', 'false') = 'true' then 55
        else 75
      end
  from public.ontology_companies company
  where company.env = candidate.env
    and company.release_id = candidate.release_id
    and company.sec_cik = candidate.cik;

  if exists (select 1 from pg_temp.sec_discovery_batch where ticker is null) then
    select candidate.cik
      into v_conflict
    from pg_temp.sec_discovery_batch candidate
    where candidate.ticker is null
    order by candidate.ordinal
    limit 1;
    raise exception 'CIK % is not covered by active catalog release', v_conflict.cik;
  end if;

  create temporary table sec_discovery_upserted (
    filing_event_id uuid primary key,
    inserted boolean not null
  ) on commit drop;

  with upserted as (
    insert into public.sec_filing_events as event (
      env,
      ticker,
      cik,
      accession_number,
      form_type,
      is_amendment,
      filing_date,
      report_date,
      accepted_at,
      primary_document_name,
      filing_detail_url,
      primary_document_url,
      source_metadata,
      first_seen_at,
      event_family,
      discovery_source,
      processing_status,
      feed_eligible,
      occurred_at,
      parser_version,
      original_filing_date,
      enrichment_status
    )
    select
      candidate.env,
      candidate.ticker,
      candidate.cik,
      candidate.accession_number,
      candidate.form_type,
      candidate.form_type like '%/A',
      candidate.filing_date,
      candidate.report_date,
      candidate.accepted_at,
      candidate.primary_document_name,
      candidate.filing_detail_url,
      candidate.primary_document_url,
      candidate.source_metadata,
      coalesce(candidate.seen_at, now()),
      candidate.event_family,
      candidate.discovery_source,
      'discovered',
      false,
      coalesce(candidate.accepted_at, candidate.filing_date::timestamptz, candidate.seen_at, now()),
      1,
      candidate.filing_date,
      'queued'
    from pg_temp.sec_discovery_batch candidate
    on conflict (env, accession_number) do update
    set filing_date = case
          when excluded.discovery_source = 'submissions' then excluded.filing_date
          else event.filing_date
        end,
        report_date = coalesce(event.report_date, excluded.report_date),
        accepted_at = case
          when excluded.discovery_source = 'submissions' and excluded.accepted_at is not null
            then excluded.accepted_at
          else coalesce(event.accepted_at, excluded.accepted_at)
        end,
        primary_document_name = coalesce(event.primary_document_name, excluded.primary_document_name),
        primary_document_url = coalesce(event.primary_document_url, excluded.primary_document_url),
        occurred_at = case
          when excluded.discovery_source = 'submissions' and excluded.accepted_at is not null
            then excluded.accepted_at
          else event.occurred_at
        end,
        source_metadata = event.source_metadata || excluded.source_metadata,
        first_seen_at = least(event.first_seen_at, excluded.first_seen_at),
        discovery_source = case
          when event.discovery_source = 'daily_index' then event.discovery_source
          when excluded.discovery_source = 'daily_index' then excluded.discovery_source
          when event.discovery_source = 'submissions' then event.discovery_source
          else excluded.discovery_source
        end,
        updated_at = now()
    where event.cik = excluded.cik
      and event.form_type = excluded.form_type
      and (
        event.filing_date is distinct from case
          when excluded.discovery_source = 'submissions' then excluded.filing_date
          else event.filing_date
        end
        or event.report_date is distinct from coalesce(event.report_date, excluded.report_date)
        or event.accepted_at is distinct from case
          when excluded.discovery_source = 'submissions' and excluded.accepted_at is not null
            then excluded.accepted_at
          else coalesce(event.accepted_at, excluded.accepted_at)
        end
        or event.primary_document_name is distinct from coalesce(event.primary_document_name, excluded.primary_document_name)
        or event.primary_document_url is distinct from coalesce(event.primary_document_url, excluded.primary_document_url)
        or event.occurred_at is distinct from case
          when excluded.discovery_source = 'submissions' and excluded.accepted_at is not null
            then excluded.accepted_at
          else event.occurred_at
        end
        or event.source_metadata is distinct from (event.source_metadata || excluded.source_metadata)
        or event.first_seen_at is distinct from least(event.first_seen_at, excluded.first_seen_at)
        or event.discovery_source is distinct from case
          when event.discovery_source = 'daily_index' then event.discovery_source
          when excluded.discovery_source = 'daily_index' then excluded.discovery_source
          when event.discovery_source = 'submissions' then event.discovery_source
          else excluded.discovery_source
        end
      )
    returning event.id as filing_event_id, (xmax = 0) as inserted
  )
  insert into pg_temp.sec_discovery_upserted (filing_event_id, inserted)
  select upserted.filing_event_id, upserted.inserted
  from upserted;

  select event.cik, event.form_type, candidate.cik as expected_cik,
         candidate.form_type as expected_form
    into v_conflict
  from pg_temp.sec_discovery_batch candidate
  join public.sec_filing_events event
    on event.env = candidate.env
   and event.accession_number = candidate.accession_number
  where event.cik <> candidate.cik
     or event.form_type <> candidate.form_type
  order by candidate.ordinal
  limit 1;
  if found then
    raise exception 'accession conflicts with stored filing (% / %, expected % / %)',
      v_conflict.cik, v_conflict.form_type, v_conflict.expected_cik, v_conflict.expected_form;
  end if;

  insert into public.sec_filing_event_catalog_coverage (
    filing_event_id,
    env,
    release_id,
    ticker
  )
  select event.id, candidate.env, candidate.release_id, candidate.ticker
  from pg_temp.sec_discovery_batch candidate
  join public.sec_filing_events event
    on event.env = candidate.env
   and event.accession_number = candidate.accession_number
  on conflict do nothing;

  insert into public.sec_filing_processing_jobs as job (
    env,
    filing_event_id,
    stage,
    status,
    priority,
    next_attempt_at
  )
  select event.env, event.id, 'enrich', 'queued', max(candidate.priority), now()
  from pg_temp.sec_discovery_batch candidate
  join public.sec_filing_events event
    on event.env = candidate.env
   and event.accession_number = candidate.accession_number
  group by event.env, event.id
  on conflict on constraint sec_filing_processing_jobs_unique_stage do update
  set priority = greatest(job.priority, excluded.priority),
      next_attempt_at = least(job.next_attempt_at, excluded.next_attempt_at),
      status = case
        when job.status = 'completed' then job.status
        when job.status = 'claimed' and job.lease_expires_at > now() then job.status
        else 'queued'
      end,
      worker_id = case
        when job.status = 'claimed' and job.lease_expires_at > now() then job.worker_id
        else null
      end,
      claim_token = case
        when job.status = 'claimed' and job.lease_expires_at > now() then job.claim_token
        else null
      end,
      lease_expires_at = case
        when job.status = 'claimed' and job.lease_expires_at > now() then job.lease_expires_at
        else null
      end,
      last_error = case when job.status = 'completed' then job.last_error else null end,
      updated_at = now()
  where job.priority is distinct from greatest(job.priority, excluded.priority)
     or job.next_attempt_at is distinct from least(job.next_attempt_at, excluded.next_attempt_at)
     or job.status is distinct from case
          when job.status = 'completed' then job.status
          when job.status = 'claimed' and job.lease_expires_at > now() then job.status
          else 'queued'
        end
     or job.worker_id is distinct from case
          when job.status = 'claimed' and job.lease_expires_at > now() then job.worker_id
          else null
        end
     or job.claim_token is distinct from case
          when job.status = 'claimed' and job.lease_expires_at > now() then job.claim_token
          else null
        end
     or job.lease_expires_at is distinct from case
          when job.status = 'claimed' and job.lease_expires_at > now() then job.lease_expires_at
          else null
        end
     or job.last_error is distinct from case when job.status = 'completed' then job.last_error else null end;

  return query
  select event.id,
         coalesce(upserted.inserted, false)
  from pg_temp.sec_discovery_batch candidate
  join public.sec_filing_events event
    on event.env = candidate.env
   and event.accession_number = candidate.accession_number
  left join pg_temp.sec_discovery_upserted upserted
    on upserted.filing_event_id = event.id
  order by candidate.ordinal;
end;
$$;

revoke all on function public.record_catalog_sec_filing_discoveries(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_catalog_sec_filing_discoveries(jsonb) to service_role;

notify pgrst, 'reload schema';
