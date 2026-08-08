-- Move regulators (Federal Reserve, SEC press releases) off paid X polling onto
-- free official RSS feeds. Their X output was no faster than the official feed
-- and consumed X API credits; the web-source worker already supports the RSS
-- adapter, so these rows are polled by the existing per-minute
-- dispatch_market_issue_web_sources cron without code changes.
--
-- The SEC catalog filing source (source_type='sec', adapter_type='sec_catalog')
-- remains the canonical 8-K/6-K/Form-4 path and is intentionally untouched.

insert into public.market_issue_sources (
  env,
  source_type,
  source_key,
  account_handle,
  display_name,
  source_class,
  source_tags,
  active,
  allow_single_source_publish,
  adapter_type,
  channel_type,
  discovery_url,
  canonical_host,
  poll_interval_seconds,
  priority,
  max_items_per_poll,
  requires_browser,
  adapter_config
)
select
  env,
  'web'::text,
  source_key,
  null,
  display_name,
  'regulator'::text,
  array['official', 'regulator']::text[],
  true,
  true,
  'rss'::text,
  'newsroom'::text,
  discovery_url,
  canonical_host,
  300,
  95,
  25,
  false,
  adapter_config
from (
  values
    ('dev',    'federalreserve-press-releases', 'Federal Reserve Board Press Releases',
     'https://www.federalreserve.gov/feeds/press_all.xml', 'www.federalreserve.gov',
     jsonb_build_object(
       'allowed_hosts', jsonb_build_array('www.federalreserve.gov', 'www.federalreserve.org'),
       'fetch_backend', 'http',
       'article_extractor', 'feed_content'
     )),
    ('staging', 'federalreserve-press-releases', 'Federal Reserve Board Press Releases',
     'https://www.federalreserve.gov/feeds/press_all.xml', 'www.federalreserve.gov',
     jsonb_build_object(
       'allowed_hosts', jsonb_build_array('www.federalreserve.gov', 'www.federalreserve.org'),
       'fetch_backend', 'http',
       'article_extractor', 'feed_content'
     )),
    ('prod',   'federalreserve-press-releases', 'Federal Reserve Board Press Releases',
     'https://www.federalreserve.gov/feeds/press_all.xml', 'www.federalreserve.gov',
     jsonb_build_object(
       'allowed_hosts', jsonb_build_array('www.federalreserve.gov', 'www.federalreserve.org'),
       'fetch_backend', 'http',
       'article_extractor', 'feed_content'
     )),
    ('dev',    'sec-press-releases', 'SEC Press Releases',
     'https://www.sec.gov/rss/news/press.xml', 'www.sec.gov',
     jsonb_build_object(
       'allowed_hosts', jsonb_build_array('www.sec.gov'),
       'fetch_backend', 'http',
       'article_extractor', 'feed_content',
       'user_agent', 'KRW-Ontology research@example.com'
     )),
    ('staging', 'sec-press-releases', 'SEC Press Releases',
     'https://www.sec.gov/rss/news/press.xml', 'www.sec.gov',
     jsonb_build_object(
       'allowed_hosts', jsonb_build_array('www.sec.gov'),
       'fetch_backend', 'http',
       'article_extractor', 'feed_content',
       'user_agent', 'KRW-Ontology research@example.com'
     )),
    ('prod',   'sec-press-releases', 'SEC Press Releases',
     'https://www.sec.gov/rss/news/press.xml', 'www.sec.gov',
     jsonb_build_object(
       'allowed_hosts', jsonb_build_array('www.sec.gov'),
       'fetch_backend', 'http',
       'article_extractor', 'feed_content',
       'user_agent', 'KRW-Ontology research@example.com'
     ))
) as seed(env, source_key, display_name, discovery_url, canonical_host, adapter_config)
on conflict (env, source_type, source_key) do update
  set
    discovery_url = excluded.discovery_url,
    canonical_host = excluded.canonical_host,
    adapter_config = excluded.adapter_config,
    source_tags = excluded.source_tags,
    poll_interval_seconds = excluded.poll_interval_seconds,
    priority = excluded.priority,
    active = true,
    updated_at = now();

-- Retire the legacy X source rows that the filtered-stream worker no longer
-- references. The worker now only ingests the 8 macro/commentary/policy handles
-- declared in DEFAULT_X_SOURCE_SEEDS (config.ts); the old regulators/exchanges/
-- companies moved off X (regulators → free RSS above, companies/exchanges/media
-- intentionally dropped from paid X). Deactivating avoids confusion in the admin
-- console and stale rows in syncMarketIssueSources. Rows are kept for audit.
update public.market_issue_sources
  set active = false, updated_at = now()
  where source_type = 'x'
    and source_key not in (
      'SoberLook', 'profplum99', 'LynAldenContact', 'EPBResearch',
      'BCAppelbaum', 'realDonaldTrump', 'USTradeRep', 'USTreasury'
    )
    and active = true;

-- Refresh the company source registry so coverage accounting picks up the new
-- regulator rows. Only prod has an active ontology release in this environment,
-- so the dev/staging calls are wrapped to no-op when no release exists.
do $$
begin
  begin
    perform public.refresh_market_company_source_registry('dev');
  exception when others then null; end;
  begin
    perform public.refresh_market_company_source_registry('staging');
  exception when others then null; end;
  begin
    perform public.refresh_market_company_source_registry('prod');
  exception when others then null; end;
end $$;
