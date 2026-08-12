-- The Finnhub worker is a product-wide news collector. Its company universe
-- follows the active ontology catalog rather than any user's watchlist state.
-- Keep the existing no-argument RPC temporarily for workers running an older
-- bundle; the updated worker calls this environment-scoped overload.
create or replace function public.list_market_news_coverage_tickers(
  p_environment text
)
returns table (
  ticker text,
  coverage_count integer,
  max_priority integer
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select
    company.ticker,
    1::integer as coverage_count,
    0::integer as max_priority
  from public.ontology_catalog_releases as release
  join public.ontology_companies as company
    on company.env = release.env
   and company.release_id = release.release_id
  where release.env = lower(btrim(p_environment))
    and release.active
    and company.ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,15}$'
  order by company.ticker;
$function$;

revoke all on function public.list_market_news_coverage_tickers(text)
  from public, anon, authenticated;
grant execute on function public.list_market_news_coverage_tickers(text)
  to service_role;
