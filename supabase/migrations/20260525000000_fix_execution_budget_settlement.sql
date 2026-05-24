create or replace function public.settle_execution_budget(
  p_user_id uuid,
  p_request_id text,
  p_run_id uuid,
  p_actual_cost_usd numeric,
  p_terminal_status text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  settled boolean,
  reservation_id uuid,
  settled_cost_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.run_budgets%rowtype;
  v_actual numeric := greatest(coalesce(p_actual_cost_usd, 0), 0);
  v_release numeric;
begin
  select *
    into v_budget
    from public.run_budgets rb
    where rb.user_id = p_user_id
      and rb.request_id = p_request_id
    for update;

  if not found then
    return query select false, null::uuid, 0::numeric;
    return;
  end if;

  if v_budget.status in ('settled', 'released', 'expired') then
    return query select
      v_budget.status = 'settled',
      v_budget.id,
      v_budget.settled_cost_usd;
    return;
  end if;

  perform public.ensure_usage_budget_balance(
    p_user_id,
    'monthly',
    v_budget.monthly_period_start,
    v_budget.monthly_period_end
  );
  perform public.ensure_usage_budget_balance(
    p_user_id,
    'daily',
    v_budget.daily_period_start,
    v_budget.daily_period_end
  );

  v_release := greatest(v_budget.reserved_cost_usd - v_actual, 0);

  update public.usage_budget_balances as balance
    set reserved_cost_usd = greatest(balance.reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        settled_cost_usd = balance.settled_cost_usd + v_actual,
        released_cost_usd = balance.released_cost_usd + v_release,
        run_count = balance.run_count + 1,
        updated_at = now()
    where balance.user_id = p_user_id
      and balance.period_kind = 'monthly'
      and balance.period_start = v_budget.monthly_period_start
      and balance.period_end = v_budget.monthly_period_end;

  update public.usage_budget_balances as balance
    set reserved_cost_usd = greatest(balance.reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        settled_cost_usd = balance.settled_cost_usd + v_actual,
        released_cost_usd = balance.released_cost_usd + v_release,
        run_count = balance.run_count + 1,
        updated_at = now()
    where balance.user_id = p_user_id
      and balance.period_kind = 'daily'
      and balance.period_start = v_budget.daily_period_start
      and balance.period_end = v_budget.daily_period_end;

  update public.run_budgets as rb
    set run_id = coalesce(p_run_id, rb.run_id),
        settled_cost_usd = v_actual,
        status = 'settled',
        reason = p_terminal_status,
        metadata = coalesce(p_metadata, '{}'::jsonb),
        settled_at = now()
    where rb.id = v_budget.id
    returning rb.* into v_budget;

  insert into public.usage_ledger (
    user_id,
    run_budget_id,
    run_id,
    request_id,
    period_kind,
    period_start,
    period_end,
    entry_type,
    amount_usd,
    metadata
  )
  values
    (
      p_user_id,
      v_budget.id,
      v_budget.run_id,
      p_request_id,
      'monthly',
      v_budget.monthly_period_start,
      v_budget.monthly_period_end,
      'settlement',
      v_actual,
      coalesce(p_metadata, '{}'::jsonb)
    ),
    (
      p_user_id,
      v_budget.id,
      v_budget.run_id,
      p_request_id,
      'daily',
      v_budget.daily_period_start,
      v_budget.daily_period_end,
      'settlement',
      v_actual,
      coalesce(p_metadata, '{}'::jsonb)
    );

  return query select true, v_budget.id, v_actual;
end;
$$;

create or replace function public.release_execution_budget(
  p_user_id uuid,
  p_request_id text,
  p_run_id uuid,
  p_reason text
)
returns table (
  released boolean,
  reservation_id uuid,
  released_cost_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.run_budgets%rowtype;
begin
  select *
    into v_budget
    from public.run_budgets rb
    where rb.user_id = p_user_id
      and rb.request_id = p_request_id
    for update;

  if not found then
    return query select false, null::uuid, 0::numeric;
    return;
  end if;

  if v_budget.status in ('settled', 'released', 'expired') then
    return query select
      v_budget.status = 'released',
      v_budget.id,
      v_budget.reserved_cost_usd;
    return;
  end if;

  update public.usage_budget_balances as balance
    set reserved_cost_usd = greatest(balance.reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        released_cost_usd = balance.released_cost_usd + v_budget.reserved_cost_usd,
        updated_at = now()
    where balance.user_id = p_user_id
      and balance.period_kind = 'monthly'
      and balance.period_start = v_budget.monthly_period_start
      and balance.period_end = v_budget.monthly_period_end;

  update public.usage_budget_balances as balance
    set reserved_cost_usd = greatest(balance.reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        released_cost_usd = balance.released_cost_usd + v_budget.reserved_cost_usd,
        updated_at = now()
    where balance.user_id = p_user_id
      and balance.period_kind = 'daily'
      and balance.period_start = v_budget.daily_period_start
      and balance.period_end = v_budget.daily_period_end;

  update public.run_budgets as rb
    set run_id = coalesce(p_run_id, rb.run_id),
        status = 'released',
        reason = p_reason,
        settled_at = now()
    where rb.id = v_budget.id
    returning rb.* into v_budget;

  insert into public.usage_ledger (
    user_id,
    run_budget_id,
    run_id,
    request_id,
    period_kind,
    period_start,
    period_end,
    entry_type,
    amount_usd,
    metadata
  )
  values
    (
      p_user_id,
      v_budget.id,
      v_budget.run_id,
      p_request_id,
      'monthly',
      v_budget.monthly_period_start,
      v_budget.monthly_period_end,
      'release',
      v_budget.reserved_cost_usd,
      jsonb_build_object('reason', p_reason)
    ),
    (
      p_user_id,
      v_budget.id,
      v_budget.run_id,
      p_request_id,
      'daily',
      v_budget.daily_period_start,
      v_budget.daily_period_end,
      'release',
      v_budget.reserved_cost_usd,
      jsonb_build_object('reason', p_reason)
    );

  return query select true, v_budget.id, v_budget.reserved_cost_usd;
end;
$$;

grant execute on function public.settle_execution_budget(uuid, text, uuid, numeric, text, jsonb)
  to service_role;
grant execute on function public.release_execution_budget(uuid, text, uuid, text)
  to service_role;
