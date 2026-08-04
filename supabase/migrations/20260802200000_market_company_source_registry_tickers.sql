begin;

update public.market_issue_sources
set adapter_config = jsonb_set(
      coalesce(adapter_config, '{}'::jsonb),
      '{company_tickers}',
      case source_key
        when 'amd-press-releases' then '["AMD"]'::jsonb
        when 'apple-newsroom' then '["AAPL"]'::jsonb
        when 'microsoft-news' then '["MSFT"]'::jsonb
        when 'google-blog' then '["GOOGL"]'::jsonb
        else coalesce(adapter_config -> 'company_tickers', '[]'::jsonb)
      end,
      true
    ),
    updated_at = now()
where source_type = 'web'
  and source_key in ('amd-press-releases', 'apple-newsroom', 'microsoft-news', 'google-blog');

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
      upper(ticker.value) as ticker,
      count(distinct source.id)::integer as source_count,
      max(source.priority) as max_priority,
      min(source.poll_interval_seconds) as min_poll_interval_seconds
    from public.market_issue_sources source
    cross join lateral jsonb_array_elements_text(
      coalesce(source.adapter_config -> 'company_tickers', '[]'::jsonb)
    ) as ticker(value)
    where source.env = p_environment
      and source.active = true
      and source.source_type = 'web'
      and source.source_class = 'company_official'
    group by upper(ticker.value)
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
  cross join lateral jsonb_array_elements_text(
    coalesce(source.adapter_config -> 'company_tickers', '[]'::jsonb)
  ) as ticker(value)
  where registry.env = p_environment
    and registry.release_id = v_release_id
    and registry.active = true
    and upper(ticker.value) = registry.ticker
  on conflict do nothing;

  return v_refreshed_count;
end;
$$;

commit;
