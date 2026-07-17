-- `filing_event_id` is both the public RPC result name and a processing-job
-- column. In PL/pgSQL, the unqualified conflict target was therefore parsed as
-- an ambiguous output variable when the first live discovery ran. Keep the RPC
-- contract unchanged, but make the column preference and conflict constraint
-- explicit before any source can persist an event.

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
set search_path = public, pg_temp
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
  v_priority := case when v_event_family = 'insider_trade' then 65 else 75 end;

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
  returning event.id, event.cik, event.form_type, (xmax = 0)
    into v_event_id, v_event_cik, v_event_form, v_inserted;

  if v_event_id is null then
    select event.id, event.cik, event.form_type
      into v_event_id, v_event_cik, v_event_form
    from public.sec_filing_events event
    where event.env = v_env
      and event.accession_number = v_accession;
    raise exception 'accession % conflicts with stored filing (% / %, expected % / %)',
      v_accession, v_event_cik, v_event_form, v_cik, v_form;
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
      updated_at = now();

  return query select v_event_id, v_inserted;
end;
$$;
