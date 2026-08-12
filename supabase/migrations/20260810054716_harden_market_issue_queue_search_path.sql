alter function public.market_issue_queue_name(text, text)
  set search_path = pg_catalog, public, pg_temp;

revoke all on function public.market_issue_queue_name(text, text)
  from public, anon, authenticated;
grant execute on function public.market_issue_queue_name(text, text) to service_role;
