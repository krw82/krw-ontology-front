-- Qualify period columns in reserve_analysis_credits so they do not conflict
-- with the function's returned period_start/period_end columns.

do $$
declare
  v_sql text;
  v_replaced text;
begin
  select pg_get_functiondef(
    'public.reserve_analysis_credits(uuid,text,bigint,timestamptz,timestamptz)'::regprocedure
  )
    into v_sql;

  if position('from public.usage_credit_balances as ucb' in v_sql) > 0
     and position('update public.usage_credit_balances as ucb' in v_sql) > 0 then
    return;
  end if;

  v_replaced := replace(
    v_sql,
    'from public.usage_credit_balances
    where user_id = p_user_id
      and period_kind = ''weekly''
      and period_start = v_period_start
      and period_end = v_period_end
    for update;',
    'from public.usage_credit_balances as ucb
    where ucb.user_id = p_user_id
      and ucb.period_kind = ''weekly''
      and ucb.period_start = v_period_start
      and ucb.period_end = v_period_end
    for update;'
  );

  v_replaced := replace(
    v_replaced,
    'update public.usage_credit_balances
    set credits_reserved_raw = credits_reserved_raw + v_reserve,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = ''weekly''
      and period_start = v_period_start
      and period_end = v_period_end
    returning * into v_balance;',
    'update public.usage_credit_balances as ucb
    set credits_reserved_raw = credits_reserved_raw + v_reserve,
        updated_at = now()
    where ucb.user_id = p_user_id
      and ucb.period_kind = ''weekly''
      and ucb.period_start = v_period_start
      and ucb.period_end = v_period_end
    returning * into v_balance;'
  );

  if v_replaced = v_sql then
    raise exception 'reserve_analysis_credits balance alias patch did not match function body';
  end if;

  execute v_replaced;
end;
$$;
