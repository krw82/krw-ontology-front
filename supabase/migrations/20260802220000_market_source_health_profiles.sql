begin;

alter table public.market_source_fetch_states
  add column if not exists health_status text not null default 'pending_first_fetch',
  add column if not exists health_reason text,
  add column if not exists consecutive_failure_count integer not null default 0,
  add column if not exists last_valid_item_at timestamptz,
  add column if not exists retry_after timestamptz,
  add column if not exists last_content_hash text;

alter table public.market_source_fetch_states
  drop constraint if exists market_source_fetch_states_health_status_check;

alter table public.market_source_fetch_states
  add constraint market_source_fetch_states_health_status_check
  check (health_status in ('pending_first_fetch', 'healthy', 'empty', 'degraded', 'blocked', 'invalid', 'needs_browser'));

create index if not exists market_source_fetch_states_health_idx
  on public.market_source_fetch_states (health_status, retry_after asc nulls first);

update public.market_source_fetch_states
set health_status = case
  when last_success_at is not null then 'healthy'
  when failure_count > 0 then 'degraded'
  else 'pending_first_fetch'
end
where health_status = 'pending_first_fetch';

alter table public.market_source_candidates
  add column if not exists quality_status text,
  add column if not exists quality_reason text;

alter table public.market_source_candidates
  drop constraint if exists market_source_candidates_quality_status_check;

alter table public.market_source_candidates
  add constraint market_source_candidates_quality_status_check
  check (quality_status is null or quality_status in ('accepted', 'rejected'));

-- The profile lives in adapter_config so the existing source registry remains the
-- single source of truth. These defaults are intentionally conservative.
update public.market_issue_sources
set adapter_config = coalesce(adapter_config, '{}'::jsonb) || jsonb_build_object(
  'profile_version', 1,
  'fetch_backend', 'http',
  'article_extractor', case when adapter_type in ('rss', 'atom') then 'feed_content' else 'semantic_html' end,
  'max_redirects', 5,
  'min_body_chars', case when source_class = 'company_official' then 160 else 240 end,
  'fallback_source_keys', jsonb_build_array('sec-catalog')
)
where env = 'prod'
  and source_type = 'web';

-- Repair known production sources discovered during the first full sweep.
update public.market_issue_sources
set discovery_url = 'https://ir.aboutamazon.com/news-release/news-release-details/default.aspx',
    canonical_host = 'ir.aboutamazon.com',
    adapter_type = 'html_list',
    adapter_config = coalesce(adapter_config, '{}'::jsonb) || jsonb_build_object(
      'allowed_hosts', jsonb_build_array('ir.aboutamazon.com', 'www.aboutamazon.com'),
      'include_path_regex', '(news-release|press-release|financial|earnings)',
      'exclude_path_regex', '(privacy|careers|contact|login|sitemap)'
    ),
    updated_at = now()
where env = 'prod'
  and source_type = 'web'
  and source_key = 'official-ir-amzn';

update public.market_issue_sources
set adapter_config = coalesce(adapter_config, '{}'::jsonb) || jsonb_build_object(
  'allowed_hosts', jsonb_build_array('www.apple.com', 'apple.com', 'images.apple.com'),
  'max_redirects', 5
),
updated_at = now()
where env = 'prod' and source_key = 'apple-newsroom';

update public.market_issue_sources
set adapter_config = coalesce(adapter_config, '{}'::jsonb) || jsonb_build_object(
  'allowed_hosts', jsonb_build_array('news.microsoft.com', 'blogs.microsoft.com', 'www.microsoft.com'),
  'max_redirects', 5
),
updated_at = now()
where env = 'prod' and source_key = 'microsoft-news';

commit;
