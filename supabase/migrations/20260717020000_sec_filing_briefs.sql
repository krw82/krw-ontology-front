-- Source-grounded, asynchronous Korean filing briefs for the catalog Pulse.
--
-- This deliberately extends the existing deterministic SEC pipeline instead
-- of placing an LLM in discovery or feed reads. A brief is created only after
-- enrichment is ready, and the stored result contains small cited excerpts,
-- never an SEC document body.

alter table public.sec_filing_processing_jobs
  drop constraint if exists sec_filing_processing_jobs_stage_check;

alter table public.sec_filing_processing_jobs
  add constraint sec_filing_processing_jobs_stage_check
    check (stage in ('enrich', 'notification_fanout', 'brief'));

create index if not exists idx_sec_filing_processing_jobs_brief_ready
  on public.sec_filing_processing_jobs (
    env,
    priority desc,
    next_attempt_at asc,
    created_at asc
  )
  where stage = 'brief' and status in ('queued', 'retry');

create table if not exists public.sec_filing_briefs (
  filing_event_id uuid primary key references public.sec_filing_events(id) on delete cascade,
  locale text not null default 'ko-KR',
  headline_ko text not null,
  summary_sentences jsonb not null,
  facts jsonb not null,
  question_suggestions jsonb not null default '[]'::jsonb,
  uncertainty_notes jsonb not null default '[]'::jsonb,
  source_document_url text not null,
  source_sha256 text not null,
  source_section_keys text[] not null,
  source_truncated boolean not null default false,
  input_char_count integer not null,
  generator_model text not null,
  prompt_version text not null,
  schema_version integer not null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_filing_briefs_locale_check
    check (locale = 'ko-KR'),
  constraint sec_filing_briefs_headline_length
    check (char_length(trim(headline_ko)) between 1 and 240),
  constraint sec_filing_briefs_summary_shape
    check (jsonb_typeof(summary_sentences) = 'array' and jsonb_array_length(summary_sentences) between 1 and 2),
  constraint sec_filing_briefs_facts_shape
    check (jsonb_typeof(facts) = 'array' and jsonb_array_length(facts) between 1 and 4),
  constraint sec_filing_briefs_questions_shape
    check (jsonb_typeof(question_suggestions) = 'array' and jsonb_array_length(question_suggestions) <= 2),
  constraint sec_filing_briefs_uncertainties_shape
    check (jsonb_typeof(uncertainty_notes) = 'array' and jsonb_array_length(uncertainty_notes) <= 3),
  constraint sec_filing_briefs_source_url_check
    check (source_document_url ~ '^https://www\\.sec\\.gov/Archives/'),
  constraint sec_filing_briefs_source_sha256_check
    check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sec_filing_briefs_sections_check
    check (cardinality(source_section_keys) between 1 and 4),
  constraint sec_filing_briefs_input_char_count_check
    check (input_char_count between 1 and 100000),
  constraint sec_filing_briefs_model_length
    check (char_length(trim(generator_model)) between 1 and 160),
  constraint sec_filing_briefs_prompt_version_length
    check (char_length(trim(prompt_version)) between 1 and 80),
  constraint sec_filing_briefs_schema_version_check
    check (schema_version between 1 and 1000)
);

drop trigger if exists trg_sec_filing_briefs_updated_at on public.sec_filing_briefs;
create trigger trg_sec_filing_briefs_updated_at
  before update on public.sec_filing_briefs
  for each row execute function public.set_updated_at();

create index if not exists idx_sec_filing_briefs_generated_at
  on public.sec_filing_briefs (generated_at desc);

create table if not exists public.sec_filing_brief_runs (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  job_id uuid references public.sec_filing_processing_jobs(id) on delete set null,
  outcome text not null,
  model text not null,
  prompt_version text not null,
  schema_version integer not null,
  source_document_url text,
  source_sha256 text,
  source_truncated boolean,
  input_char_count integer,
  input_tokens integer,
  output_tokens integer,
  cache_read_input_tokens integer,
  provider_cost_usd numeric(14, 8),
  latency_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint sec_filing_brief_runs_outcome_check
    check (outcome in ('succeeded', 'failed', 'validation_failed')),
  constraint sec_filing_brief_runs_model_length
    check (char_length(trim(model)) between 1 and 160),
  constraint sec_filing_brief_runs_prompt_version_length
    check (char_length(trim(prompt_version)) between 1 and 80),
  constraint sec_filing_brief_runs_schema_version_check
    check (schema_version between 1 and 1000),
  constraint sec_filing_brief_runs_source_url_check
    check (source_document_url is null or source_document_url ~ '^https://www\\.sec\\.gov/Archives/'),
  constraint sec_filing_brief_runs_source_sha256_check
    check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sec_filing_brief_runs_counts_check
    check (
      (input_char_count is null or input_char_count between 1 and 100000)
      and (input_tokens is null or input_tokens >= 0)
      and (output_tokens is null or output_tokens >= 0)
      and (cache_read_input_tokens is null or cache_read_input_tokens >= 0)
      and (provider_cost_usd is null or provider_cost_usd >= 0)
      and (latency_ms is null or latency_ms >= 0)
    ),
  constraint sec_filing_brief_runs_error_length
    check (error_code is null or char_length(error_code) <= 120),
  constraint sec_filing_brief_runs_error_message_length
    check (error_message is null or char_length(error_message) <= 1200)
);

create index if not exists idx_sec_filing_brief_runs_event_created
  on public.sec_filing_brief_runs (filing_event_id, created_at desc);

create index if not exists idx_sec_filing_brief_runs_outcome_created
  on public.sec_filing_brief_runs (env, outcome, created_at desc);

-- Queue only newly-ready narrative filings. Initial catalog baseline entries
-- remain discovery-only, and Form 4 continues through its deterministic
-- parser / stack-card path without an LLM call.
create or replace function public.enqueue_sec_filing_brief_after_enrichment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.enrichment_status = 'ready'
    and old.enrichment_status is distinct from 'ready'
    and new.feed_eligible
    and new.form_type in ('8-K', '8-K/A', '6-K', '6-K/A')
    and coalesce(new.source_metadata ->> 'discoveryBaseline', 'false') <> 'true' then
    insert into public.sec_filing_processing_jobs as job (
      env,
      filing_event_id,
      stage,
      status,
      priority,
      max_attempts,
      next_attempt_at
    )
    values (
      new.env,
      new.id,
      'brief',
      'queued',
      case when new.alert_priority = 'urgent' then 82 when new.alert_priority = 'normal' then 72 else 60 end,
      3,
      now()
    )
    on conflict (env, filing_event_id, stage) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_sec_filing_brief_after_enrichment on public.sec_filing_events;
create trigger trg_enqueue_sec_filing_brief_after_enrichment
  after update of enrichment_status on public.sec_filing_events
  for each row execute function public.enqueue_sec_filing_brief_after_enrichment();

-- Operator-only bounded backfill / shadow-generation entry point. It does not
-- retrieve document text and cannot enqueue Form 4 or initial baseline data.
create or replace function public.enqueue_ready_sec_filing_brief_jobs(
  p_env text,
  p_limit integer default 100
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 1000));
  v_inserted bigint := 0;
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;

  with candidates as (
    select event.id, event.alert_priority
    from public.sec_filing_events event
    where event.env = v_env
      and event.enrichment_status = 'ready'
      and event.feed_eligible
      and event.form_type in ('8-K', '8-K/A', '6-K', '6-K/A')
      and coalesce(event.source_metadata ->> 'discoveryBaseline', 'false') <> 'true'
      and not exists (
        select 1
        from public.sec_filing_processing_jobs job
        where job.env = event.env
          and job.filing_event_id = event.id
          and job.stage = 'brief'
      )
    order by event.occurred_at desc, event.id desc
    limit v_limit
    for update skip locked
  ), inserted as (
    insert into public.sec_filing_processing_jobs (
      env,
      filing_event_id,
      stage,
      status,
      priority,
      max_attempts,
      next_attempt_at
    )
    select
      v_env,
      candidates.id,
      'brief',
      'queued',
      case when candidates.alert_priority = 'urgent' then 82 when candidates.alert_priority = 'normal' then 72 else 60 end,
      3,
      now()
    from candidates
    on conflict (env, filing_event_id, stage) do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

-- Retain the current lease recovery behavior while admitting the additive
-- brief stage. Workers continue to use the same transactional claim boundary.
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
#variable_conflict use_column
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
  if v_stage is not null and v_stage not in ('enrich', 'notification_fanout', 'brief') then
    raise exception 'invalid filing processing stage';
  end if;

  update public.sec_filing_processing_jobs job
  set status = 'retry',
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      next_attempt_at = now(),
      last_error = coalesce(job.last_error, 'SEC filing processing lease expired'),
      updated_at = now()
  where job.env = v_env
    and (v_stage is null or job.stage = v_stage)
    and job.status = 'claimed'
    and job.lease_expires_at <= now();

  return query
  with candidates as (
    select job.id
    from public.sec_filing_processing_jobs job
    where job.env = v_env
      and (v_stage is null or job.stage = v_stage)
      and job.status in ('queued', 'retry')
      and job.attempts < job.max_attempts
      and job.next_attempt_at <= now()
    order by job.priority desc, job.created_at desc, job.next_attempt_at asc
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
    returning job.id, job.filing_event_id, job.stage, job.claim_token, job.attempts, job.progress_json
  )
  select * from claimed;
end;
$$;

create or replace function public.complete_sec_filing_brief(
  p_job_id uuid,
  p_claim_token uuid,
  p_locale text,
  p_headline_ko text,
  p_summary_sentences jsonb,
  p_facts jsonb,
  p_question_suggestions jsonb,
  p_uncertainty_notes jsonb,
  p_source_document_url text,
  p_source_sha256 text,
  p_source_section_keys text[],
  p_source_truncated boolean,
  p_input_char_count integer,
  p_generator_model text,
  p_prompt_version text,
  p_schema_version integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_input_tokens integer,
  p_provider_cost_usd numeric,
  p_latency_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.sec_filing_processing_jobs%rowtype;
  v_event public.sec_filing_events%rowtype;
begin
  select job.* into v_job
  from public.sec_filing_processing_jobs job
  where job.id = p_job_id
    and job.stage = 'brief'
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > now()
  for update;
  if not found then
    return false;
  end if;

  select event.* into v_event
  from public.sec_filing_events event
  where event.id = v_job.filing_event_id
  for share;
  if not found then
    raise exception 'filing event for brief job % does not exist', p_job_id;
  end if;
  if v_event.form_type not in ('8-K', '8-K/A', '6-K', '6-K/A') then
    raise exception 'filing brief is only available for 8-K and 6-K filings';
  end if;
  if p_locale <> 'ko-KR' then
    raise exception 'unsupported filing brief locale';
  end if;
  if char_length(trim(coalesce(p_headline_ko, ''))) not between 1 and 240 then
    raise exception 'invalid filing brief headline';
  end if;
  if jsonb_typeof(coalesce(p_summary_sentences, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_summary_sentences) not between 1 and 2 then
    raise exception 'invalid filing brief summary';
  end if;
  if jsonb_typeof(coalesce(p_facts, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_facts) not between 1 and 4 then
    raise exception 'invalid filing brief facts';
  end if;
  if jsonb_typeof(coalesce(p_question_suggestions, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_question_suggestions) > 2 then
    raise exception 'invalid filing brief questions';
  end if;
  if jsonb_typeof(coalesce(p_uncertainty_notes, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_uncertainty_notes) > 3 then
    raise exception 'invalid filing brief uncertainty notes';
  end if;
  if p_source_document_url !~ '^https://www\\.sec\\.gov/Archives/'
    or p_source_sha256 !~ '^[0-9a-f]{64}$'
    or cardinality(p_source_section_keys) not between 1 and 4
    or p_input_char_count not between 1 and 100000 then
    raise exception 'invalid filing brief source metadata';
  end if;
  if char_length(trim(coalesce(p_generator_model, ''))) not between 1 and 160
    or char_length(trim(coalesce(p_prompt_version, ''))) not between 1 and 80
    or coalesce(p_schema_version, 0) not between 1 and 1000 then
    raise exception 'invalid filing brief generator metadata';
  end if;

  insert into public.sec_filing_briefs as brief (
    filing_event_id,
    locale,
    headline_ko,
    summary_sentences,
    facts,
    question_suggestions,
    uncertainty_notes,
    source_document_url,
    source_sha256,
    source_section_keys,
    source_truncated,
    input_char_count,
    generator_model,
    prompt_version,
    schema_version,
    generated_at
  )
  values (
    v_event.id,
    p_locale,
    trim(p_headline_ko),
    p_summary_sentences,
    p_facts,
    p_question_suggestions,
    p_uncertainty_notes,
    p_source_document_url,
    p_source_sha256,
    p_source_section_keys,
    coalesce(p_source_truncated, false),
    p_input_char_count,
    trim(p_generator_model),
    trim(p_prompt_version),
    p_schema_version,
    now()
  )
  on conflict (filing_event_id) do update
  set locale = excluded.locale,
      headline_ko = excluded.headline_ko,
      summary_sentences = excluded.summary_sentences,
      facts = excluded.facts,
      question_suggestions = excluded.question_suggestions,
      uncertainty_notes = excluded.uncertainty_notes,
      source_document_url = excluded.source_document_url,
      source_sha256 = excluded.source_sha256,
      source_section_keys = excluded.source_section_keys,
      source_truncated = excluded.source_truncated,
      input_char_count = excluded.input_char_count,
      generator_model = excluded.generator_model,
      prompt_version = excluded.prompt_version,
      schema_version = excluded.schema_version,
      generated_at = excluded.generated_at,
      updated_at = now();

  insert into public.sec_filing_brief_runs (
    env,
    filing_event_id,
    job_id,
    outcome,
    model,
    prompt_version,
    schema_version,
    source_document_url,
    source_sha256,
    source_truncated,
    input_char_count,
    input_tokens,
    output_tokens,
    cache_read_input_tokens,
    provider_cost_usd,
    latency_ms
  )
  values (
    v_job.env,
    v_event.id,
    v_job.id,
    'succeeded',
    trim(p_generator_model),
    trim(p_prompt_version),
    p_schema_version,
    p_source_document_url,
    p_source_sha256,
    coalesce(p_source_truncated, false),
    p_input_char_count,
    greatest(0, coalesce(p_input_tokens, 0)),
    greatest(0, coalesce(p_output_tokens, 0)),
    greatest(0, coalesce(p_cache_read_input_tokens, 0)),
    greatest(0, coalesce(p_provider_cost_usd, 0)),
    greatest(0, coalesce(p_latency_ms, 0))
  );

  update public.sec_filing_processing_jobs job
  set status = 'completed',
      completed_at = now(),
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = now()
  where job.id = v_job.id
    and job.claim_token = p_claim_token;

  return found;
end;
$$;

create or replace function public.record_sec_filing_brief_failure(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_model text,
  p_prompt_version text,
  p_schema_version integer,
  p_source_document_url text default null,
  p_source_sha256 text default null,
  p_source_truncated boolean default null,
  p_input_char_count integer default null,
  p_latency_ms integer default null,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.sec_filing_processing_jobs%rowtype;
begin
  select job.* into v_job
  from public.sec_filing_processing_jobs job
  where job.id = p_job_id
    and job.stage = 'brief'
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > now()
  for share;
  if not found then
    return false;
  end if;
  if p_outcome not in ('failed', 'validation_failed') then
    raise exception 'invalid filing brief failure outcome';
  end if;

  insert into public.sec_filing_brief_runs (
    env,
    filing_event_id,
    job_id,
    outcome,
    model,
    prompt_version,
    schema_version,
    source_document_url,
    source_sha256,
    source_truncated,
    input_char_count,
    latency_ms,
    error_code,
    error_message
  )
  values (
    v_job.env,
    v_job.filing_event_id,
    v_job.id,
    p_outcome,
    left(trim(coalesce(p_model, 'unknown')), 160),
    left(trim(coalesce(p_prompt_version, 'unknown')), 80),
    greatest(1, least(coalesce(p_schema_version, 1), 1000)),
    p_source_document_url,
    p_source_sha256,
    p_source_truncated,
    p_input_char_count,
    greatest(0, coalesce(p_latency_ms, 0)),
    nullif(left(trim(coalesce(p_error_code, 'unknown')), 120), ''),
    nullif(left(trim(coalesce(p_error_message, 'brief generation failed')), 1200), '')
  );
  return true;
end;
$$;

-- v3 is additive so a web image can fall back to v2 while PostgREST reloads
-- its schema cache. The Pulse path reads this joined result only; it never
-- calls a model or downloads an SEC body.
create or replace function public.get_catalog_pulse_filing_candidates_v3(
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
  candidate_bucket text,
  filing_brief_headline_ko text,
  filing_brief_summary_sentences jsonb,
  filing_brief_facts jsonb,
  filing_brief_question_suggestions jsonb,
  filing_brief_source_document_url text,
  filing_brief_generated_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    candidate.filing_event_id,
    candidate.ticker,
    candidate.covered_tickers,
    candidate.cik,
    candidate.accession_number,
    candidate.form_type,
    candidate.is_amendment,
    candidate.filing_date,
    candidate.report_date,
    candidate.accepted_at,
    candidate.first_seen_at,
    candidate.occurred_at,
    candidate.feed_available_at,
    candidate.feed_expires_at,
    candidate.feed_lane,
    candidate.feed_priority_rank,
    candidate.alert_priority,
    candidate.primary_event_tag,
    candidate.sec_items,
    candidate.event_tags,
    candidate.filing_detail_url,
    candidate.primary_document_url,
    candidate.source_metadata,
    candidate.processing_status,
    candidate.form4_reported_purchase_value,
    candidate.form4_reported_sale_value,
    candidate.form4_tenb5_one_status,
    candidate.form4_has_reported_open_market_trade,
    candidate.candidate_bucket,
    brief.headline_ko,
    brief.summary_sentences,
    brief.facts,
    brief.question_suggestions,
    brief.source_document_url,
    brief.generated_at
  from public.get_catalog_pulse_filing_candidates_v2(
    p_env,
    p_snapshot_at,
    p_preferred_tickers,
    p_urgent_limit,
    p_priority_limit,
    p_preferred_limit,
    p_discovery_limit
  ) candidate
  left join public.sec_filing_briefs brief
    on brief.filing_event_id = candidate.filing_event_id
   and brief.locale = 'ko-KR';
$$;

alter table public.sec_filing_briefs enable row level security;
alter table public.sec_filing_brief_runs enable row level security;

revoke all on table public.sec_filing_briefs from public, anon, authenticated;
revoke all on table public.sec_filing_brief_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.sec_filing_briefs to service_role;
grant select, insert, update, delete on table public.sec_filing_brief_runs to service_role;

revoke all on function public.enqueue_ready_sec_filing_brief_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.complete_sec_filing_brief(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, text, text, text[], boolean, integer, text, text, integer, integer, integer, integer, numeric, integer) from public, anon, authenticated;
revoke all on function public.record_sec_filing_brief_failure(uuid, uuid, text, text, text, integer, text, text, boolean, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.get_catalog_pulse_filing_candidates_v3(text, timestamptz, text[], integer, integer, integer, integer) from public, anon, authenticated;

grant execute on function public.enqueue_ready_sec_filing_brief_jobs(text, integer) to service_role;
grant execute on function public.complete_sec_filing_brief(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, text, text, text[], boolean, integer, text, text, integer, integer, integer, integer, numeric, integer) to service_role;
grant execute on function public.record_sec_filing_brief_failure(uuid, uuid, text, text, text, integer, text, text, boolean, integer, integer, text, text) to service_role;
grant execute on function public.get_catalog_pulse_filing_candidates_v3(text, timestamptz, text[], integer, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
