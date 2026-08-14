-- Tickerless news chat uses the same bounded KRW Feed reader as company news,
-- but enters the Rust image with a covered-universe scope.  No ontology table
-- or ontology schema is changed.

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
  v_news_anchor constant text := $$'idea_generation', 'guru_ackman'$$;
  v_news_replacement constant text := $$'idea_generation', 'news_discovery', 'news_discovery_wide', 'news_research', 'market_move_research', 'guru_ackman'$$;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enqueue_agent_v1_product_run', 'enqueue_agent_v1_product_run_v7')
      and pg_get_function_identity_arguments(p.oid) = 'p_request jsonb'
  loop
    v_definition := pg_get_functiondef(v_function);
    if position($$'news_research'$$ in v_definition) = 0
       and position(v_news_anchor in v_definition) > 0 then
      v_definition := replace(v_definition, v_news_anchor, v_news_replacement);
      execute v_definition;
    elsif position($$'news_discovery_wide'$$ in v_definition) = 0
       and position($$'news_discovery'$$ in v_definition) > 0 then
      v_definition := replace(v_definition, $$'news_discovery'$$, $$'news_discovery', 'news_discovery_wide'$$);
      execute v_definition;
    end if;
  end loop;
end
$migration$;

commit;
