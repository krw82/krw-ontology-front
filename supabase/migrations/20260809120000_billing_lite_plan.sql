-- Introduce the paid Lite plan and reduce the new Free weekly allowance.
-- Existing paid subscriptions keep their current price and plan version.

-- Expand plan-key constraints before inserting the new plan or accepting a
-- Lite checkout. The named constraints are present in the billing migrations;
-- IF EXISTS keeps this migration safe across older local databases.
alter table public.user_entitlements
  drop constraint if exists user_entitlements_plan_key_check;
alter table public.user_entitlements
  add constraint user_entitlements_plan_key_check
  check (plan_key in ('free', 'lite', 'standard', 'pro', 'beta', 'internal'));

alter table public.billing_plans
  drop constraint if exists billing_plans_key_check;
alter table public.billing_plans
  add constraint billing_plans_key_check
  check (key in ('free', 'lite', 'standard', 'pro', 'beta', 'internal'));

alter table public.billing_plan_versions
  drop constraint if exists billing_plan_versions_plan_key_check;
alter table public.billing_plan_versions
  add constraint billing_plan_versions_plan_key_check
  check (plan_key in ('free', 'lite', 'standard', 'pro', 'beta', 'internal'));

alter table public.usage_credit_balances
  drop constraint if exists usage_credit_balances_plan_key_snapshot_check;
alter table public.usage_credit_balances
  add constraint usage_credit_balances_plan_key_snapshot_check
  check (plan_key_snapshot in ('free', 'lite', 'standard', 'pro', 'beta', 'internal'));

alter table public.run_credit_reservations
  drop constraint if exists run_credit_reservations_plan_key_snapshot_check;
alter table public.run_credit_reservations
  add constraint run_credit_reservations_plan_key_snapshot_check
  check (plan_key_snapshot in ('free', 'lite', 'standard', 'pro', 'beta', 'internal'));

alter table public.billing_toss_checkout_sessions
  drop constraint if exists billing_toss_checkout_sessions_plan_key_check;
alter table public.billing_toss_checkout_sessions
  add constraint billing_toss_checkout_sessions_plan_key_check
  check (plan_key in ('lite', 'standard', 'pro'));

alter table public.billing_toss_subscriptions
  drop constraint if exists billing_toss_subscriptions_plan_key_check;
alter table public.billing_toss_subscriptions
  add constraint billing_toss_subscriptions_plan_key_check
  check (plan_key in ('lite', 'standard', 'pro'));

alter table public.billing_toss_subscriptions
  drop constraint if exists billing_toss_subscriptions_pending_plan_key_check;
alter table public.billing_toss_subscriptions
  add constraint billing_toss_subscriptions_pending_plan_key_check
  check (pending_plan_key is null or pending_plan_key in ('lite', 'standard', 'pro'));

alter table public.billing_toss_payments
  drop constraint if exists billing_toss_payments_plan_key_check;
alter table public.billing_toss_payments
  add constraint billing_toss_payments_plan_key_check
  check (plan_key in ('lite', 'standard', 'pro'));

alter table public.billing_toss_operations
  drop constraint if exists billing_toss_operations_from_plan_key_check;
alter table public.billing_toss_operations
  add constraint billing_toss_operations_from_plan_key_check
  check (from_plan_key is null or from_plan_key in ('lite', 'standard', 'pro'));

alter table public.billing_toss_operations
  drop constraint if exists billing_toss_operations_target_plan_key_check;
alter table public.billing_toss_operations
  add constraint billing_toss_operations_target_plan_key_check
  check (target_plan_key is null or target_plan_key in ('lite', 'standard', 'pro'));

-- Version the allowance change. Current weekly balances retain their snapshot;
-- the next refill uses the new Free version.
update public.billing_plan_versions
   set is_current = false,
       effective_to = coalesce(effective_to, '2026-08-09T12:00:00Z'::timestamptz)
 where plan_key = 'free'
   and is_current = true
   and plan_version <> 'free-2026-08-usage-v4';

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
  ('free', 'free-2026-08-usage-v4', 0, 250000, 'credit-v1', null, '2026-08-09T12:00:00Z', true),
  ('lite', 'lite-2026-08-credit-v1', 2900, 750000, 'credit-v1', null, '2026-08-09T12:00:00Z', true)
on conflict (plan_key, plan_version) do update
  set monthly_price_krw = excluded.monthly_price_krw,
      weekly_credit_limit_raw = excluded.weekly_credit_limit_raw,
      credit_policy_version = excluded.credit_policy_version,
      provider_price_id = excluded.provider_price_id,
      effective_from = excluded.effective_from,
      effective_to = null,
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
  ('free', 'Free', '무료', '첫 리서치 흐름을 확인하는 체험용 플랜', 'weekly', 250000, null, 0.151667, null, 0, 0, false, 10, true, 0, 250000, 'free-2026-08-usage-v4', 'credit-v1', null, 'monthly', 'weekly'),
  ('lite', 'Lite', '가벼운 유료 플랜', '와이드 리서치를 시작하는 첫 유료 플랜', 'weekly', 750000, null, 0.455000, null, 0, 0, false, 20, true, 2900, 750000, 'lite-2026-08-credit-v1', 'credit-v1', null, 'monthly', 'weekly')
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

update public.user_entitlements entitlement
   set plan_version_id = version.id,
       provider_price_id = coalesce(entitlement.provider_price_id, version.provider_price_id),
       entitlement_updated_at = now()
  from public.billing_plan_versions version
 where entitlement.plan_key = 'free'
   and version.plan_key = 'free'
   and version.is_current = true;

-- Keep the public order deterministic after inserting Lite between Free and
-- Standard. Existing paid plan versions and prices are intentionally unchanged.
update public.billing_plans
   set sort_order = 30,
       description = '와이드 리서치와 더 넉넉한 분석량을 위한 플랜',
       updated_at = now()
 where key = 'standard';
update public.billing_plans
   set sort_order = 40,
       updated_at = now()
 where key = 'pro';

-- The billing procedures are versioned in earlier migrations. Rebuild their
-- current definitions with Lite added to every paid-plan allow-list. This
-- keeps renewal, quote, reservation, settlement, and coverage reconciliation
-- behavior consistent without duplicating long procedure bodies here.
do $$
declare
  function_row record;
  function_sql text;
begin
  for function_row in
    select p.oid
     from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%''standard'', ''pro''%'
  loop
    function_sql := pg_get_functiondef(function_row.oid);
    function_sql := regexp_replace(
      function_sql,
      '''free''\s*,\s*''standard''\s*,\s*''pro''\s*,\s*''beta''\s*,\s*''internal''',
      '''free'', ''lite'', ''standard'', ''pro'', ''beta'', ''internal''',
      'g'
    );
    function_sql := regexp_replace(
      function_sql,
      '''free''\s*,\s*''standard''\s*,\s*''pro''',
      '''free'', ''lite'', ''standard'', ''pro''',
      'g'
    );
    function_sql := regexp_replace(
      function_sql,
      '''standard''\s*,\s*''pro''',
      '''lite'', ''standard'', ''pro''',
      'g'
    );
    execute function_sql;
  end loop;
end $$;
