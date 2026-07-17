-- Global SEC filing event intake and deterministic processing queue, phase C.
--
-- Discovery only records metadata and queues work. It never downloads filing
-- documents, invokes an LLM, or creates a user notification in the same
-- transaction. That makes Atom, submissions JSON, and daily-index recovery
-- safe to overlap without producing duplicate feed items.

create table if not exists public.sec_filing_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  stage text not null,
  status text not null default 'queued',
  priority integer not null default 50,
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  worker_id text,
  claim_token uuid,
  lease_expires_at timestamptz,
  progress_json jsonb not null default '{}'::jsonb,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_filing_processing_jobs_stage_check
    check (stage in ('enrich', 'notification_fanout')),
  constraint sec_filing_processing_jobs_status_check
    check (status in ('queued', 'claimed', 'retry', 'completed', 'failed')),
  constraint sec_filing_processing_jobs_priority_check
    check (priority between 0 and 100),
  constraint sec_filing_processing_jobs_attempts_check
    check (attempts >= 0 and max_attempts between 1 and 20 and attempts <= max_attempts),
  constraint sec_filing_processing_jobs_error_length
    check (last_error is null or char_length(last_error) <= 2000),
  constraint sec_filing_processing_jobs_completed_check
    check ((status = 'completed') = (completed_at is not null)),
  constraint sec_filing_processing_jobs_unique_stage
    unique (env, filing_event_id, stage)
);

create index if not exists idx_sec_filing_processing_jobs_claim
  on public.sec_filing_processing_jobs (
    env,
    stage,
    priority desc,
    next_attempt_at asc,
    created_at asc
  )
  where status in ('queued', 'retry');

create index if not exists idx_sec_filing_processing_jobs_lease
  on public.sec_filing_processing_jobs (env, lease_expires_at)
  where status = 'claimed';

drop trigger if exists trg_sec_filing_processing_jobs_updated_at on public.sec_filing_processing_jobs;
create trigger trg_sec_filing_processing_jobs_updated_at
  before update on public.sec_filing_processing_jobs
  for each row execute function public.set_updated_at();

-- Record a candidate only when the current catalog release confirms the CIK.
-- The function is the atomic event/coverage/job boundary. A source can retry
-- the same candidate indefinitely without duplicating either a feed event or a
-- processing job.
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

  -- Lock the release while checking its CIK map. A catalog publish therefore
  -- cannot make a candidate appear under a partially changed release.
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
  -- Form 4 starts one lane behind material events until deterministic parsing
  -- determines whether it contains a reported P/S transaction.
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
  set -- Atom carries a useful low-latency hint, but submissions is the
      -- authoritative source for accepted_at and primary-document metadata.
      -- Never let an Atom feed's updated timestamp permanently become the
      -- event time when the reconciliation pass arrives later.
      filing_date = case
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
  on conflict (env, filing_event_id, stage) do update
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

create or replace function public.claim_sec_filing_processing_jobs(
  p_env text,
  p_worker_id text,
  p_stage text default null,
  p_limit integer default 10,
  p_lease_seconds integer default 180
)
returns table (
  id uuid,
  filing_event_id uuid,
  stage text,
  claim_token uuid,
  attempts integer,
  progress_json jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_worker_id text := trim(coalesce(p_worker_id, ''));
  v_stage text := nullif(trim(coalesce(p_stage, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 180), 900));
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;
  if v_worker_id = '' then
    raise exception 'p_worker_id is required';
  end if;
  if v_stage is not null and v_stage not in ('enrich', 'notification_fanout') then
    raise exception 'invalid filing processing stage';
  end if;

  return query
  with candidates as (
    select job.id
    from public.sec_filing_processing_jobs job
    where job.env = v_env
      and (v_stage is null or job.stage = v_stage)
      and job.attempts < job.max_attempts
      and (
        (job.status in ('queued', 'retry') and job.next_attempt_at <= now())
        or (job.status = 'claimed' and job.lease_expires_at <= now())
      )
    -- One priority point per five minutes prevents a continuous stream of
    -- newer high-priority events from starving a recoverable job.
    order by
      (job.priority + floor(extract(epoch from now() - job.created_at) / 300)::integer) desc,
      job.next_attempt_at asc,
      job.created_at asc
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.sec_filing_processing_jobs job
    set status = 'claimed',
        attempts = job.attempts + 1,
        worker_id = v_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.id, job.filing_event_id, job.stage, job.claim_token,
      job.attempts, job.progress_json
  )
  select * from claimed;
end;
$$;

create or replace function public.complete_sec_filing_discovery_checkpoint(
  p_env text,
  p_source_key text,
  p_worker_id text,
  p_claim_token uuid,
  p_watermark_at timestamptz,
  p_watermark_accession text,
  p_next_poll_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next_poll_seconds integer := greatest(15, least(coalesce(p_next_poll_seconds, 60), 900));
begin
  update public.sec_filing_discovery_checkpoints checkpoint
  set watermark_at = case
        when p_watermark_at is null then checkpoint.watermark_at
        when checkpoint.watermark_at is null or p_watermark_at > checkpoint.watermark_at then p_watermark_at
        else checkpoint.watermark_at
      end,
      watermark_accession = case
        when p_watermark_at is null then checkpoint.watermark_accession
        when checkpoint.watermark_at is null or p_watermark_at > checkpoint.watermark_at then p_watermark_accession
        when p_watermark_at = checkpoint.watermark_at then greatest(
          coalesce(checkpoint.watermark_accession, ''),
          coalesce(p_watermark_accession, '')
        )
        else checkpoint.watermark_accession
      end,
      next_poll_at = now() + make_interval(secs => v_next_poll_seconds),
      last_success_at = now(),
      consecutive_errors = 0,
      gap_risk = false,
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = now()
  where checkpoint.env = lower(trim(coalesce(p_env, '')))
    and checkpoint.source_key = p_source_key
    and checkpoint.worker_id = trim(coalesce(p_worker_id, ''))
    and checkpoint.claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.fail_sec_filing_discovery_checkpoint(
  p_env text,
  p_source_key text,
  p_worker_id text,
  p_claim_token uuid,
  p_error text,
  p_retry_after_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_error text := left(trim(coalesce(p_error, 'SEC discovery failed')), 2000);
  v_retry_seconds integer := greatest(30, least(coalesce(p_retry_after_seconds, 60), 3600));
begin
  update public.sec_filing_discovery_checkpoints checkpoint
  set next_poll_at = now() + make_interval(secs => greatest(
        v_retry_seconds,
        least(3600, 30 * power(2, least(checkpoint.consecutive_errors, 6))::integer)
      )),
      consecutive_errors = checkpoint.consecutive_errors + 1,
      gap_risk = true,
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      last_error = v_error,
      updated_at = now()
  where checkpoint.env = lower(trim(coalesce(p_env, '')))
    and checkpoint.source_key = p_source_key
    and checkpoint.worker_id = trim(coalesce(p_worker_id, ''))
    and checkpoint.claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.complete_catalog_sec_filing_reconciliation(
  p_env text,
  p_cik text,
  p_worker_id text,
  p_claim_token uuid,
  p_baseline_completed boolean,
  p_next_poll_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next_poll_seconds integer := greatest(60, least(coalesce(p_next_poll_seconds, 900), 86400));
begin
  update public.sec_catalog_filing_reconciliation_state state
  set baseline_completed_at = case
        when p_baseline_completed then coalesce(state.baseline_completed_at, now())
        else state.baseline_completed_at
      end,
      last_success_at = now(),
      next_poll_at = now() + make_interval(secs => v_next_poll_seconds),
      consecutive_errors = 0,
      last_error = null,
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where state.env = lower(trim(coalesce(p_env, '')))
    and state.cik = trim(coalesce(p_cik, ''))
    and state.worker_id = trim(coalesce(p_worker_id, ''))
    and state.claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.fail_catalog_sec_filing_reconciliation(
  p_env text,
  p_cik text,
  p_worker_id text,
  p_claim_token uuid,
  p_error text,
  p_retry_after_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_error text := left(trim(coalesce(p_error, 'SEC reconciliation failed')), 2000);
  v_retry_seconds integer := greatest(60, least(coalesce(p_retry_after_seconds, 300), 3600));
begin
  update public.sec_catalog_filing_reconciliation_state state
  set next_poll_at = now() + make_interval(secs => greatest(
        v_retry_seconds,
        least(3600, 60 * power(2, least(state.consecutive_errors, 5))::integer)
      )),
      consecutive_errors = state.consecutive_errors + 1,
      last_error = v_error,
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where state.env = lower(trim(coalesce(p_env, '')))
    and state.cik = trim(coalesce(p_cik, ''))
    and state.worker_id = trim(coalesce(p_worker_id, ''))
    and state.claim_token = p_claim_token;
  return found;
end;
$$;

alter table public.sec_filing_processing_jobs enable row level security;
revoke all on table public.sec_filing_processing_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.sec_filing_processing_jobs to service_role;

revoke all on function public.record_catalog_sec_filing_discovery(text, text, text, text, text, date, date, timestamptz, text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_sec_filing_processing_jobs(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_sec_filing_discovery_checkpoint(text, text, text, uuid, timestamptz, text, integer) from public, anon, authenticated;
revoke all on function public.fail_sec_filing_discovery_checkpoint(text, text, text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_catalog_sec_filing_reconciliation(text, text, text, uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.fail_catalog_sec_filing_reconciliation(text, text, text, uuid, text, integer) from public, anon, authenticated;

grant execute on function public.record_catalog_sec_filing_discovery(text, text, text, text, text, date, date, timestamptz, text, text, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.claim_sec_filing_processing_jobs(text, text, text, integer, integer) to service_role;
grant execute on function public.complete_sec_filing_discovery_checkpoint(text, text, text, uuid, timestamptz, text, integer) to service_role;
grant execute on function public.fail_sec_filing_discovery_checkpoint(text, text, text, uuid, text, integer) to service_role;
grant execute on function public.complete_catalog_sec_filing_reconciliation(text, text, text, uuid, boolean, integer) to service_role;
grant execute on function public.fail_catalog_sec_filing_reconciliation(text, text, text, uuid, text, integer) to service_role;
