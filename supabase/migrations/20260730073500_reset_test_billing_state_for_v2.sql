-- One-time Billing Flow V2 cutover hygiene.
--
-- The production owner confirmed that every pre-V2 Toss row was an internal
-- test. A fresh database has none of these rows and therefore takes the
-- no-op path. Any non-empty database that does not exactly match the reviewed
-- test snapshot is left untouched; the V2 zero-state gate then prevents an
-- activation until it has been explicitly reviewed.

do $$
declare
  v_customer_count integer;
  v_checkout_count integer;
  v_subscription_count integer;
  v_payment_count integer;
  v_paid_entitlement_count integer;
  v_operation_count integer;
  v_retired_key_count integer;
  v_open_checkout_count integer;
  v_unexpected_subscription_count integer;
  v_unexpected_payment_count integer;
  v_free_plan public.billing_plan_versions%rowtype;
  v_reset_entitlement_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('billing-flow-v2-test-reset', 0));

  select count(*) into v_customer_count
    from public.billing_toss_customers;
  select count(*) into v_checkout_count
    from public.billing_toss_checkout_sessions;
  select count(*) into v_subscription_count
    from public.billing_toss_subscriptions;
  select count(*) into v_payment_count
    from public.billing_toss_payments;
  select count(*) into v_paid_entitlement_count
    from public.user_entitlements
    where plan_key in ('standard', 'pro')
      and status in ('active', 'past_due', 'grace');
  select count(*) into v_operation_count
    from public.billing_toss_operations;
  select count(*) into v_retired_key_count
    from public.billing_toss_retired_billing_keys;

  -- This makes the migration safe for a fresh local/staging database.
  if v_customer_count = 0
     and v_checkout_count = 0
     and v_subscription_count = 0
     and v_payment_count = 0
     and v_paid_entitlement_count = 0
     and v_operation_count = 0
     and v_retired_key_count = 0 then
    return;
  end if;

  select count(*) into v_open_checkout_count
    from public.billing_toss_checkout_sessions
    where status = 'processing'
       or (
         status in ('created', 'auth_succeeded')
         and expires_at > now()
       );
  select count(*) into v_unexpected_subscription_count
    from public.billing_toss_subscriptions
    where status <> 'pending_cancel'
       or cancel_at_period_end is not true;
  select count(*) into v_unexpected_payment_count
    from public.billing_toss_payments
    where status <> 'paid'
       or provider_status <> 'DONE';

  if v_customer_count <> 4
     or v_checkout_count <> 27
     or v_subscription_count <> 2
     or v_payment_count <> 3
     or v_paid_entitlement_count <> 2
     or v_operation_count <> 0
     or v_retired_key_count <> 0
     or v_open_checkout_count <> 0
     or v_unexpected_subscription_count <> 0
     or v_unexpected_payment_count <> 0 then
    raise notice
      'billing_v2_test_reset_skipped: customers %, checkouts %, subscriptions %, payments %, paid_entitlements %, operations %, retired_keys %, open_checkouts %, unexpected_subscriptions %, unexpected_payments %',
      v_customer_count,
      v_checkout_count,
      v_subscription_count,
      v_payment_count,
      v_paid_entitlement_count,
      v_operation_count,
      v_retired_key_count,
      v_open_checkout_count,
      v_unexpected_subscription_count,
      v_unexpected_payment_count;
    return;
  end if;

  select * into v_free_plan
    from public.billing_plan_versions
    where plan_key = 'free'
      and is_current
    order by effective_from desc
    limit 1;
  if not found then
    raise exception 'free_plan_version_missing';
  end if;

  -- Keep the test accounts, but remove every paid capability and provider
  -- reference before deleting the test billing ledger.
  update public.user_entitlements
    set plan_key = 'free',
        status = 'active',
        current_period_start = now(),
        current_period_end = now() + interval '100 years',
        billing_period_start = now(),
        billing_period_end = now() + interval '100 years',
        credit_anchor_at = null,
        plan_version_id = v_free_plan.id,
        provider_customer_id = null,
        provider_subscription_id = null,
        provider_price_id = v_free_plan.provider_price_id,
        cancel_at_period_end = false,
        plan_change_pending = null,
        grace_until = null,
        entitlement_updated_at = now()
    where plan_key in ('standard', 'pro')
      and status in ('active', 'past_due', 'grace');
  get diagnostics v_reset_entitlement_count = row_count;
  if v_reset_entitlement_count <> 2 then
    raise exception 'billing_v2_test_reset_entitlement_count_mismatch: %', v_reset_entitlement_count;
  end if;

  delete from public.billing_toss_operations;
  delete from public.billing_toss_retired_billing_keys;
  delete from public.billing_toss_payments;
  delete from public.billing_toss_checkout_sessions;
  delete from public.billing_toss_subscriptions;
  delete from public.billing_toss_customers;
end;
$$;
