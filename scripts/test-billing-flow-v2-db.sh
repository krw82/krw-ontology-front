#!/bin/sh
set -eu

# Runs entirely inside one transaction and always rolls back. It exercises the
# database-only guarantees that are difficult to cover with a mocked Toss API:
# a cancellation reservation, an upgrade lock, worker contention, and failed
# upgrade preservation of that reservation.
BILLING_V2_TEST_DATABASE_URL=${BILLING_V2_TEST_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for Billing Flow V2 DB tests." >&2
  exit 1
fi

psql "$BILLING_V2_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i supabase/migrations/20260730071817_billing_flow_v2_operations.sql

do $$
declare
  v_user uuid := '11111111-1111-4111-8111-111111111111';
  v_subscription uuid := '22222222-2222-4222-8222-222222222222';
  v_downgrade_user uuid := '33333333-3333-4333-8333-333333333333';
  v_downgrade_subscription uuid := '44444444-4444-4444-8444-444444444444';
  v_renewal_user uuid := '55555555-5555-4555-8555-555555555555';
  v_renewal_subscription uuid := '66666666-6666-4666-8666-666666666666';
  v_standard uuid;
  v_pro uuid;
  v_free uuid;
  v_cancel uuid;
  v_upgrade uuid;
  v_resume uuid;
  v_downgrade_cancel uuid;
  v_downgrade uuid;
  v_claim_count integer;
  v_terminal_count integer;
  v_status text;
  v_entitlement_status text;
  v_entitlement_plan text;
  v_provider_subscription_id text;
  v_cancel_at_end boolean;
  v_entitlement_cancel_at_end boolean;
  v_pending_plan text;
  v_entitlement_pending_plan text;
begin
  select id into v_standard from public.billing_plan_versions
    where plan_key = 'standard' and is_current;
  select id into v_pro from public.billing_plan_versions
    where plan_key = 'pro' and is_current;
  select id into v_free from public.billing_plan_versions
    where plan_key = 'free' and is_current;
  if v_standard is null or v_pro is null or v_free is null then
    raise exception 'test plan versions missing';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'billing-v2-local-test@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

  insert into public.billing_toss_subscriptions (
    id, user_id, plan_key, plan_version_id, status, customer_key, billing_key,
    billing_method, current_period_start, current_period_end, next_billing_at,
    renewal_due_at, cancel_at_period_end
  ) values (
    v_subscription, v_user, 'standard', v_standard, 'active', 'billing-v2-test-customer',
    'billing-v2-test-key', 'CARD', now() - interval '10 days', now() + interval '20 days',
    now() - interval '1 minute', now() + interval '20 days', false
  );
  insert into public.user_entitlements (
    user_id, plan_key, status, current_period_start, current_period_end,
    billing_period_start, billing_period_end, credit_anchor_at, plan_version_id,
    provider_customer_id, provider_subscription_id, provider_price_id, cancel_at_period_end
  ) values (
    v_user, 'standard', 'active', now() - interval '10 days', now() + interval '20 days',
    now() - interval '10 days', now() + interval '20 days', now() - interval '10 days',
    v_standard, 'billing-v2-test-customer', v_subscription::text, null, false
  );

  select operation_id into v_cancel
    from public.prepare_toss_billing_operation(v_user, 'cancel_subscription', null, now());
  select operation_status into v_status
    from public.confirm_toss_billing_operation(v_user, v_cancel, now());
  if v_status <> 'succeeded' then
    raise exception 'cancel operation did not succeed: %', v_status;
  end if;
  select cancel_at_period_end into v_cancel_at_end
    from public.billing_toss_subscriptions where id = v_subscription;
  if not v_cancel_at_end then
    raise exception 'cancel reservation was not stored';
  end if;

  select operation_id into v_upgrade
    from public.prepare_toss_billing_operation(v_user, 'upgrade', 'pro', now());
  select operation_status into v_status
    from public.confirm_toss_billing_operation(v_user, v_upgrade, now());
  if v_status <> 'processing' then
    raise exception 'upgrade operation was not locked for payment: %', v_status;
  end if;

  select count(*) into v_claim_count
    from public.claim_due_toss_subscriptions('billing-v2-test-worker', now(), 25, 300);
  if v_claim_count <> 0 then
    raise exception 'renewal claim bypassed active operation lock';
  end if;

  perform public.mark_toss_billing_operation_recoverable(
    v_user, v_upgrade, 'failed', 'card_declined', 'test decline', now()
  );
  select status, cancel_at_period_end into v_status, v_cancel_at_end
    from public.billing_toss_subscriptions where id = v_subscription;
  if v_status <> 'pending_cancel' or not v_cancel_at_end then
    raise exception 'failed upgrade did not preserve pending cancellation: %, %',
      v_status, v_cancel_at_end;
  end if;

  -- An operation quoted before period end must not revive a cancellation once
  -- the boundary has passed, even if the terminal worker is delayed.
  select operation_id into v_resume
    from public.prepare_toss_billing_operation(v_user, 'resume_subscription', null, now());
  update public.billing_toss_subscriptions
    set current_period_end = now() - interval '1 second'
    where id = v_subscription;
  select operation_status into v_status
    from public.confirm_toss_billing_operation(v_user, v_resume, now());
  if v_status <> 'failed' then
    raise exception 'period-end resume was not rejected: %', v_status;
  end if;
  select status, cancel_at_period_end into v_status, v_cancel_at_end
    from public.billing_toss_subscriptions where id = v_subscription;
  if v_status <> 'pending_cancel' or not v_cancel_at_end then
    raise exception 'period-end resume changed cancellation state: %, %',
      v_status, v_cancel_at_end;
  end if;

  -- Choosing a lower plan while cancellation is pending is one deliberate
  -- intention: keep the account, cancel the cancellation, and schedule the
  -- lower plan in the same transaction.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_downgrade_user, 'authenticated', 'authenticated',
    'billing-v2-downgrade-test@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.billing_toss_subscriptions (
    id, user_id, plan_key, plan_version_id, status, customer_key, billing_key,
    billing_method, current_period_start, current_period_end, next_billing_at,
    renewal_due_at, cancel_at_period_end
  ) values (
    v_downgrade_subscription, v_downgrade_user, 'pro', v_pro, 'active',
    'billing-v2-downgrade-customer', 'billing-v2-downgrade-key', 'CARD',
    now() - interval '10 days', now() + interval '20 days', now() + interval '20 days',
    now() + interval '20 days', false
  );
  insert into public.user_entitlements (
    user_id, plan_key, status, current_period_start, current_period_end,
    billing_period_start, billing_period_end, credit_anchor_at, plan_version_id,
    provider_customer_id, provider_subscription_id, provider_price_id, cancel_at_period_end
  ) values (
    v_downgrade_user, 'pro', 'active', now() - interval '10 days', now() + interval '20 days',
    now() - interval '10 days', now() + interval '20 days', now() - interval '10 days',
    v_pro, 'billing-v2-downgrade-customer', v_downgrade_subscription::text, null, false
  );
  select operation_id into v_downgrade_cancel
    from public.prepare_toss_billing_operation(v_downgrade_user, 'cancel_subscription', null, now());
  perform public.confirm_toss_billing_operation(v_downgrade_user, v_downgrade_cancel, now());
  select operation_id into v_downgrade
    from public.prepare_toss_billing_operation(v_downgrade_user, 'downgrade', 'standard', now());
  select operation_status into v_status
    from public.confirm_toss_billing_operation(v_downgrade_user, v_downgrade, now());
  if v_status <> 'succeeded' then
    raise exception 'pending-cancel downgrade did not succeed: %', v_status;
  end if;
  select status, cancel_at_period_end, pending_plan_key
    into v_status, v_cancel_at_end, v_pending_plan
    from public.billing_toss_subscriptions where id = v_downgrade_subscription;
  select cancel_at_period_end, plan_change_pending ->> 'plan_key'
    into v_entitlement_cancel_at_end, v_entitlement_pending_plan
    from public.user_entitlements where user_id = v_downgrade_user;
  if v_status <> 'active' or v_cancel_at_end or v_entitlement_cancel_at_end
     or v_pending_plan <> 'standard'
     or v_entitlement_pending_plan <> 'standard' then
    raise exception 'pending-cancel downgrade was not atomically reflected';
  end if;

  -- A confirmed renewal decline changes the subscription ledger and the
  -- entitlement together. An ambiguous provider result must not use this RPC.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_renewal_user, 'authenticated', 'authenticated',
    'billing-v2-renewal-test@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.billing_toss_subscriptions (
    id, user_id, plan_key, plan_version_id, status, customer_key, billing_key,
    billing_method, current_period_start, current_period_end, next_billing_at,
    renewal_due_at, cancel_at_period_end
  ) values (
    v_renewal_subscription, v_renewal_user, 'standard', v_standard, 'active',
    'billing-v2-renewal-customer', 'billing-v2-renewal-key', 'CARD',
    now() - interval '1 month', now(), now(), now(), false
  );
  insert into public.user_entitlements (
    user_id, plan_key, status, current_period_start, current_period_end,
    billing_period_start, billing_period_end, credit_anchor_at, plan_version_id,
    provider_customer_id, provider_subscription_id, provider_price_id, cancel_at_period_end
  ) values (
    v_renewal_user, 'standard', 'active', now() - interval '1 month', now(),
    now() - interval '1 month', now(), now() - interval '1 month',
    v_standard, 'billing-v2-renewal-customer', v_renewal_subscription::text, null, false
  );
  perform public.apply_toss_renewal_failure(
    v_renewal_user,
    v_renewal_subscription,
    now() + interval '3 days',
    now() + interval '1 hour',
    1,
    now()
  );
  select status into v_status
    from public.billing_toss_subscriptions where id = v_renewal_subscription;
  select status into v_entitlement_status
    from public.user_entitlements where user_id = v_renewal_user;
  if v_status <> 'grace' or v_entitlement_status <> 'grace' then
    raise exception 'renewal grace state was not atomically reflected: %, %',
      v_status, v_entitlement_status;
  end if;

  perform public.apply_toss_renewal_failure(
    v_renewal_user,
    v_renewal_subscription,
    now() - interval '1 second',
    null,
    2,
    now()
  );
  select status into v_status
    from public.billing_toss_subscriptions where id = v_renewal_subscription;
  select plan_key, provider_subscription_id
    into v_entitlement_plan, v_provider_subscription_id
    from public.user_entitlements where user_id = v_renewal_user;
  if v_status <> 'expired' or v_entitlement_plan <> 'free'
     or v_provider_subscription_id is not null then
    raise exception 'renewal expiry did not atomically demote entitlement';
  end if;

  -- A scheduled cancellation is finalized as one transaction as well, rather
  -- than first writing a terminal subscription and later changing entitlement.
  select public.finalize_toss_terminal_subscriptions(now(), 25)
    into v_terminal_count;
  select status into v_status
    from public.billing_toss_subscriptions where id = v_subscription;
  select plan_key into v_entitlement_plan
    from public.user_entitlements where user_id = v_user;
  if v_terminal_count < 1 or v_status <> 'cancelled'
     or v_entitlement_plan <> 'free' then
    raise exception 'period-end cancellation was not atomically finalized';
  end if;
end;
$$;

rollback;
SQL

echo "Billing Flow V2 DB lock, renewal, and terminal-state test passed."
