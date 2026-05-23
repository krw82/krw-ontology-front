-- Execution-budget accounting replaces question-count quota as the primary
-- control surface. The ledger is append-only evidence; balances are cached for
-- fast gating and UI reads.

create table if not exists public.usage_budget_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_kind text not null check (period_kind in ('daily', 'monthly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  settled_cost_usd numeric(12, 6) not null default 0 check (settled_cost_usd >= 0),
  reserved_cost_usd numeric(12, 6) not null default 0 check (reserved_cost_usd >= 0),
  released_cost_usd numeric(12, 6) not null default 0 check (released_cost_usd >= 0),
  run_count integer not null default 0 check (run_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_kind, period_start, period_end),
  check (period_end > period_start)
);

create table if not exists public.run_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  run_id uuid references public.agent_runs(id) on delete set null,
  monthly_period_start timestamptz not null,
  monthly_period_end timestamptz not null,
  daily_period_start timestamptz not null,
  daily_period_end timestamptz not null,
  reserved_cost_usd numeric(12, 6) not null check (reserved_cost_usd >= 0),
  settled_cost_usd numeric(12, 6) not null default 0 check (settled_cost_usd >= 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'running', 'settled', 'released', 'expired')),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, request_id),
  check (monthly_period_end > monthly_period_start),
  check (daily_period_end > daily_period_start)
);

create index if not exists idx_run_budgets_active
  on public.run_budgets (user_id, status, expires_at)
  where status in ('reserved', 'running');

create index if not exists idx_run_budgets_run_id
  on public.run_budgets (run_id)
  where run_id is not null;

create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_budget_id uuid references public.run_budgets(id) on delete set null,
  run_id uuid references public.agent_runs(id) on delete set null,
  request_id text not null,
  period_kind text not null check (period_kind in ('daily', 'monthly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  entry_type text not null
    check (entry_type in ('reservation', 'settlement', 'release', 'adjustment', 'expiry')),
  amount_usd numeric(12, 6) not null check (amount_usd >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);

create index if not exists idx_usage_ledger_user_period
  on public.usage_ledger (user_id, period_kind, period_start, created_at desc);

alter table public.usage_budget_balances enable row level security;
alter table public.run_budgets enable row level security;
alter table public.usage_ledger enable row level security;

create policy "Users can read own execution budget balances"
  on public.usage_budget_balances
  for select
  using (auth.uid() = user_id);

create policy "Users can read own run budgets"
  on public.run_budgets
  for select
  using (auth.uid() = user_id);

create policy "Users can read own usage ledger"
  on public.usage_ledger
  for select
  using (auth.uid() = user_id);

revoke all on public.usage_budget_balances from public, anon, authenticated;
revoke all on public.run_budgets from public, anon, authenticated;
revoke all on public.usage_ledger from public, anon, authenticated;

grant select on public.usage_budget_balances to authenticated;
grant select on public.run_budgets to authenticated;
grant select on public.usage_ledger to authenticated;
grant select, insert, update, delete on public.usage_budget_balances to service_role;
grant select, insert, update, delete on public.run_budgets to service_role;
grant select, insert, update, delete on public.usage_ledger to service_role;

create or replace function public.ensure_usage_budget_balance(
  p_user_id uuid,
  p_period_kind text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage_budget_balances (
    user_id,
    period_kind,
    period_start,
    period_end
  )
  values (
    p_user_id,
    p_period_kind,
    p_period_start,
    p_period_end
  )
  on conflict (user_id, period_kind, period_start, period_end) do nothing;
end;
$$;

create or replace function public.reserve_execution_budget(
  p_user_id uuid,
  p_request_id text,
  p_monthly_period_start timestamptz,
  p_monthly_period_end timestamptz,
  p_daily_period_start timestamptz,
  p_daily_period_end timestamptz,
  p_monthly_budget_usd numeric,
  p_daily_budget_usd numeric,
  p_reserve_cost_usd numeric,
  p_expires_at timestamptz
)
returns table (
  allowed boolean,
  reason text,
  reservation_id uuid,
  monthly_used_usd numeric,
  monthly_reserved_usd numeric,
  monthly_limit_usd numeric,
  daily_used_usd numeric,
  daily_reserved_usd numeric,
  daily_limit_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.run_budgets%rowtype;
  v_monthly public.usage_budget_balances%rowtype;
  v_daily public.usage_budget_balances%rowtype;
  v_reserve numeric := greatest(coalesce(p_reserve_cost_usd, 0), 0);
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_request_id is null or length(trim(p_request_id)) = 0 then
    raise exception 'request_id is required';
  end if;
  if p_monthly_budget_usd < 0 or p_daily_budget_usd < 0 then
    raise exception 'execution budgets must be non-negative';
  end if;

  perform public.ensure_usage_budget_balance(
    p_user_id,
    'monthly',
    p_monthly_period_start,
    p_monthly_period_end
  );
  perform public.ensure_usage_budget_balance(
    p_user_id,
    'daily',
    p_daily_period_start,
    p_daily_period_end
  );

  select *
    into v_monthly
    from public.usage_budget_balances
    where user_id = p_user_id
      and period_kind = 'monthly'
      and period_start = p_monthly_period_start
      and period_end = p_monthly_period_end
    for update;

  select *
    into v_daily
    from public.usage_budget_balances
    where user_id = p_user_id
      and period_kind = 'daily'
      and period_start = p_daily_period_start
      and period_end = p_daily_period_end
    for update;

  select *
    into v_existing
    from public.run_budgets
    where user_id = p_user_id
      and request_id = p_request_id
    for update;

  if found and v_existing.status in ('reserved', 'running', 'settled') then
    return query select
      true,
      null::text,
      v_existing.id,
      v_monthly.settled_cost_usd,
      v_monthly.reserved_cost_usd,
      p_monthly_budget_usd,
      v_daily.settled_cost_usd,
      v_daily.reserved_cost_usd,
      p_daily_budget_usd;
    return;
  end if;

  if v_monthly.settled_cost_usd + v_monthly.reserved_cost_usd + v_reserve
      > p_monthly_budget_usd then
    return query select
      false,
      'monthly_budget_exceeded',
      null::uuid,
      v_monthly.settled_cost_usd,
      v_monthly.reserved_cost_usd,
      p_monthly_budget_usd,
      v_daily.settled_cost_usd,
      v_daily.reserved_cost_usd,
      p_daily_budget_usd;
    return;
  end if;

  if v_daily.settled_cost_usd + v_daily.reserved_cost_usd + v_reserve
      > p_daily_budget_usd then
    return query select
      false,
      'daily_budget_exceeded',
      null::uuid,
      v_monthly.settled_cost_usd,
      v_monthly.reserved_cost_usd,
      p_monthly_budget_usd,
      v_daily.settled_cost_usd,
      v_daily.reserved_cost_usd,
      p_daily_budget_usd;
    return;
  end if;

  if found then
    update public.run_budgets
      set reserved_cost_usd = v_reserve,
          settled_cost_usd = 0,
          status = 'reserved',
          reason = null,
          metadata = '{}'::jsonb,
          expires_at = p_expires_at,
          settled_at = null
      where id = v_existing.id
      returning * into v_existing;
  else
    insert into public.run_budgets (
      user_id,
      request_id,
      monthly_period_start,
      monthly_period_end,
      daily_period_start,
      daily_period_end,
      reserved_cost_usd,
      expires_at
    )
    values (
      p_user_id,
      p_request_id,
      p_monthly_period_start,
      p_monthly_period_end,
      p_daily_period_start,
      p_daily_period_end,
      v_reserve,
      p_expires_at
    )
    returning * into v_existing;
  end if;

  update public.usage_budget_balances
    set reserved_cost_usd = reserved_cost_usd + v_reserve,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'monthly'
      and period_start = p_monthly_period_start
      and period_end = p_monthly_period_end
    returning * into v_monthly;

  update public.usage_budget_balances
    set reserved_cost_usd = reserved_cost_usd + v_reserve,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'daily'
      and period_start = p_daily_period_start
      and period_end = p_daily_period_end
    returning * into v_daily;

  insert into public.usage_ledger (
    user_id,
    run_budget_id,
    request_id,
    period_kind,
    period_start,
    period_end,
    entry_type,
    amount_usd
  )
  values
    (
      p_user_id,
      v_existing.id,
      p_request_id,
      'monthly',
      p_monthly_period_start,
      p_monthly_period_end,
      'reservation',
      v_reserve
    ),
    (
      p_user_id,
      v_existing.id,
      p_request_id,
      'daily',
      p_daily_period_start,
      p_daily_period_end,
      'reservation',
      v_reserve
    );

  return query select
    true,
    null::text,
    v_existing.id,
    v_monthly.settled_cost_usd,
    v_monthly.reserved_cost_usd,
    p_monthly_budget_usd,
    v_daily.settled_cost_usd,
    v_daily.reserved_cost_usd,
    p_daily_budget_usd;
end;
$$;

create or replace function public.attach_execution_budget_run(
  p_user_id uuid,
  p_request_id text,
  p_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.run_budgets
    set run_id = p_run_id,
        status = case when status = 'reserved' then 'running' else status end
    where user_id = p_user_id
      and request_id = p_request_id
      and status in ('reserved', 'running');
end;
$$;

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
    from public.run_budgets
    where user_id = p_user_id
      and request_id = p_request_id
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

  update public.usage_budget_balances
    set reserved_cost_usd = greatest(reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        settled_cost_usd = settled_cost_usd + v_actual,
        released_cost_usd = released_cost_usd + v_release,
        run_count = run_count + 1,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'monthly'
      and period_start = v_budget.monthly_period_start
      and period_end = v_budget.monthly_period_end;

  update public.usage_budget_balances
    set reserved_cost_usd = greatest(reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        settled_cost_usd = settled_cost_usd + v_actual,
        released_cost_usd = released_cost_usd + v_release,
        run_count = run_count + 1,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'daily'
      and period_start = v_budget.daily_period_start
      and period_end = v_budget.daily_period_end;

  update public.run_budgets
    set run_id = coalesce(p_run_id, run_id),
        settled_cost_usd = v_actual,
        status = 'settled',
        reason = p_terminal_status,
        metadata = coalesce(p_metadata, '{}'::jsonb),
        settled_at = now()
    where id = v_budget.id
    returning * into v_budget;

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
      p_run_id,
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
      p_run_id,
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
    from public.run_budgets
    where user_id = p_user_id
      and request_id = p_request_id
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

  update public.usage_budget_balances
    set reserved_cost_usd = greatest(reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        released_cost_usd = released_cost_usd + v_budget.reserved_cost_usd,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'monthly'
      and period_start = v_budget.monthly_period_start
      and period_end = v_budget.monthly_period_end;

  update public.usage_budget_balances
    set reserved_cost_usd = greatest(reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        released_cost_usd = released_cost_usd + v_budget.reserved_cost_usd,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'daily'
      and period_start = v_budget.daily_period_start
      and period_end = v_budget.daily_period_end;

  update public.run_budgets
    set run_id = coalesce(p_run_id, run_id),
        status = 'released',
        reason = p_reason,
        settled_at = now()
    where id = v_budget.id
    returning * into v_budget;

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
      p_run_id,
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
      p_run_id,
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

revoke all on function public.ensure_usage_budget_balance(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.reserve_execution_budget(uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, numeric, numeric, numeric, timestamptz)
  from public, anon, authenticated;
revoke all on function public.attach_execution_budget_run(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.settle_execution_budget(uuid, text, uuid, numeric, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.release_execution_budget(uuid, text, uuid, text)
  from public, anon, authenticated;

grant execute on function public.reserve_execution_budget(uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, numeric, numeric, numeric, timestamptz)
  to service_role;
grant execute on function public.attach_execution_budget_run(uuid, text, uuid)
  to service_role;
grant execute on function public.settle_execution_budget(uuid, text, uuid, numeric, text, jsonb)
  to service_role;
grant execute on function public.release_execution_budget(uuid, text, uuid, text)
  to service_role;
