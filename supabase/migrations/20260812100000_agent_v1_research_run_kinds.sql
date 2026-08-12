-- The product route can enqueue the wide-research workflow and the concrete
-- Guru entrypoints.  Older migrations only admitted the legacy aggregate
-- `guru_advisor` value, which made the request fail after the Rust host had
-- already prepared a valid immutable request.  Broaden the product check
-- additively; this does not change ontology tables or the agent ABI.

begin;

do $migration$
declare
  v_definition text;
  v_anchor constant text := $$'earnings_deep_dive',$$;
  v_replacement constant text := $$'earnings_deep_dive', 'wide_research',$$;
  v_function constant regprocedure := 'public.enqueue_agent_v1_product_run_v7(jsonb)'::regprocedure;
begin
  if to_regprocedure('public.enqueue_agent_v1_product_run_v7(jsonb)') is null then
    raise exception 'v7 enqueue function is missing';
  end if;

  select pg_get_functiondef(v_function) into v_definition;
  if position($$'wide_research'$$ in v_definition) = 0 then
    if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
      raise exception 'v7 enqueue function run-kind anchor is ambiguous';
    end if;
    v_definition := replace(v_definition, v_anchor, v_replacement);
    execute v_definition;
  end if;

  select pg_get_functiondef(v_function) into v_definition;
  if position($$'wide_research'$$ in v_definition) = 0 then
    raise exception 'v7 enqueue function was not widened for wide_research';
  end if;
end
$migration$;

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

commit;
