-- Compact ontology catalog used by GCP web/API.
-- Full ontology SQLite indexes stay on the Mac worker release root.

create table if not exists public.ontology_catalog_releases (
  env text not null,
  release_id text not null,
  active boolean not null default false,
  format text not null,
  generated_at timestamptz,
  release_created_at timestamptz,
  index_generated_at timestamptz,
  company_count integer not null default 0,
  document_count integer not null default 0,
  index_document_count integer not null default 0,
  object_count integer not null default 0,
  manifest_json jsonb not null default '{}'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  source_json jsonb not null default '{}'::jsonb,
  catalog_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (env, release_id),
  constraint ontology_catalog_releases_env_check
    check (env in ('dev', 'staging', 'prod')),
  constraint ontology_catalog_releases_release_id_check
    check (length(trim(release_id)) > 0)
);

create unique index if not exists uq_ontology_catalog_releases_active_env
  on public.ontology_catalog_releases (env)
  where active;

create table if not exists public.ontology_companies (
  env text not null,
  release_id text not null,
  ticker text not null,
  name text not null,
  sector text,
  description text,
  latest_period text,
  document_count integer not null default 0,
  document_types text[] not null default '{}'::text[],
  periods text[] not null default '{}'::text[],
  coverage_json jsonb not null default '{}'::jsonb,
  documents_json jsonb not null default '[]'::jsonb,
  company_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (env, release_id, ticker),
  constraint ontology_companies_release_fk
    foreign key (env, release_id)
    references public.ontology_catalog_releases(env, release_id)
    on delete cascade,
  constraint ontology_companies_env_check
    check (env in ('dev', 'staging', 'prod')),
  constraint ontology_companies_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0)
);

create index if not exists idx_ontology_companies_env_release
  on public.ontology_companies (env, release_id, ticker);

create index if not exists idx_ontology_companies_ticker
  on public.ontology_companies (ticker);

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
set search_path = public
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
    if v_ticker = '' then
      raise exception 'catalog company ticker is required';
    end if;

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
      now()
    );
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

alter table public.ontology_catalog_releases enable row level security;
alter table public.ontology_companies enable row level security;

revoke all on table public.ontology_catalog_releases
  from public, anon, authenticated;
revoke all on table public.ontology_companies
  from public, anon, authenticated;

grant select, insert, update, delete on table public.ontology_catalog_releases
  to service_role;
grant select, insert, update, delete on table public.ontology_companies
  to service_role;

grant execute on function public.publish_ontology_web_catalog(jsonb)
  to service_role;
