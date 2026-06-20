-- Fix already-applied local/remote copies of reserve_analysis_credits that
-- referenced current_weekly_credit_period output columns without an alias.

do $$
declare
  v_sql text;
  v_replaced text;
begin
  select pg_get_functiondef(
    'public.reserve_analysis_credits(uuid,text,bigint,timestamptz,timestamptz)'::regprocedure
  )
    into v_sql;

  if position('from public.current_weekly_credit_period(v_anchor, p_now) as c' in v_sql) > 0 then
    return;
  end if;

  v_replaced := replace(
    v_sql,
    'select period_start, period_end
    into v_period_start, v_period_end
    from public.current_weekly_credit_period(v_anchor, p_now);',
    'select c.period_start, c.period_end
    into v_period_start, v_period_end
    from public.current_weekly_credit_period(v_anchor, p_now) as c;'
  );

  if v_replaced = v_sql then
    raise exception 'reserve_analysis_credits period alias patch did not match function body';
  end if;

  execute v_replaced;
end;
$$;
