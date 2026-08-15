-- The Rust product contract already has a source_filing_followup entrypoint.
-- Admit that run kind in the public queue as well so a filing-backed chat
-- session reaches the dedicated filing workflow instead of failing after
-- the question has been persisted.

begin;

alter table public.agent_runs
  drop constraint if exists agent_runs_run_kind_check;

alter table public.agent_runs
  add constraint agent_runs_run_kind_check
  check (
    run_kind in (
      'company_research',
      'company_research_en',
      'earnings_deep_dive',
      'wide_research',
      'idea_generation',
      'news_discovery',
      'news_discovery_wide',
      'news_research',
      'market_move_research',
      'scenario_sensitivity',
      'source_filing_followup',
      'guru_advisor',
      'guru_ackman',
      'guru_buffett',
      'guru_flatt',
      'guru_marks',
      'guru_terry_smith'
    )
  );

do $migration$
declare
  v_function regprocedure;
  v_definition text;
begin
  for v_function in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('enqueue_agent_v1_product_run', 'enqueue_agent_v1_product_run_v7')
       and p.pronargs = 1
       and pg_get_function_identity_arguments(p.oid) in ('jsonb', 'p_request jsonb')
  loop
    v_definition := pg_get_functiondef(v_function);
    if position($$'source_filing_followup'$$ in v_definition) = 0 then
      -- The legacy function's list contains news_research, while the v7
      -- function's current production list contains earnings_deep_dive.
      -- Rewrite either known list explicitly; silently skipping one would
      -- leave the live v7 enqueue path rejecting filing-backed chats.
      if position($$'earnings_deep_dive'$$ in v_definition) > 0 then
        v_definition := replace(
          v_definition,
          $$'earnings_deep_dive'$$,
          $$'earnings_deep_dive', 'source_filing_followup'$$
        );
      elsif position($$'news_research'$$ in v_definition) > 0 then
        v_definition := replace(
          v_definition,
          $$'news_research'$$,
          $$'news_research', 'source_filing_followup'$$
        );
      else
        raise exception 'enqueue function has no known run-kind anchor: %', v_function;
      end if;
      execute v_definition;
    end if;
  end loop;
end
$migration$;

commit;
