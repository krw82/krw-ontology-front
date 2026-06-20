-- Weekly raw analysis-credit shadow ledger.
--
-- This migration keeps the existing USD execution-budget ledger intact and
-- adds a versioned raw-credit ledger for shadow accounting. Enforcement can be
-- switched later after dual-write metrics prove the new policy.

create table if not exists public.credit_policies (
  version text primary key,
  input_token_weight integer not null check (input_token_weight >= 0),
  output_token_weight integer not null check (output_token_weight >= 0),
  display_scale integer not null check (display_scale > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.provider_pricing_policies (
  version text primary key,
  provider text not null,
  provider_model text not null,
  provider_model_version text not null,
  input_cache_hit_cost_per_million numeric(12, 8) not null check (input_cache_hit_cost_per_million >= 0),
  input_cache_miss_cost_per_million numeric(12, 8) not null check (input_cache_miss_cost_per_million >= 0),
  output_cost_per_million numeric(12, 8) not null check (output_cost_per_million >= 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

insert into public.credit_policies (
  version,
  input_token_weight,
  output_token_weight,
  display_scale
)
values ('credit-v1', 1, 2, 1000)
on conflict (version) do update
  set input_token_weight = excluded.input_token_weight,
      output_token_weight = excluded.output_token_weight,
      display_scale = excluded.display_scale;

insert into public.provider_pricing_policies (
  version,
  provider,
  provider_model,
  provider_model_version,
  input_cache_hit_cost_per_million,
  input_cache_miss_cost_per_million,
  output_cost_per_million,
  effective_from
)
values (
  'deepseek-v4-flash-2026-06',
  'deepseek',
  'deepseek-v4-flash',
  'DeepSeek-V4-Flash',
  0.0028,
  0.14,
  0.28,
  '2026-06-01T00:00:00Z'
)
on conflict (version) do update
  set provider = excluded.provider,
      provider_model = excluded.provider_model,
      provider_model_version = excluded.provider_model_version,
      input_cache_hit_cost_per_million = excluded.input_cache_hit_cost_per_million,
      input_cache_miss_cost_per_million = excluded.input_cache_miss_cost_per_million,
      output_cost_per_million = excluded.output_cost_per_million,
      effective_from = excluded.effective_from;

alter table public.user_entitlements
  drop constraint if exists user_entitlements_plan_key_check;

update public.user_entitlements
  set plan_key = case
    when plan_key = 'pro' then 'standard'
    when plan_key = 'power' then 'pro'
    else plan_key
  end
  where plan_key in ('pro', 'power');

alter table public.user_entitlements
  add constraint user_entitlements_plan_key_check
  check (plan_key in ('free', 'standard', 'pro', 'beta', 'internal'));

alter table public.user_entitlements
  drop constraint if exists user_entitlements_status_check;

alter table public.user_entitlements
  add constraint user_entitlements_status_check
  check (status in ('active', 'paused', 'past_due', 'grace', 'cancelled', 'expired'));

alter table public.user_entitlements
  add column if not exists billing_period_start timestamptz,
  add column if not exists billing_period_end timestamptz,
  add column if not exists credit_anchor_at timestamptz,
  add column if not exists plan_version_id uuid,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists plan_change_pending jsonb,
  add column if not exists provider_price_id text,
  add column if not exists entitlement_updated_at timestamptz not null default now();

update public.user_entitlements
  set billing_period_start = coalesce(billing_period_start, current_period_start),
      billing_period_end = coalesce(billing_period_end, current_period_end),
      credit_anchor_at = coalesce(credit_anchor_at, current_period_start),
      entitlement_updated_at = now()
  where billing_period_start is null
     or billing_period_end is null
     or credit_anchor_at is null;

alter table public.billing_plans
  drop constraint if exists billing_plans_key_check;

delete from public.billing_plans
  where key = 'standard'
    and exists (select 1 from public.billing_plans where key = 'pro');

update public.billing_plans
  set key = 'standard'
  where key = 'pro';

delete from public.billing_plans where key = 'power';

alter table public.billing_plans
  add constraint billing_plans_key_check
  check (key in ('free', 'standard', 'pro', 'beta', 'internal'));

alter table public.billing_plans
  drop constraint if exists billing_plans_budget_period_check;

alter table public.billing_plans
  add constraint billing_plans_budget_period_check
  check (budget_period in ('daily', 'weekly', 'monthly'));

alter table public.billing_plans
  add column if not exists monthly_price_krw integer not null default 0 check (monthly_price_krw >= 0),
  add column if not exists weekly_analysis_credits_raw bigint check (weekly_analysis_credits_raw is null or weekly_analysis_credits_raw >= 0),
  add column if not exists plan_version text,
  add column if not exists credit_policy_version text,
  add column if not exists provider_price_id text,
  add column if not exists billing_interval text not null default 'monthly' check (billing_interval in ('monthly')),
  add column if not exists credit_period_kind text not null default 'weekly' check (credit_period_kind in ('weekly'));

create table if not exists public.billing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null check (plan_key in ('free', 'standard', 'pro', 'beta', 'internal')),
  plan_version text not null,
  monthly_price_krw integer not null check (monthly_price_krw >= 0),
  weekly_credit_limit_raw bigint check (weekly_credit_limit_raw is null or weekly_credit_limit_raw >= 0),
  credit_policy_version text not null references public.credit_policies(version),
  provider_price_id text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (plan_key, plan_version),
  check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists idx_billing_plan_versions_current
  on public.billing_plan_versions (plan_key)
  where is_current;

insert into public.billing_plan_versions (
  plan_key,
  plan_version,
  monthly_price_krw,
  weekly_credit_limit_raw,
  credit_policy_version,
  provider_price_id,
  effective_from,
  is_current
)
values
  ('free', 'free-2026-06-credit-v1', 0, 300000, 'credit-v1', null, '2026-06-20T00:00:00Z', true),
  ('standard', 'standard-2026-06-credit-v1', 7900, 2000000, 'credit-v1', null, '2026-06-20T00:00:00Z', true),
  ('pro', 'pro-2026-06-credit-v1', 29000, 6000000, 'credit-v1', null, '2026-06-20T00:00:00Z', true),
  ('beta', 'beta-2026-06-credit-v1', 0, 2000000, 'credit-v1', null, '2026-06-20T00:00:00Z', true),
  ('internal', 'internal-2026-06-credit-v1', 0, null, 'credit-v1', null, '2026-06-20T00:00:00Z', true)
on conflict (plan_key, plan_version) do update
  set monthly_price_krw = excluded.monthly_price_krw,
      weekly_credit_limit_raw = excluded.weekly_credit_limit_raw,
      credit_policy_version = excluded.credit_policy_version,
      provider_price_id = excluded.provider_price_id,
      effective_from = excluded.effective_from,
      is_current = excluded.is_current;

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
  is_public,
  monthly_price_krw,
  weekly_analysis_credits_raw,
  plan_version,
  credit_policy_version,
  provider_price_id,
  billing_interval,
  credit_period_kind
)
values
  ('free', 'Free', '무료', '개인 테스트와 가벼운 기업 리서치용 기본 분석 크레딧', 'weekly', 300000, null, 0.182000, null, 0, 0, false, 10, true, 0, 300000, 'free-2026-06-credit-v1', 'credit-v1', null, 'monthly', 'weekly'),
  ('standard', 'Standard', '개인 분석', '매주 리서치를 반복하는 개인 투자자를 위한 주간 분석 크레딧', 'weekly', 2000000, null, 1.213333, null, 0, 0, false, 20, true, 7900, 2000000, 'standard-2026-06-credit-v1', 'credit-v1', null, 'monthly', 'weekly'),
  ('pro', 'Pro', '고급 분석', '여러 기업 비교와 고빈도 리서치를 위한 고용량 주간 크레딧', 'weekly', 6000000, null, 3.640000, null, 0, 0, false, 30, true, 29000, 6000000, 'pro-2026-06-credit-v1', 'credit-v1', null, 'monthly', 'weekly'),
  ('beta', 'Beta', '운영 전 테스트', '정식 과금 전 품질과 분석 크레딧 정책을 검증하는 무료 베타 플랜', 'weekly', 2000000, null, 1.213333, null, 0, 0, false, 5, false, 0, 2000000, 'beta-2026-06-credit-v1', 'credit-v1', null, 'monthly', 'weekly'),
  ('internal', 'Internal', '내부 운영', '운영 검증과 장애 대응을 위한 내부 플랜', 'weekly', null, null, null, null, 0, 0, true, 1, false, 0, null, 'internal-2026-06-credit-v1', 'credit-v1', null, 'monthly', 'weekly')
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
      monthly_price_krw = excluded.monthly_price_krw,
      weekly_analysis_credits_raw = excluded.weekly_analysis_credits_raw,
      plan_version = excluded.plan_version,
      credit_policy_version = excluded.credit_policy_version,
      provider_price_id = excluded.provider_price_id,
      billing_interval = excluded.billing_interval,
      credit_period_kind = excluded.credit_period_kind,
      updated_at = now();

update public.user_entitlements ue
  set plan_version_id = bpv.id,
      provider_price_id = coalesce(ue.provider_price_id, bpv.provider_price_id),
      entitlement_updated_at = now()
  from public.billing_plan_versions bpv
  where bpv.plan_key = ue.plan_key
    and bpv.is_current
    and ue.plan_version_id is null;

create table if not exists public.usage_credit_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_kind text not null check (period_kind in ('weekly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  plan_key_snapshot text not null check (plan_key_snapshot in ('free', 'standard', 'pro', 'beta', 'internal')),
  plan_version_id uuid references public.billing_plan_versions(id),
  credit_policy_version text not null references public.credit_policies(version),
  credits_limit_raw bigint not null check (credits_limit_raw >= 0),
  credits_used_raw bigint not null default 0 check (credits_used_raw >= 0),
  credits_reserved_raw bigint not null default 0 check (credits_reserved_raw >= 0),
  credits_released_raw bigint not null default 0 check (credits_released_raw >= 0),
  actual_provider_cost_usd numeric(12, 6) not null default 0 check (actual_provider_cost_usd >= 0),
  run_count integer not null default 0 check (run_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_kind, period_start, period_end),
  check (period_end > period_start)
);

create table if not exists public.run_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  run_id uuid references public.agent_runs(id) on delete set null,
  credit_period_start timestamptz not null,
  credit_period_end timestamptz not null,
  reserved_credits_raw bigint not null check (reserved_credits_raw >= 0),
  settled_credits_raw bigint not null default 0 check (settled_credits_raw >= 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'running', 'settled', 'released', 'expired')),
  terminal_status text,
  plan_key_snapshot text not null check (plan_key_snapshot in ('free', 'standard', 'pro', 'beta', 'internal')),
  plan_version_id uuid references public.billing_plan_versions(id),
  credit_policy_version text not null references public.credit_policies(version),
  provider text,
  provider_model text,
  provider_model_version text,
  pricing_version text references public.provider_pricing_policies(version),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  prompt_cache_hit_tokens integer not null default 0 check (prompt_cache_hit_tokens >= 0),
  prompt_cache_miss_tokens integer not null default 0 check (prompt_cache_miss_tokens >= 0),
  actual_provider_cost_usd numeric(12, 6) not null default 0 check (actual_provider_cost_usd >= 0),
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, request_id),
  check (credit_period_end > credit_period_start)
);

create index if not exists idx_run_credit_reservations_active
  on public.run_credit_reservations (user_id, status, expires_at)
  where status in ('reserved', 'running');

create index if not exists idx_run_credit_reservations_run_id
  on public.run_credit_reservations (run_id)
  where run_id is not null;

create table if not exists public.usage_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_credit_reservation_id uuid references public.run_credit_reservations(id) on delete set null,
  run_id uuid references public.agent_runs(id) on delete set null,
  request_id text not null,
  period_kind text not null check (period_kind in ('weekly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  entry_type text not null
    check (entry_type in ('reservation', 'settlement', 'release', 'adjustment', 'expiry')),
  amount_credits_raw bigint not null check (amount_credits_raw >= 0),
  actual_provider_cost_usd numeric(12, 6) not null default 0 check (actual_provider_cost_usd >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);

create index if not exists idx_usage_credit_ledger_user_period
  on public.usage_credit_ledger (user_id, period_kind, period_start, created_at desc);

alter table public.credit_policies enable row level security;
alter table public.provider_pricing_policies enable row level security;
alter table public.billing_plan_versions enable row level security;
alter table public.usage_credit_balances enable row level security;
alter table public.run_credit_reservations enable row level security;
alter table public.usage_credit_ledger enable row level security;

create policy "Anyone can read credit policies"
  on public.credit_policies for select using (true);

create policy "Anyone can read provider pricing policies"
  on public.provider_pricing_policies for select using (true);

create policy "Anyone can read billing plan versions"
  on public.billing_plan_versions for select using (true);

create policy "Users can read own credit balances"
  on public.usage_credit_balances for select using (auth.uid() = user_id);

create policy "Users can read own credit reservations"
  on public.run_credit_reservations for select using (auth.uid() = user_id);

create policy "Users can read own credit ledger"
  on public.usage_credit_ledger for select using (auth.uid() = user_id);

revoke all on public.credit_policies from public, anon, authenticated;
revoke all on public.provider_pricing_policies from public, anon, authenticated;
revoke all on public.billing_plan_versions from public, anon, authenticated;
revoke all on public.usage_credit_balances from public, anon, authenticated;
revoke all on public.run_credit_reservations from public, anon, authenticated;
revoke all on public.usage_credit_ledger from public, anon, authenticated;

grant select on public.credit_policies to anon, authenticated, service_role;
grant select on public.provider_pricing_policies to anon, authenticated, service_role;
grant select on public.billing_plan_versions to anon, authenticated, service_role;
grant select on public.usage_credit_balances to authenticated;
grant select on public.run_credit_reservations to authenticated;
grant select on public.usage_credit_ledger to authenticated;
grant select, insert, update, delete on public.credit_policies to service_role;
grant select, insert, update, delete on public.provider_pricing_policies to service_role;
grant select, insert, update, delete on public.billing_plan_versions to service_role;
grant select, insert, update, delete on public.usage_credit_balances to service_role;
grant select, insert, update, delete on public.run_credit_reservations to service_role;
grant select, insert, update, delete on public.usage_credit_ledger to service_role;

create or replace function public.current_weekly_credit_period(
  p_credit_anchor_at timestamptz,
  p_now timestamptz,
  out period_start timestamptz,
  out period_end timestamptz
)
language plpgsql
stable
as $$
declare
  v_week_index bigint;
  v_period_start timestamptz;
begin
  if p_credit_anchor_at is null then
    raise exception 'credit_anchor_at is required';
  end if;

  v_week_index := greatest(
    floor(extract(epoch from (p_now - p_credit_anchor_at)) / 604800)::bigint,
    0
  );
  v_period_start := p_credit_anchor_at + (v_week_index * interval '7 days');
  period_start := v_period_start;
  period_end := v_period_start + interval '7 days';
end;
$$;

create or replace function public.reserve_analysis_credits(
  p_user_id uuid,
  p_request_id text,
  p_reserve_credits_raw bigint,
  p_expires_at timestamptz,
  p_now timestamptz default now()
)
returns table (
  allowed boolean,
  reason text,
  reservation_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  credits_used_raw bigint,
  credits_reserved_raw bigint,
  credits_limit_raw bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent public.user_entitlements%rowtype;
  v_plan_version public.billing_plan_versions%rowtype;
  v_balance public.usage_credit_balances%rowtype;
  v_existing public.run_credit_reservations%rowtype;
  v_plan_key text;
  v_anchor timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_reserve bigint := greatest(coalesce(p_reserve_credits_raw, 0), 0);
  v_limit bigint;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_request_id is null or length(trim(p_request_id)) = 0 then
    raise exception 'request_id is required';
  end if;

  select *
    into v_ent
    from public.user_entitlements
    where user_id = p_user_id
    for update;

  if not found then
    select *
      into v_plan_version
      from public.billing_plan_versions
      where plan_key = 'free'
        and is_current
      order by effective_from desc
      limit 1;

    insert into public.user_entitlements (
      user_id,
      plan_key,
      status,
      current_period_start,
      current_period_end,
      billing_period_start,
      billing_period_end,
      credit_anchor_at,
      plan_version_id,
      provider_price_id
    )
    values (
      p_user_id,
      'free',
      'active',
      p_now,
      p_now + interval '100 years',
      p_now,
      p_now + interval '100 years',
      p_now,
      v_plan_version.id,
      v_plan_version.provider_price_id
    )
    returning * into v_ent;
  end if;

  if v_ent.status not in ('active', 'grace') then
    return query select false, 'entitlement_inactive', null::uuid, null::timestamptz, null::timestamptz, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  v_plan_key := case
    when v_ent.plan_key = 'power' then 'pro'
    when v_ent.plan_key in ('free', 'standard', 'pro', 'beta', 'internal') then v_ent.plan_key
    else 'free'
  end;

  select *
    into v_plan_version
    from public.billing_plan_versions
    where id = v_ent.plan_version_id;

  if not found or v_plan_version.plan_key <> v_plan_key then
    select *
      into v_plan_version
      from public.billing_plan_versions
      where plan_key = v_plan_key
        and is_current
      order by effective_from desc
      limit 1;

    update public.user_entitlements
      set plan_key = v_plan_key,
          plan_version_id = v_plan_version.id,
          provider_price_id = coalesce(v_ent.provider_price_id, v_plan_version.provider_price_id),
          entitlement_updated_at = now()
      where user_id = p_user_id
      returning * into v_ent;
  end if;

  v_anchor := coalesce(v_ent.credit_anchor_at, p_now);
  if v_ent.credit_anchor_at is null then
    update public.user_entitlements
      set credit_anchor_at = v_anchor,
          entitlement_updated_at = now()
      where user_id = p_user_id
      returning * into v_ent;
  end if;

  select period_start, period_end
    into v_period_start, v_period_end
    from public.current_weekly_credit_period(v_anchor, p_now);

  v_limit := case
    when v_plan_key = 'internal' then 9007199254740991::bigint
    else coalesce(v_plan_version.weekly_credit_limit_raw, 0)
  end;

  insert into public.usage_credit_balances (
    user_id,
    period_kind,
    period_start,
    period_end,
    plan_key_snapshot,
    plan_version_id,
    credit_policy_version,
    credits_limit_raw
  )
  values (
    p_user_id,
    'weekly',
    v_period_start,
    v_period_end,
    v_plan_key,
    v_plan_version.id,
    v_plan_version.credit_policy_version,
    v_limit
  )
  on conflict (user_id, period_kind, period_start, period_end) do nothing;

  select *
    into v_balance
    from public.usage_credit_balances
    where user_id = p_user_id
      and period_kind = 'weekly'
      and period_start = v_period_start
      and period_end = v_period_end
    for update;

  select *
    into v_existing
    from public.run_credit_reservations
    where user_id = p_user_id
      and request_id = p_request_id
    for update;

  if found and v_existing.status in ('reserved', 'running', 'settled') then
    return query select true, null::text, v_existing.id, v_period_start, v_period_end, v_balance.credits_used_raw, v_balance.credits_reserved_raw, v_balance.credits_limit_raw;
    return;
  end if;

  if v_balance.credits_used_raw + v_balance.credits_reserved_raw + v_reserve > v_balance.credits_limit_raw then
    return query select false, 'weekly_credit_limit_exceeded', null::uuid, v_period_start, v_period_end, v_balance.credits_used_raw, v_balance.credits_reserved_raw, v_balance.credits_limit_raw;
    return;
  end if;

  if found then
    update public.run_credit_reservations
      set credit_period_start = v_period_start,
          credit_period_end = v_period_end,
          reserved_credits_raw = v_reserve,
          settled_credits_raw = 0,
          status = 'reserved',
          terminal_status = null,
          plan_key_snapshot = v_plan_key,
          plan_version_id = v_plan_version.id,
          credit_policy_version = v_plan_version.credit_policy_version,
          input_tokens = 0,
          output_tokens = 0,
          prompt_cache_hit_tokens = 0,
          prompt_cache_miss_tokens = 0,
          actual_provider_cost_usd = 0,
          metadata = '{}'::jsonb,
          expires_at = p_expires_at,
          settled_at = null
      where id = v_existing.id
      returning * into v_existing;
  else
    insert into public.run_credit_reservations (
      user_id,
      request_id,
      credit_period_start,
      credit_period_end,
      reserved_credits_raw,
      plan_key_snapshot,
      plan_version_id,
      credit_policy_version,
      expires_at
    )
    values (
      p_user_id,
      p_request_id,
      v_period_start,
      v_period_end,
      v_reserve,
      v_plan_key,
      v_plan_version.id,
      v_plan_version.credit_policy_version,
      p_expires_at
    )
    returning * into v_existing;
  end if;

  update public.usage_credit_balances
    set credits_reserved_raw = credits_reserved_raw + v_reserve,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'weekly'
      and period_start = v_period_start
      and period_end = v_period_end
    returning * into v_balance;

  insert into public.usage_credit_ledger (
    user_id,
    run_credit_reservation_id,
    request_id,
    period_kind,
    period_start,
    period_end,
    entry_type,
    amount_credits_raw
  )
  values (
    p_user_id,
    v_existing.id,
    p_request_id,
    'weekly',
    v_period_start,
    v_period_end,
    'reservation',
    v_reserve
  );

  return query select true, null::text, v_existing.id, v_period_start, v_period_end, v_balance.credits_used_raw, v_balance.credits_reserved_raw, v_balance.credits_limit_raw;
end;
$$;

create or replace function public.attach_analysis_credit_run(
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
  update public.run_credit_reservations
    set run_id = p_run_id,
        status = case when status = 'reserved' then 'running' else status end
    where user_id = p_user_id
      and request_id = p_request_id
      and status in ('reserved', 'running');
end;
$$;

create or replace function public.settle_analysis_credits(
  p_user_id uuid,
  p_request_id text,
  p_run_id uuid,
  p_terminal_status text,
  p_settled_credits_raw bigint,
  p_input_tokens integer,
  p_output_tokens integer,
  p_prompt_cache_hit_tokens integer,
  p_prompt_cache_miss_tokens integer,
  p_provider text,
  p_provider_model text,
  p_provider_model_version text,
  p_pricing_version text,
  p_actual_provider_cost_usd numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  settled boolean,
  reservation_id uuid,
  settled_credits_raw bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.run_credit_reservations%rowtype;
  v_settle bigint := greatest(coalesce(p_settled_credits_raw, 0), 0);
  v_release bigint;
  v_cost numeric := greatest(coalesce(p_actual_provider_cost_usd, 0), 0);
begin
  select *
    into v_reservation
    from public.run_credit_reservations
    where user_id = p_user_id
      and request_id = p_request_id
    for update;

  if not found then
    return query select false, null::uuid, 0::bigint;
    return;
  end if;

  if v_reservation.status in ('settled', 'released', 'expired') then
    return query select
      v_reservation.status = 'settled',
      v_reservation.id,
      v_reservation.settled_credits_raw;
    return;
  end if;

  v_release := greatest(v_reservation.reserved_credits_raw - v_settle, 0);

  update public.usage_credit_balances
    set credits_reserved_raw = greatest(credits_reserved_raw - v_reservation.reserved_credits_raw, 0),
        credits_used_raw = credits_used_raw + v_settle,
        credits_released_raw = credits_released_raw + v_release,
        actual_provider_cost_usd = actual_provider_cost_usd + v_cost,
        run_count = run_count + case when v_settle > 0 then 1 else 0 end,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'weekly'
      and period_start = v_reservation.credit_period_start
      and period_end = v_reservation.credit_period_end;

  update public.run_credit_reservations
    set run_id = coalesce(p_run_id, run_id),
        settled_credits_raw = v_settle,
        status = 'settled',
        terminal_status = p_terminal_status,
        provider = p_provider,
        provider_model = p_provider_model,
        provider_model_version = p_provider_model_version,
        pricing_version = p_pricing_version,
        input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
        output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
        prompt_cache_hit_tokens = greatest(coalesce(p_prompt_cache_hit_tokens, 0), 0),
        prompt_cache_miss_tokens = greatest(coalesce(p_prompt_cache_miss_tokens, 0), 0),
        actual_provider_cost_usd = v_cost,
        metadata = coalesce(p_metadata, '{}'::jsonb),
        settled_at = now()
    where id = v_reservation.id
    returning * into v_reservation;

  insert into public.usage_credit_ledger (
    user_id,
    run_credit_reservation_id,
    run_id,
    request_id,
    period_kind,
    period_start,
    period_end,
    entry_type,
    amount_credits_raw,
    actual_provider_cost_usd,
    metadata
  )
  values (
    p_user_id,
    v_reservation.id,
    v_reservation.run_id,
    p_request_id,
    'weekly',
    v_reservation.credit_period_start,
    v_reservation.credit_period_end,
    'settlement',
    v_settle,
    v_cost,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return query select true, v_reservation.id, v_settle;
end;
$$;

create or replace function public.release_analysis_credits(
  p_user_id uuid,
  p_request_id text,
  p_run_id uuid,
  p_reason text
)
returns table (
  released boolean,
  reservation_id uuid,
  released_credits_raw bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.run_credit_reservations%rowtype;
begin
  select *
    into v_reservation
    from public.run_credit_reservations
    where user_id = p_user_id
      and request_id = p_request_id
    for update;

  if not found then
    return query select false, null::uuid, 0::bigint;
    return;
  end if;

  if v_reservation.status in ('settled', 'released', 'expired') then
    return query select
      v_reservation.status = 'released',
      v_reservation.id,
      v_reservation.reserved_credits_raw;
    return;
  end if;

  update public.usage_credit_balances
    set credits_reserved_raw = greatest(credits_reserved_raw - v_reservation.reserved_credits_raw, 0),
        credits_released_raw = credits_released_raw + v_reservation.reserved_credits_raw,
        updated_at = now()
    where user_id = p_user_id
      and period_kind = 'weekly'
      and period_start = v_reservation.credit_period_start
      and period_end = v_reservation.credit_period_end;

  update public.run_credit_reservations
    set run_id = coalesce(p_run_id, run_id),
        status = 'released',
        terminal_status = p_reason,
        metadata = jsonb_build_object('reason', p_reason),
        settled_at = now()
    where id = v_reservation.id
    returning * into v_reservation;

  insert into public.usage_credit_ledger (
    user_id,
    run_credit_reservation_id,
    run_id,
    request_id,
    period_kind,
    period_start,
    period_end,
    entry_type,
    amount_credits_raw,
    metadata
  )
  values (
    p_user_id,
    v_reservation.id,
    v_reservation.run_id,
    p_request_id,
    'weekly',
    v_reservation.credit_period_start,
    v_reservation.credit_period_end,
    'release',
    v_reservation.reserved_credits_raw,
    jsonb_build_object('reason', p_reason)
  );

  return query select true, v_reservation.id, v_reservation.reserved_credits_raw;
end;
$$;

create or replace function public.expire_stale_analysis_credit_reservations(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.run_credit_reservations%rowtype;
  v_count integer := 0;
begin
  for v_reservation in
    select *
      from public.run_credit_reservations
      where status in ('reserved', 'running')
        and expires_at < p_now
      for update
  loop
    update public.usage_credit_balances
      set credits_reserved_raw = greatest(credits_reserved_raw - v_reservation.reserved_credits_raw, 0),
          credits_released_raw = credits_released_raw + v_reservation.reserved_credits_raw,
          updated_at = now()
      where user_id = v_reservation.user_id
        and period_kind = 'weekly'
        and period_start = v_reservation.credit_period_start
        and period_end = v_reservation.credit_period_end;

    update public.run_credit_reservations
      set status = 'expired',
          terminal_status = 'reservation_expired',
          settled_at = now()
      where id = v_reservation.id;

    insert into public.usage_credit_ledger (
      user_id,
      run_credit_reservation_id,
      run_id,
      request_id,
      period_kind,
      period_start,
      period_end,
      entry_type,
      amount_credits_raw,
      metadata
    )
    values (
      v_reservation.user_id,
      v_reservation.id,
      v_reservation.run_id,
      v_reservation.request_id,
      'weekly',
      v_reservation.credit_period_start,
      v_reservation.credit_period_end,
      'expiry',
      v_reservation.reserved_credits_raw,
      jsonb_build_object('reason', 'reservation_expired')
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.current_weekly_credit_period(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_analysis_credits(uuid, text, bigint, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.attach_analysis_credit_run(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.settle_analysis_credits(uuid, text, uuid, text, bigint, integer, integer, integer, integer, text, text, text, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.release_analysis_credits(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.expire_stale_analysis_credit_reservations(timestamptz) from public, anon, authenticated;

grant execute on function public.reserve_analysis_credits(uuid, text, bigint, timestamptz, timestamptz) to service_role;
grant execute on function public.attach_analysis_credit_run(uuid, text, uuid) to service_role;
grant execute on function public.settle_analysis_credits(uuid, text, uuid, text, bigint, integer, integer, integer, integer, text, text, text, text, numeric, jsonb) to service_role;
grant execute on function public.release_analysis_credits(uuid, text, uuid, text) to service_role;
grant execute on function public.expire_stale_analysis_credit_reservations(timestamptz) to service_role;
