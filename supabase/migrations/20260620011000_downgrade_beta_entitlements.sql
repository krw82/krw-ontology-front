-- End beta access for existing entitlement rows. Users keep Free access and can
-- upgrade to paid plans through Toss subscriptions.
with free_plan_version as (
  select id, provider_price_id
    from public.billing_plan_versions
    where plan_key = 'free'
      and is_current
    order by effective_from desc
    limit 1
)
update public.user_entitlements as ue
  set plan_key = 'free',
      status = 'active',
      current_period_start = now(),
      current_period_end = now() + interval '100 years',
      billing_period_start = now(),
      billing_period_end = now() + interval '100 years',
      credit_anchor_at = now(),
      plan_version_id = free_plan_version.id,
      provider_price_id = free_plan_version.provider_price_id,
      provider_subscription_id = null,
      cancel_at_period_end = false,
      plan_change_pending = null,
      entitlement_updated_at = now()
  from free_plan_version
  where ue.plan_key = 'beta';
