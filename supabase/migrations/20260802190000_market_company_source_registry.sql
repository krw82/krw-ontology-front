begin;

create table if not exists public.market_company_source_registry (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  release_id text not null,
  ticker text not null,
  company_name text not null,
  sec_cik text,
  sec_ticker text,
  coverage_status text not null default 'filing_only'
    check (coverage_status in ('official_plus_filing', 'official_only', 'filing_only', 'unmapped')),
  polling_tier text not null default 'filing_only'
    check (polling_tier in ('priority', 'standard', 'long_tail', 'filing_only', 'unmapped')),
  desired_poll_interval_seconds integer
    check (desired_poll_interval_seconds is null or desired_poll_interval_seconds between 60 and 86400),
  official_source_count integer not null default 0 check (official_source_count >= 0),
  active boolean not null default true,
  retired_at timestamptz,
  last_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (env, release_id, ticker)
);

create index if not exists market_company_source_registry_active_idx
  on public.market_company_source_registry (env, active, polling_tier, ticker);

create index if not exists market_company_source_registry_status_idx
  on public.market_company_source_registry (env, coverage_status, official_source_count desc, ticker);

create table if not exists public.market_company_source_registry_links (
  registry_id uuid not null references public.market_company_source_registry(id) on delete cascade,
  source_id uuid not null references public.market_issue_sources(id) on delete cascade,
  coverage_role text not null check (coverage_role in ('filing', 'official')),
  created_at timestamptz not null default now(),
  primary key (registry_id, source_id, coverage_role)
);

create index if not exists market_company_source_registry_links_source_idx
  on public.market_company_source_registry_links (source_id, coverage_role);

alter table public.market_company_source_registry enable row level security;
alter table public.market_company_source_registry_links enable row level security;

grant all privileges on table public.market_company_source_registry to service_role;
grant all privileges on table public.market_company_source_registry_links to service_role;

create or replace function public.refresh_market_company_source_registry(
  p_environment text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release_id text;
  v_filing_source_id uuid;
  v_refreshed_count integer := 0;
begin
  if p_environment not in ('dev', 'staging', 'prod') then
    raise exception 'invalid market issue environment: %', p_environment;
  end if;

  select release_id
  into v_release_id
  from public.ontology_catalog_releases
  where env = p_environment
    and active = true
  order by updated_at desc
  limit 1;

  if v_release_id is null then
    raise exception 'active ontology release is required for environment: %', p_environment;
  end if;

  select id
  into v_filing_source_id
  from public.market_issue_sources
  where env = p_environment
    and active = true
    and source_type = 'sec'
    and adapter_type = 'sec_catalog'
  order by priority desc, updated_at desc
  limit 1;

  with official_sources as (
    select
      upper(tag.value) as ticker,
      count(distinct source.id)::integer as source_count,
      max(source.priority) as max_priority,
      min(source.poll_interval_seconds) as min_poll_interval_seconds
    from public.market_issue_sources source
    cross join lateral unnest(coalesce(source.source_tags, array[]::text[])) as tag(value)
    where source.env = p_environment
      and source.active = true
      and source.source_type = 'web'
      and source.source_class = 'company_official'
    group by upper(tag.value)
  )
  insert into public.market_company_source_registry (
    env,
    release_id,
    ticker,
    company_name,
    sec_cik,
    sec_ticker,
    coverage_status,
    polling_tier,
    desired_poll_interval_seconds,
    official_source_count,
    active,
    retired_at,
    last_refreshed_at,
    updated_at
  )
  select
    p_environment,
    v_release_id,
    company.ticker,
    coalesce(nullif(company.name, ''), company.ticker),
    company.sec_cik,
    company.sec_ticker,
    case
      when coalesce(official.source_count, 0) > 0 and v_filing_source_id is not null then 'official_plus_filing'
      when coalesce(official.source_count, 0) > 0 then 'official_only'
      when v_filing_source_id is not null and company.sec_cik is not null then 'filing_only'
      else 'unmapped'
    end,
    case
      when coalesce(official.max_priority, 0) >= 90 then 'priority'
      when coalesce(official.source_count, 0) > 0 then 'standard'
      when v_filing_source_id is not null and company.sec_cik is not null then 'filing_only'
      else 'unmapped'
    end,
    case
      when coalesce(official.source_count, 0) > 0 then official.min_poll_interval_seconds
      when v_filing_source_id is not null and company.sec_cik is not null then 300
      else null
    end,
    coalesce(official.source_count, 0),
    true,
    null,
    now(),
    now()
  from public.ontology_companies company
  left join official_sources official
    on official.ticker = company.ticker
  where company.env = p_environment
    and company.release_id = v_release_id
  on conflict (env, release_id, ticker) do update
    set company_name = excluded.company_name,
        sec_cik = excluded.sec_cik,
        sec_ticker = excluded.sec_ticker,
        coverage_status = excluded.coverage_status,
        polling_tier = excluded.polling_tier,
        desired_poll_interval_seconds = excluded.desired_poll_interval_seconds,
        official_source_count = excluded.official_source_count,
        active = true,
        retired_at = null,
        last_refreshed_at = excluded.last_refreshed_at,
        updated_at = excluded.updated_at;

  get diagnostics v_refreshed_count = row_count;

  update public.market_company_source_registry
  set active = false,
      retired_at = coalesce(retired_at, now()),
      updated_at = now()
  where env = p_environment
    and release_id <> v_release_id
    and active = true;

  delete from public.market_company_source_registry_links link
  using public.market_company_source_registry registry
  where link.registry_id = registry.id
    and registry.env = p_environment
    and registry.release_id = v_release_id;

  if v_filing_source_id is not null then
    insert into public.market_company_source_registry_links (registry_id, source_id, coverage_role)
    select registry.id, v_filing_source_id, 'filing'
    from public.market_company_source_registry registry
    where registry.env = p_environment
      and registry.release_id = v_release_id
      and registry.active = true
      and registry.sec_cik is not null
    on conflict do nothing;
  end if;

  insert into public.market_company_source_registry_links (registry_id, source_id, coverage_role)
  select distinct registry.id, source.id, 'official'
  from public.market_company_source_registry registry
  join public.market_issue_sources source
    on source.env = p_environment
   and source.active = true
   and source.source_type = 'web'
   and source.source_class = 'company_official'
  cross join lateral unnest(coalesce(source.source_tags, array[]::text[])) as tag(value)
  where registry.env = p_environment
    and registry.release_id = v_release_id
    and registry.active = true
    and upper(tag.value) = registry.ticker
  on conflict do nothing;

  return v_refreshed_count;
end;
$$;

grant execute on function public.refresh_market_company_source_registry(text) to service_role;

commit;
