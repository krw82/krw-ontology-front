-- Local Finnhub news is Z.ai-only. Existing machine-translated projections
-- are archived so the public news API stops returning them before the
-- transitional verification queue and state column are removed.
update public.market_issues
set state = 'archived',
    local_news_stage = 'standard',
    updated_at = now()
where local_news_stage = 'translated';

drop function if exists public.claim_market_local_news_verification_request(text, text, integer);
drop table if exists public.market_local_news_verification_requests;

alter table public.market_issues
  drop constraint if exists market_issues_local_news_stage_check;
alter table public.market_issues
  add constraint market_issues_local_news_stage_check
  check (local_news_stage in ('standard', 'ai_verified'));

alter table public.market_issues
  drop column if exists local_news_verification_state;
