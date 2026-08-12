#!/bin/sh
set -eu

# Runs inside one transaction and always rolls back. It proves the guarantees
# that mocks cannot: eligibility is database-owned, a pending refund blocks a
# new analysis reservation, and successful provider cancellation atomically
# reverses payment, subscription, and entitlement state.
BILLING_AUTO_REFUND_TEST_DATABASE_URL=${BILLING_AUTO_REFUND_TEST_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for automatic refund DB tests." >&2
  exit 1
fi

psql "$BILLING_AUTO_REFUND_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i supabase/migrations/20260810053845_toss_auto_refunds.sql

do $$
declare
  v_user uuid := 'b1111111-1111-4111-8111-111111111111';
  v_used_user uuid := 'b2222222-2222-4222-8222-222222222222';
  v_upgrade_user uuid := 'b7777777-7777-4777-8777-777777777777';
  v_subscription uuid := 'b3333333-3333-4333-8333-333333333333';
  v_used_subscription uuid := 'b4444444-4444-4444-8444-444444444444';
  v_upgrade_subscription uuid := 'b8888888-8888-4888-8888-888888888888';
  v_payment uuid := 'b5555555-5555-4555-8555-555555555555';
  v_used_payment uuid := 'b6666666-6666-4666-8666-666666666666';
  v_previous_upgrade_payment uuid := 'b9999999-9999-4999-8999-999999999999';
  v_upgrade_payment uuid := 'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_upgrade_operation uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_standard uuid;
  v_pro uuid;
  v_free uuid;
  v_refund uuid;
  v_reprepared_refund uuid;
  v_should_call boolean;
  v_status text;
  v_plan text;
  v_provider_subscription text;
  v_reservation_allowed boolean;
begin
  select id into v_standard
    from public.billing_plan_versions
   where plan_key = 'standard' and is_current;
  select id into v_free
    from public.billing_plan_versions
   where plan_key = 'free' and is_current;
  if v_standard is null or v_free is null then
    raise exception 'automatic refund test plan versions missing';
  end if;
  select id into v_pro
    from public.billing_plan_versions
   where plan_key = 'pro' and is_current;
  if v_pro is null then
    raise exception 'automatic refund test Pro plan version missing';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      'billing-auto-refund@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_used_user, 'authenticated', 'authenticated',
      'billing-auto-refund-used@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_upgrade_user, 'authenticated', 'authenticated',
      'billing-auto-refund-upgrade@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.billing_toss_subscriptions (
    id, user_id, plan_key, plan_version_id, status, customer_key, billing_key,
    billing_method, current_period_start, current_period_end, next_billing_at,
    renewal_due_at, cancel_at_period_end
  ) values
    (v_subscription, v_user, 'standard', v_standard, 'active', 'auto-refund-customer',
      'auto-refund-key', 'CARD', now() - interval '1 hour', now() + interval '29 days',
      now() + interval '29 days', now() + interval '29 days', false),
    (v_used_subscription, v_used_user, 'standard', v_standard, 'active', 'auto-refund-used-customer',
      'auto-refund-used-key', 'CARD', now() - interval '1 hour', now() + interval '29 days',
      now() + interval '29 days', now() + interval '29 days', false),
    (v_upgrade_subscription, v_upgrade_user, 'pro', v_pro, 'active', 'auto-refund-upgrade-customer',
      'auto-refund-upgrade-key', 'CARD', now() - interval '1 hour', now() + interval '29 days',
      now() + interval '29 days', now() + interval '29 days', false);

  insert into public.user_entitlements (
    user_id, plan_key, status, current_period_start, current_period_end,
    billing_period_start, billing_period_end, credit_anchor_at, plan_version_id,
    provider_customer_id, provider_subscription_id, provider_price_id, cancel_at_period_end
  ) values
    (v_user, 'standard', 'active', now() - interval '1 hour', now() + interval '29 days',
      now() - interval '1 hour', now() + interval '29 days', now() - interval '1 hour',
      v_standard, 'auto-refund-customer', v_subscription::text, null, false),
    (v_used_user, 'standard', 'active', now() - interval '1 hour', now() + interval '29 days',
      now() - interval '1 hour', now() + interval '29 days', now() - interval '1 hour',
      v_standard, 'auto-refund-used-customer', v_used_subscription::text, null, false),
    (v_upgrade_user, 'pro', 'active', now() - interval '1 hour', now() + interval '29 days',
      now() - interval '1 hour', now() + interval '29 days', now() - interval '1 hour',
      v_pro, 'auto-refund-upgrade-customer', v_upgrade_subscription::text, null, false);

  insert into public.billing_toss_operations (
    id, user_id, subscription_id, kind, status, from_plan_key, target_plan_key,
    from_plan_version_id, target_plan_version_id, expected_subscription_version,
    quoted_amount_krw, next_amount_krw, confirmed_at, completed_at
  ) values (
    v_upgrade_operation, v_upgrade_user, v_upgrade_subscription, 'upgrade', 'succeeded',
    'standard', 'pro', v_standard, v_pro, 1, 21100, 29000,
    now() - interval '1 hour', now() - interval '1 hour'
  );

  insert into public.billing_toss_payments (
    id, user_id, subscription_id, plan_key, plan_version_id, payment_kind,
    order_id, order_name, idempotency_key, amount_krw, billing_period_start,
    billing_period_end, status, fulfillment_status, provider_payment_key,
    provider_status, provider_response, paid_at
  ) values
    (v_payment, v_user, v_subscription, 'standard', v_standard, 'initial',
      'auto-refund-order-1', 'Automatic refund test', gen_random_uuid(), 7900,
      now() - interval '1 hour', now() + interval '29 days', 'paid', 'applied',
      'auto-refund-pay-1', 'DONE', '{}'::jsonb, now() - interval '1 hour'),
    (v_used_payment, v_used_user, v_used_subscription, 'standard', v_standard, 'initial',
      'auto-refund-order-2', 'Automatic refund usage test', gen_random_uuid(), 7900,
      now() - interval '1 hour', now() + interval '29 days', 'paid', 'applied',
      'auto-refund-pay-2', 'DONE', '{}'::jsonb, now() - interval '1 hour'),
    (v_previous_upgrade_payment, v_upgrade_user, v_upgrade_subscription, 'standard', v_standard, 'initial',
      'auto-refund-upgrade-order-previous', 'Automatic refund upgrade previous', gen_random_uuid(), 7900,
      now() - interval '31 days', now() - interval '1 hour', 'paid', 'applied',
      'auto-refund-upgrade-pay-previous', 'DONE', '{}'::jsonb, now() - interval '31 days'),
    (v_upgrade_payment, v_upgrade_user, v_upgrade_subscription, 'pro', v_pro, 'upgrade',
      'auto-refund-upgrade-order', 'Automatic refund upgrade', gen_random_uuid(), 21100,
      now() - interval '1 hour', now() + interval '29 days', 'paid', 'applied',
      'auto-refund-upgrade-pay', 'DONE', '{}'::jsonb, now() - interval '1 hour');

  update public.billing_toss_payments
     set operation_id = v_upgrade_operation
   where id = v_upgrade_payment;
  update public.billing_toss_operations
     set payment_id = v_upgrade_payment
   where id = v_upgrade_operation;

  update public.billing_toss_subscriptions
     set last_payment_id = case
       when id = v_subscription then v_payment
       when id = v_used_subscription then v_used_payment
       when id = v_upgrade_subscription then v_upgrade_payment
     end
   where id in (v_subscription, v_used_subscription, v_upgrade_subscription);

  select refund_id, should_call_provider
    into v_refund, v_should_call
    from public.prepare_toss_auto_refund(v_user, v_payment, now());
  if v_refund is null or not v_should_call then
    raise exception 'eligible automatic refund was not prepared';
  end if;

  begin
    select allowed into v_reservation_allowed
      from public.reserve_analysis_credits(
        v_user, 'auto-refund-race', 1000, now() + interval '30 minutes', now()
      );
    raise exception 'pending refund did not block analysis reservation: %', v_reservation_allowed;
  exception
    when others then
      if position('refund_pending_blocks_paid_usage' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  if not public.mark_toss_auto_refund_recoverable(
    v_user, v_refund, 'failed', 'test_retry', 'test retry', now()
  ) then
    raise exception 'failed refund was not retained for a safe retry';
  end if;
  begin
    perform public.prepare_toss_auto_refund(
      v_user, v_payment, now() + interval '8 days'
    );
    raise exception 'expired failed refund was accepted for retry';
  exception
    when others then
      if position('refund_window_expired' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  select refund_id, should_call_provider
    into v_reprepared_refund, v_should_call
    from public.prepare_toss_auto_refund(v_user, v_payment, now());
  if v_reprepared_refund <> v_refund or not v_should_call then
    raise exception 'failed refund retry did not reuse its durable record';
  end if;

  perform public.finalize_toss_auto_refund(
    v_user,
    v_refund,
    'auto-refund-pay-1',
    'CANCELED',
    jsonb_build_object('lastTransactionKey', 'txn-auto-refund-1'),
    now()
  );
  select status into v_status from public.billing_toss_payments where id = v_payment;
  if v_status <> 'cancelled' then
    raise exception 'refunded payment was not cancelled: %', v_status;
  end if;
  select status into v_status from public.billing_toss_subscriptions where id = v_subscription;
  if v_status <> 'cancelled' then
    raise exception 'refunded initial subscription was not cancelled: %', v_status;
  end if;
  select plan_key, provider_subscription_id
    into v_plan, v_provider_subscription
    from public.user_entitlements where user_id = v_user;
  if v_plan <> 'free' or v_provider_subscription is not null then
    raise exception 'refunded initial entitlement was not demoted: %, %', v_plan, v_provider_subscription;
  end if;

  select allowed into v_reservation_allowed
    from public.reserve_analysis_credits(
      v_used_user, 'auto-refund-used', 1000, now() + interval '30 minutes', now()
    );
  begin
    perform public.prepare_toss_auto_refund(v_used_user, v_used_payment, now());
    raise exception 'paid analysis usage did not block automatic refund: %', v_reservation_allowed;
  exception
    when others then
      if position('refund_paid_usage_exists' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.prepare_toss_auto_refund(
      v_upgrade_user, v_upgrade_payment, now() + interval '7 days'
    );
    raise exception 'expired automatic refund window was accepted';
  exception
    when others then
      if position('refund_window_expired' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  select refund_id into v_refund
    from public.prepare_toss_auto_refund(v_upgrade_user, v_upgrade_payment, now());
  perform public.finalize_toss_auto_refund(
    v_upgrade_user,
    v_refund,
    'auto-refund-upgrade-pay',
    'CANCELED',
    jsonb_build_object('lastTransactionKey', 'txn-auto-refund-upgrade'),
    now()
  );
  select plan_key, last_payment_id::text
    into v_plan, v_provider_subscription
    from public.billing_toss_subscriptions where id = v_upgrade_subscription;
  if v_plan <> 'standard' or v_provider_subscription <> v_previous_upgrade_payment::text then
    raise exception 'upgrade refund did not restore the previous subscription: %, %',
      v_plan, v_provider_subscription;
  end if;
  select plan_key into v_plan from public.user_entitlements where user_id = v_upgrade_user;
  if v_plan <> 'standard' then
    raise exception 'upgrade refund did not restore the previous entitlement: %', v_plan;
  end if;
end;
$$;

rollback;
SQL

echo "Automatic Toss refund DB transaction test passed."
