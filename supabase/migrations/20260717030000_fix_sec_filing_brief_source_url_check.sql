-- PostgreSQL treats backslashes in ordinary string literals literally when
-- standard_conforming_strings is on. Use bracketed dots so the URL matcher is
-- unambiguous for both constraints and the RPC validation below.

alter table public.sec_filing_briefs
  drop constraint if exists sec_filing_briefs_source_url_check;

alter table public.sec_filing_briefs
  add constraint sec_filing_briefs_source_url_check
    check (source_document_url ~ '^https://www[.]sec[.]gov/Archives/');

alter table public.sec_filing_brief_runs
  drop constraint if exists sec_filing_brief_runs_source_url_check;

alter table public.sec_filing_brief_runs
  add constraint sec_filing_brief_runs_source_url_check
    check (source_document_url is null or source_document_url ~ '^https://www[.]sec[.]gov/Archives/');

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
  if p_source_document_url !~ '^https://www[.]sec[.]gov/Archives/'
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
    filing_event_id, locale, headline_ko, summary_sentences, facts,
    question_suggestions, uncertainty_notes, source_document_url, source_sha256,
    source_section_keys, source_truncated, input_char_count, generator_model,
    prompt_version, schema_version, generated_at
  )
  values (
    v_event.id, p_locale, trim(p_headline_ko), p_summary_sentences, p_facts,
    p_question_suggestions, p_uncertainty_notes, p_source_document_url,
    p_source_sha256, p_source_section_keys, coalesce(p_source_truncated, false),
    p_input_char_count, trim(p_generator_model), trim(p_prompt_version),
    p_schema_version, now()
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
    env, filing_event_id, job_id, outcome, model, prompt_version,
    schema_version, source_document_url, source_sha256, source_truncated,
    input_char_count, input_tokens, output_tokens, cache_read_input_tokens,
    provider_cost_usd, latency_ms
  )
  values (
    v_job.env, v_event.id, v_job.id, 'succeeded', trim(p_generator_model),
    trim(p_prompt_version), p_schema_version, p_source_document_url,
    p_source_sha256, coalesce(p_source_truncated, false), p_input_char_count,
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
