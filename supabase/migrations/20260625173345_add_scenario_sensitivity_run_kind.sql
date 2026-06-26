alter table public.agent_runs
  drop constraint if exists agent_runs_run_kind_check;

alter table public.agent_runs
  add constraint agent_runs_run_kind_check
  check (
    run_kind in (
      'company_research',
      'idea_generation',
      'news_discovery',
      'news_research',
      'market_move_research',
      'scenario_sensitivity'
    )
  );
