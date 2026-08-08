-- Structured next-research questions are source-derived editorial data. They
-- intentionally live beside the source summary rather than in per-user state:
-- readers can choose a path, while the server owns the canonical chat prompt.

alter table public.market_issues
  add column if not exists research_paths jsonb not null default '[]'::jsonb;

alter table public.market_issues
  drop constraint if exists market_issues_research_paths_array_check;

alter table public.market_issues
  add constraint market_issues_research_paths_array_check
  check (jsonb_typeof(research_paths) = 'array');

alter table public.market_issue_events
  drop constraint if exists market_issue_events_event_name_check;

alter table public.market_issue_events
  add constraint market_issue_events_event_name_check
  check (
    event_name in (
      'news_tab_viewed',
      'market_issue_opened',
      'market_issue_source_opened',
      'market_issue_research_path_selected',
      'market_issue_research_draft_opened',
      'market_issue_research_submitted',
      'market_issue_saved',
      'market_issue_hidden',
      'market_issue_company_followed'
    )
  );
