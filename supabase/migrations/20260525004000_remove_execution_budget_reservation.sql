-- Store plan credit policy in the database and allow a final run as long as
-- some execution budget remains. This removes pre-run credit reservation while
-- keeping request_id idempotency evidence.

create table if not exists public.billing_plans (
  key text primary key
    check (key in ('free', 'pro', 'power', 'beta', 'internal')),
  label text not null,
  status_label text not null,
  description text not null,
  budget_period text not null default 'monthly'
    check (budget_period in ('daily', 'monthly')),
  monthly_analysis_credits bigint check (monthly_analysis_credits is null or monthly_analysis_credits >= 0),
  daily_analysis_credits bigint check (daily_analysis_credits is null or daily_analysis_credits >= 0),
  monthly_budget_usd numeric(12, 6) check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  daily_budget_usd numeric(12, 6) check (daily_budget_usd is null or daily_budget_usd >= 0),
  per_run_analysis_credits bigint not null default 0 check (per_run_analysis_credits >= 0),
  per_run_reserve_usd numeric(12, 6) not null default 0 check (per_run_reserve_usd >= 0),
  unlimited boolean not null default false,
  sort_order integer not null default 100,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (unlimited or monthly_budget_usd is not null),
  check (unlimited or monthly_analysis_credits is not null)
);

alter table public.billing_plans
  add column if not exists monthly_analysis_credits bigint check (monthly_analysis_credits is null or monthly_analysis_credits >= 0),
  add column if not exists daily_analysis_credits bigint check (daily_analysis_credits is null or daily_analysis_credits >= 0),
  add column if not exists per_run_analysis_credits bigint not null default 0 check (per_run_analysis_credits >= 0);

alter table public.billing_plans enable row level security;

create policy "Anyone can read billing plans"
  on public.billing_plans
  for select
  using (true);

revoke all on public.billing_plans from public, anon, authenticated;
grant select on public.billing_plans to anon, authenticated, service_role;
grant insert, update, delete on public.billing_plans to service_role;

insert into public.billing_plans (
  key,
  label,
  status_label,
  description,
  budget_period,
  monthly_analysis_credits,
  daily_analysis_credits,
  monthly_budget_usd,
  daily_budget_usd,
  per_run_analysis_credits,
  per_run_reserve_usd,
  unlimited,
  sort_order,
  is_public
)
values
  (
    'free',
    'Free',
    '무료',
    '개인 테스트와 가벼운 기업 리서치용 기본 분석 크레딧',
    'monthly',
    20000,
    null,
    20,
    null,
    0,
    0,
    false,
    10,
    true
  ),
  (
    'pro',
    'Pro',
    '개인 분석',
    '정기적으로 기업 리서치를 수행하는 사용자를 위한 분석 크레딧',
    'monthly',
    200000,
    null,
    200,
    null,
    0,
    0,
    false,
    20,
    true
  ),
  (
    'power',
    'Power',
    '고빈도 분석',
    '여러 기업과 주제를 반복 확인하는 고사용량 분석 크레딧',
    'monthly',
    600000,
    null,
    600,
    null,
    0,
    0,
    false,
    30,
    true
  ),
  (
    'beta',
    'Beta',
    '운영 전 테스트',
    '정식 과금 전 품질과 분석 크레딧 정책을 검증하는 무료 베타 플랜',
    'monthly',
    50000,
    null,
    50,
    null,
    0,
    0,
    false,
    5,
    false
  ),
  (
    'internal',
    'Internal',
    '내부 운영',
    '운영 검증과 장애 대응을 위한 내부 플랜',
    'monthly',
    null,
    null,
    null,
    null,
    0,
    0,
    true,
    1,
    false
  )
on conflict (key) do update
  set label = excluded.label,
      status_label = excluded.status_label,
      description = excluded.description,
      budget_period = excluded.budget_period,
      monthly_analysis_credits = excluded.monthly_analysis_credits,
      daily_analysis_credits = excluded.daily_analysis_credits,
      monthly_budget_usd = excluded.monthly_budget_usd,
      daily_budget_usd = excluded.daily_budget_usd,
      per_run_analysis_credits = excluded.per_run_analysis_credits,
      per_run_reserve_usd = excluded.per_run_reserve_usd,
      unlimited = excluded.unlimited,
      sort_order = excluded.sort_order,
      is_public = excluded.is_public,
      updated_at = now();

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
  v_metadata jsonb := jsonb_build_object(
    'monthly_budget_usd', greatest(coalesce(p_monthly_budget_usd, 0), 0),
    'daily_budget_usd', greatest(coalesce(p_daily_budget_usd, 0), 0),
    'reservation_policy', 'none'
  );
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
    from public.usage_budget_balances balance
    where balance.user_id = p_user_id
      and balance.period_kind = 'monthly'
      and balance.period_start = p_monthly_period_start
      and balance.period_end = p_monthly_period_end
    for update;

  select *
    into v_daily
    from public.usage_budget_balances balance
    where balance.user_id = p_user_id
      and balance.period_kind = 'daily'
      and balance.period_start = p_daily_period_start
      and balance.period_end = p_daily_period_end
    for update;

  select *
    into v_existing
    from public.run_budgets rb
    where rb.user_id = p_user_id
      and rb.request_id = p_request_id
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

  if v_monthly.settled_cost_usd + v_monthly.reserved_cost_usd
      >= p_monthly_budget_usd then
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

  if v_daily.settled_cost_usd + v_daily.reserved_cost_usd
      >= p_daily_budget_usd then
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
    update public.run_budgets as rb
      set reserved_cost_usd = 0,
          settled_cost_usd = 0,
          status = 'reserved',
          reason = null,
          metadata = v_metadata,
          expires_at = p_expires_at,
          settled_at = null
      where rb.id = v_existing.id
      returning rb.* into v_existing;
  else
    insert into public.run_budgets (
      user_id,
      request_id,
      monthly_period_start,
      monthly_period_end,
      daily_period_start,
      daily_period_end,
      reserved_cost_usd,
      metadata,
      expires_at
    )
    values (
      p_user_id,
      p_request_id,
      p_monthly_period_start,
      p_monthly_period_end,
      p_daily_period_start,
      p_daily_period_end,
      0,
      v_metadata,
      p_expires_at
    )
    returning * into v_existing;
  end if;

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
  v_monthly public.usage_budget_balances%rowtype;
  v_daily public.usage_budget_balances%rowtype;
  v_actual numeric := greatest(coalesce(p_actual_cost_usd, 0), 0);
  v_charge numeric;
  v_release numeric;
  v_monthly_limit numeric;
  v_daily_limit numeric;
  v_metadata jsonb;
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

  v_monthly_limit := coalesce(nullif(v_budget.metadata->>'monthly_budget_usd', '')::numeric, 0);
  v_daily_limit := coalesce(nullif(v_budget.metadata->>'daily_budget_usd', '')::numeric, 0);

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

  select *
    into v_monthly
    from public.usage_budget_balances balance
    where balance.user_id = p_user_id
      and balance.period_kind = 'monthly'
      and balance.period_start = v_budget.monthly_period_start
      and balance.period_end = v_budget.monthly_period_end
    for update;

  select *
    into v_daily
    from public.usage_budget_balances balance
    where balance.user_id = p_user_id
      and balance.period_kind = 'daily'
      and balance.period_start = v_budget.daily_period_start
      and balance.period_end = v_budget.daily_period_end
    for update;

  v_charge := v_actual;

  if v_monthly_limit > 0 then
    v_charge := least(
      v_charge,
      greatest(
        v_monthly_limit
          - v_monthly.settled_cost_usd
          - greatest(v_monthly.reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        0
      )
    );
  end if;

  if v_daily_limit > 0 then
    v_charge := least(
      v_charge,
      greatest(
        v_daily_limit
          - v_daily.settled_cost_usd
          - greatest(v_daily.reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        0
      )
    );
  end if;

  v_release := greatest(v_budget.reserved_cost_usd - v_charge, 0);
  v_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'actual_cost_usd', v_actual,
    'charged_cost_usd', v_charge,
    'unbilled_cost_usd', greatest(v_actual - v_charge, 0),
    'charge_capped', v_charge < v_actual
  );

  update public.usage_budget_balances as balance
    set reserved_cost_usd = greatest(balance.reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        settled_cost_usd = balance.settled_cost_usd + v_charge,
        released_cost_usd = balance.released_cost_usd + v_release,
        run_count = balance.run_count + 1,
        updated_at = now()
    where balance.user_id = p_user_id
      and balance.period_kind = 'monthly'
      and balance.period_start = v_budget.monthly_period_start
      and balance.period_end = v_budget.monthly_period_end;

  update public.usage_budget_balances as balance
    set reserved_cost_usd = greatest(balance.reserved_cost_usd - v_budget.reserved_cost_usd, 0),
        settled_cost_usd = balance.settled_cost_usd + v_charge,
        released_cost_usd = balance.released_cost_usd + v_release,
        run_count = balance.run_count + 1,
        updated_at = now()
    where balance.user_id = p_user_id
      and balance.period_kind = 'daily'
      and balance.period_start = v_budget.daily_period_start
      and balance.period_end = v_budget.daily_period_end;

  update public.run_budgets as rb
    set run_id = coalesce(p_run_id, rb.run_id),
        settled_cost_usd = v_charge,
        status = 'settled',
        reason = p_terminal_status,
        metadata = v_metadata,
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
      v_charge,
      v_metadata
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
      v_charge,
      v_metadata
    );

  return query select true, v_budget.id, v_charge;
end;
$$;

grant execute on function public.reserve_execution_budget(uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, numeric, numeric, numeric, timestamptz)
  to service_role;
grant execute on function public.settle_execution_budget(uuid, text, uuid, numeric, text, jsonb)
  to service_role;

alter table public.user_entitlements
  alter column plan_key set default 'beta';
