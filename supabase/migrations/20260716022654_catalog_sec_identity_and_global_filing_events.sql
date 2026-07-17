-- Global catalog SEC filing feed, phase A.
--
-- This is deliberately additive. Legacy subscription-driven filing delivery
-- keeps working until the global Pulse source cutover has completed.

alter table public.ontology_companies
  add column if not exists sec_cik text,
  add column if not exists sec_ticker text,
  add column if not exists sec_mapping_source text,
  add column if not exists sec_mapping_checked_at timestamptz;

alter table public.ontology_companies
  drop constraint if exists ontology_companies_sec_cik_check,
  add constraint ontology_companies_sec_cik_check
    check (sec_cik is null or sec_cik ~ '^[0-9]{10}$'),
  drop constraint if exists ontology_companies_sec_ticker_check,
  add constraint ontology_companies_sec_ticker_check
    check (sec_ticker is null or (sec_ticker = upper(sec_ticker) and sec_ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$')),
  drop constraint if exists ontology_companies_sec_mapping_source_check,
  add constraint ontology_companies_sec_mapping_source_check
    check (sec_mapping_source is null or sec_mapping_source in ('exact', 'verified_alias', 'catalog_native')),
  drop constraint if exists ontology_companies_sec_mapping_complete_check,
  add constraint ontology_companies_sec_mapping_complete_check
    check (
      (sec_cik is null and sec_ticker is null and sec_mapping_source is null and sec_mapping_checked_at is null)
      or
      (sec_cik is not null and sec_ticker is not null and sec_mapping_source is not null and sec_mapping_checked_at is not null)
    );

create index if not exists idx_ontology_companies_env_release_sec_cik
  on public.ontology_companies (env, release_id, sec_cik)
  where sec_cik is not null;

alter table public.sec_filing_events
  add column if not exists env text,
  add column if not exists event_family text,
  add column if not exists discovery_source text,
  add column if not exists processing_status text,
  add column if not exists feed_eligible boolean,
  add column if not exists feed_available_at timestamptz,
  add column if not exists feed_expires_at timestamptz,
  add column if not exists feed_lane smallint,
  add column if not exists feed_priority_rank smallint,
  add column if not exists occurred_at timestamptz,
  add column if not exists parser_version integer,
  add column if not exists original_filing_date date,
  add column if not exists processing_error text;

update public.sec_filing_events
set
  env = coalesce(nullif(env, ''), 'prod'),
  event_family = coalesce(nullif(event_family, ''), 'material_event'),
  discovery_source = coalesce(nullif(discovery_source, ''), 'legacy'),
  processing_status = coalesce(nullif(processing_status, ''), 'ready'),
  feed_eligible = coalesce(feed_eligible, false),
  occurred_at = coalesce(occurred_at, accepted_at, first_seen_at, created_at),
  parser_version = coalesce(parser_version, 1)
where
  env is null
  or event_family is null
  or discovery_source is null
  or processing_status is null
  or feed_eligible is null
  or occurred_at is null
  or parser_version is null;

alter table public.sec_filing_events
  alter column env set default 'prod',
  alter column env set not null,
  alter column event_family set default 'material_event',
  alter column event_family set not null,
  alter column discovery_source set default 'legacy',
  alter column discovery_source set not null,
  alter column processing_status set default 'discovered',
  alter column processing_status set not null,
  alter column feed_eligible set default false,
  alter column feed_eligible set not null,
  alter column occurred_at set not null,
  alter column parser_version set default 1,
  alter column parser_version set not null;

alter table public.sec_filing_events
  drop constraint if exists sec_filing_events_accession_number_key,
  add constraint sec_filing_events_env_accession_number_key unique (env, accession_number),
  drop constraint if exists sec_filing_events_env_check,
  add constraint sec_filing_events_env_check
    check (env in ('dev', 'staging', 'prod')),
  drop constraint if exists sec_filing_events_form_type_check,
  add constraint sec_filing_events_form_type_check
    check (form_type in ('8-K', '8-K/A', '6-K', '6-K/A', '4', '4/A')),
  drop constraint if exists sec_filing_events_event_family_check,
  add constraint sec_filing_events_event_family_check
    check (event_family in ('material_event', 'insider_trade')),
  drop constraint if exists sec_filing_events_event_family_form_check,
  add constraint sec_filing_events_event_family_form_check
    check (
      (form_type in ('4', '4/A') and event_family = 'insider_trade')
      or
      (form_type not in ('4', '4/A') and event_family = 'material_event')
    ),
  drop constraint if exists sec_filing_events_discovery_source_check,
  add constraint sec_filing_events_discovery_source_check
    check (discovery_source in ('legacy', 'atom', 'submissions', 'daily_index')),
  drop constraint if exists sec_filing_events_processing_status_check,
  add constraint sec_filing_events_processing_status_check
    check (processing_status in ('discovered', 'processing', 'ready', 'failed')),
  drop constraint if exists sec_filing_events_feed_window_check,
  add constraint sec_filing_events_feed_window_check
    check (feed_expires_at is null or feed_available_at is null or feed_expires_at > feed_available_at),
  drop constraint if exists sec_filing_events_processing_error_length,
  add constraint sec_filing_events_processing_error_length
    check (processing_error is null or char_length(processing_error) <= 2000),
  drop constraint if exists sec_filing_events_parser_version_check,
  add constraint sec_filing_events_parser_version_check
    check (parser_version >= 1);

create index if not exists idx_sec_filing_events_global_feed
  on public.sec_filing_events (env, feed_lane, feed_priority_rank, occurred_at desc, id)
  where feed_eligible and processing_status = 'ready';

create index if not exists idx_sec_filing_events_env_cik_occurred
  on public.sec_filing_events (env, cik, occurred_at desc, id);

-- The catalog publisher is an atomic boundary: a release cannot become active
-- unless each company already has a verified SEC identity.
create or replace function public.publish_ontology_web_catalog(p_catalog jsonb)
returns table (
  env text,
  release_id text,
  company_count integer,
  document_count integer,
  object_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_env text := lower(trim(coalesce(p_catalog->>'env', '')));
  v_release_id text := trim(coalesce(p_catalog->>'release_id', ''));
  v_format text := coalesce(p_catalog->>'format', '');
  v_summary jsonb := coalesce(p_catalog->'summary', '{}'::jsonb);
  v_release jsonb := coalesce(p_catalog->'release', '{}'::jsonb);
  v_source jsonb := coalesce(p_catalog->'source', '{}'::jsonb);
  v_generated_at timestamptz;
  v_release_created_at timestamptz;
  v_index_generated_at timestamptz;
  v_company jsonb;
  v_ticker text;
  v_sec_cik text;
  v_sec_ticker text;
  v_sec_mapping_source text;
  v_sec_mapping_checked_at timestamptz;
  v_document_count integer;
  v_company_count integer;
begin
  if v_format <> 'krw-ontology-web-catalog/v1' then
    raise exception 'unsupported web catalog format: %', v_format;
  end if;
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'catalog env must be dev, staging, or prod';
  end if;
  if v_release_id = '' then
    raise exception 'catalog release_id is required';
  end if;
  if jsonb_typeof(coalesce(p_catalog->'companies', '[]'::jsonb)) <> 'array' then
    raise exception 'catalog companies must be an array';
  end if;

  v_generated_at := nullif(p_catalog->>'generated_at', '')::timestamptz;
  v_release_created_at := nullif(v_release->>'created_at', '')::timestamptz;
  v_index_generated_at := nullif(v_release->>'index_generated_at', '')::timestamptz;

  -- Fail before any release row is changed if an input company lacks an audited
  -- CIK mapping. This prevents an active catalog without collection targets.
  for v_company in
    select value
    from jsonb_array_elements(coalesce(p_catalog->'companies', '[]'::jsonb))
  loop
    v_ticker := upper(trim(coalesce(v_company->>'ticker', '')));
    v_sec_cik := trim(coalesce(v_company->>'sec_cik', ''));
    v_sec_ticker := upper(trim(coalesce(v_company->>'sec_ticker', '')));
    v_sec_mapping_source := trim(coalesce(v_company->>'sec_mapping_source', ''));
    if v_ticker = '' then
      raise exception 'catalog company ticker is required';
    end if;
    if v_sec_cik !~ '^[0-9]{10}$' then
      raise exception 'catalog company % has no valid sec_cik', v_ticker;
    end if;
    if v_sec_ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,11}$' then
      raise exception 'catalog company % has no valid sec_ticker', v_ticker;
    end if;
    if v_sec_mapping_source not in ('exact', 'verified_alias', 'catalog_native') then
      raise exception 'catalog company % has invalid sec_mapping_source', v_ticker;
    end if;
    begin
      v_sec_mapping_checked_at := nullif(v_company->>'sec_mapping_checked_at', '')::timestamptz;
    exception when others then
      raise exception 'catalog company % has invalid sec_mapping_checked_at', v_ticker;
    end;
    if v_sec_mapping_checked_at is null then
      raise exception 'catalog company % has no sec_mapping_checked_at', v_ticker;
    end if;
  end loop;

  insert into public.ontology_catalog_releases (
    env,
    release_id,
    active,
    format,
    generated_at,
    release_created_at,
    index_generated_at,
    company_count,
    document_count,
    index_document_count,
    object_count,
    manifest_json,
    summary_json,
    source_json,
    catalog_json,
    updated_at
  )
  values (
    v_env,
    v_release_id,
    false,
    v_format,
    v_generated_at,
    v_release_created_at,
    v_index_generated_at,
    coalesce((v_summary->>'company_count')::integer, 0),
    coalesce((v_summary->>'document_count')::integer, 0),
    coalesce((v_summary->>'index_document_count')::integer, 0),
    coalesce((v_summary->>'object_count')::integer, 0),
    v_release,
    v_summary,
    v_source,
    p_catalog,
    now()
  )
  on conflict on constraint ontology_catalog_releases_pkey
  do update set
    active = false,
    format = excluded.format,
    generated_at = excluded.generated_at,
    release_created_at = excluded.release_created_at,
    index_generated_at = excluded.index_generated_at,
    company_count = excluded.company_count,
    document_count = excluded.document_count,
    index_document_count = excluded.index_document_count,
    object_count = excluded.object_count,
    manifest_json = excluded.manifest_json,
    summary_json = excluded.summary_json,
    source_json = excluded.source_json,
    catalog_json = excluded.catalog_json,
    updated_at = now();

  delete from public.ontology_companies
  where ontology_companies.env = v_env
    and ontology_companies.release_id = v_release_id;

  for v_company in
    select value
    from jsonb_array_elements(coalesce(p_catalog->'companies', '[]'::jsonb))
  loop
    v_ticker := upper(trim(coalesce(v_company->>'ticker', '')));
    v_sec_cik := trim(v_company->>'sec_cik');
    v_sec_ticker := upper(trim(v_company->>'sec_ticker'));
    v_sec_mapping_source := trim(v_company->>'sec_mapping_source');
    v_sec_mapping_checked_at := (v_company->>'sec_mapping_checked_at')::timestamptz;
    v_document_count := coalesce(
      nullif(v_company #>> '{coverage,document_count}', '')::integer,
      jsonb_array_length(coalesce(v_company->'documents', '[]'::jsonb))
    );

    insert into public.ontology_companies (
      env,
      release_id,
      ticker,
      name,
      sector,
      description,
      latest_period,
      document_count,
      document_types,
      periods,
      coverage_json,
      documents_json,
      company_json,
      generated_at,
      sec_cik,
      sec_ticker,
      sec_mapping_source,
      sec_mapping_checked_at,
      updated_at
    )
    values (
      v_env,
      v_release_id,
      v_ticker,
      coalesce(nullif(v_company->>'name', ''), v_ticker),
      nullif(v_company->>'sector', ''),
      nullif(v_company->>'description', ''),
      nullif(v_company->>'latest_period', ''),
      v_document_count,
      coalesce(
        array(
          select jsonb_array_elements_text(coalesce(v_company #> '{coverage,document_types}', '[]'::jsonb))
          order by 1
        ),
        '{}'::text[]
      ),
      coalesce(
        array(
          select jsonb_array_elements_text(coalesce(v_company #> '{coverage,periods}', '[]'::jsonb))
        ),
        '{}'::text[]
      ),
      coalesce(v_company->'coverage', '{}'::jsonb),
      coalesce(v_company->'documents', '[]'::jsonb),
      v_company,
      nullif(v_company->>'generated_at', '')::timestamptz,
      v_sec_cik,
      v_sec_ticker,
      v_sec_mapping_source,
      v_sec_mapping_checked_at,
      now()
    );

    insert into public.sec_company_identifiers (
      ticker,
      cik,
      company_name,
      lookup_status,
      last_checked_at,
      updated_at
    )
    values (
      v_ticker,
      v_sec_cik,
      coalesce(nullif(v_company->>'name', ''), v_ticker),
      'resolved',
      v_sec_mapping_checked_at,
      now()
    )
    on conflict (ticker) do update set
      cik = excluded.cik,
      company_name = excluded.company_name,
      lookup_status = 'resolved',
      last_checked_at = excluded.last_checked_at,
      updated_at = now();
  end loop;

  select count(*)
    into v_company_count
    from public.ontology_companies as c
    where c.env = v_env
      and c.release_id = v_release_id;

  update public.ontology_catalog_releases as r
    set active = false,
        updated_at = now()
    where r.env = v_env
      and r.release_id <> v_release_id
      and r.active = true;

  update public.ontology_catalog_releases as r
    set active = true,
        company_count = v_company_count,
        updated_at = now()
    where r.env = v_env
      and r.release_id = v_release_id;

  return query
  select
    r.env,
    r.release_id,
    r.company_count,
    r.document_count,
    r.object_count
  from public.ontology_catalog_releases as r
  where r.env = v_env
    and r.release_id = v_release_id;
end;
$$;

revoke all on function public.publish_ontology_web_catalog(jsonb) from public, anon, authenticated;
grant execute on function public.publish_ontology_web_catalog(jsonb) to service_role;
