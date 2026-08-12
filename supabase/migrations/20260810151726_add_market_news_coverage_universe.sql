-- Service-only aggregate universe for Mac-local Finnhub collection. This
-- intentionally exposes no user IDs, interest reasons, or individual marks.
create or replace function public.list_market_news_coverage_tickers()
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
    upper(btrim(mark.ticker)) as ticker,
    count(*)::integer as coverage_count,
    coalesce(max(mark.priority), 0)::integer as max_priority
  from public.user_company_marks as mark
  where mark.coverage_level is not null
    and upper(btrim(mark.ticker)) ~ '^[A-Z0-9][A-Z0-9.-]{0,15}$'
  group by upper(btrim(mark.ticker))
  order by count(*) desc, coalesce(max(mark.priority), 0) desc, upper(btrim(mark.ticker)) asc;
$function$;

revoke all on function public.list_market_news_coverage_tickers() from public, anon, authenticated;
grant execute on function public.list_market_news_coverage_tickers() to service_role;
