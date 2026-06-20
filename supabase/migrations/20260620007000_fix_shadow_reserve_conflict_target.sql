-- Avoid returned column name conflicts in reserve_analysis_credits conflict
-- targets and update expressions.

do $$
declare
  v_sql text;
  v_replaced text;
begin
  select pg_get_functiondef(
    'public.reserve_analysis_credits(uuid,text,bigint,timestamptz,timestamptz)'::regprocedure
  )
    into v_sql;

  if position('on conflict on constraint usage_credit_balances_pkey do nothing;' in v_sql) > 0
     and position('set credits_reserved_raw = ucb.credits_reserved_raw + v_reserve,' in v_sql) > 0 then
    return;
  end if;

  v_replaced := replace(
    v_sql,
    'on conflict (user_id, period_kind, period_start, period_end) do nothing;',
    'on conflict on constraint usage_credit_balances_pkey do nothing;'
  );

  v_replaced := replace(
    v_replaced,
    'set credits_reserved_raw = credits_reserved_raw + v_reserve,',
    'set credits_reserved_raw = ucb.credits_reserved_raw + v_reserve,'
  );

  if v_replaced = v_sql then
    raise exception 'reserve_analysis_credits conflict target patch did not match function body';
  end if;

  execute v_replaced;
end;
$$;
