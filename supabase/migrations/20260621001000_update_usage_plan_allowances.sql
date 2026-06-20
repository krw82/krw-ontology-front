-- Align public plan usage allowances with the user-facing usage packaging.

do $$
begin
  if to_regclass('public.billing_plan_versions') is not null then
    update public.billing_plan_versions
      set is_current = false,
          effective_to = coalesce(effective_to, '2026-06-21T00:00:00Z'::timestamptz)
      where plan_key in ('free', 'pro')
        and is_current = true;

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
      ('free', 'free-2026-06-usage-v2', 0, 200000, 'credit-v1', null, '2026-06-21T00:00:00Z', true),
      ('pro', 'pro-2026-06-usage-v2', 29000, 10000000, 'credit-v1', null, '2026-06-21T00:00:00Z', true)
    on conflict (plan_key, plan_version) do update
      set monthly_price_krw = excluded.monthly_price_krw,
          weekly_credit_limit_raw = excluded.weekly_credit_limit_raw,
          credit_policy_version = excluded.credit_policy_version,
          provider_price_id = excluded.provider_price_id,
          effective_from = excluded.effective_from,
          is_current = excluded.is_current;
  end if;
end $$;

update public.billing_plans
  set description = '첫 리서치 흐름을 확인하는 체험용 플랜',
      monthly_analysis_credits = 200000,
      monthly_budget_usd = 0.121333,
      weekly_analysis_credits_raw = 200000,
      plan_version = 'free-2026-06-usage-v2',
      updated_at = now()
  where key = 'free';

update public.billing_plans
  set description = '여러 기업 비교와 고빈도 리서치를 위한 넉넉한 사용량',
      monthly_analysis_credits = 10000000,
      monthly_budget_usd = 6.066667,
      weekly_analysis_credits_raw = 10000000,
      plan_version = 'pro-2026-06-usage-v2',
      updated_at = now()
  where key = 'pro';

update public.user_entitlements ue
  set plan_version_id = bpv.id,
      entitlement_updated_at = now()
  from public.billing_plan_versions bpv
  where bpv.plan_key = ue.plan_key
    and bpv.is_current = true
    and ue.plan_key in ('free', 'pro');
