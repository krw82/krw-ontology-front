-- Keep money movement outside the database transaction, but make the state
-- transition after a confirmed Toss charge atomic. A failed application write
-- must therefore be retryable with the same paid payment, never by charging a
-- following billing period.

alter table public.billing_toss_checkout_sessions
  add column if not exists processing_started_at timestamptz;

alter table public.billing_toss_payments
  add column if not exists fulfillment_status text not null default 'pending',
  add column if not exists fulfillment_error text,
  add column if not exists fulfillment_attempted_at timestamptz,
  add column if not exists fulfillment_applied_at timestamptz;

alter table public.billing_toss_subscriptions
  add column if not exists terminal_entitlement_applied_at timestamptz,
  add column if not exists billing_key_delete_pending boolean not null default false,
  add column if not exists billing_key_deleted_at timestamptz;

alter table public.billing_toss_checkout_sessions
  drop constraint if exists billing_toss_checkout_sessions_status_check;
alter table public.billing_toss_checkout_sessions
  add constraint billing_toss_checkout_sessions_status_check
  check (
    status in (
      'created',
      'auth_succeeded',
      'processing',
      'paid',
      'failed',
      'cancelled',
      'expired',
      'superseded'
    )
  );

alter table public.billing_toss_payments
  drop constraint if exists billing_toss_payments_fulfillment_status_check;
alter table public.billing_toss_payments
  add constraint billing_toss_payments_fulfillment_status_check
  check (fulfillment_status in ('pending', 'failed', 'applied'));

-- Paid rows that predate this migration were already applied by the previous
-- flow. New paid rows remain pending until the atomic settlement function
-- finishes, allowing the worker to repair only genuinely unfinished work.
update public.billing_toss_payments
  set fulfillment_status = 'applied',
      fulfillment_applied_at = coalesce(paid_at, updated_at, now())
  where status = 'paid'
    and fulfillment_status = 'pending';

with ranked_open_sessions as (
  select
    id,
    row_number() over (
      partition by user_id
      order by expires_at desc, created_at desc, id desc
    ) as row_number
  from public.billing_toss_checkout_sessions
  where status in ('created', 'auth_succeeded', 'processing')
)
update public.billing_toss_checkout_sessions as session
  set status = 'superseded',
      failure_code = 'checkout_superseded',
      failure_message = '새 결제 세션으로 대체되었습니다.'
  from ranked_open_sessions as ranked
  where session.id = ranked.id
    and ranked.row_number > 1;

create unique index if not exists idx_billing_toss_checkout_sessions_one_open
  on public.billing_toss_checkout_sessions (user_id)
  where status in ('created', 'auth_succeeded', 'processing');

create index if not exists idx_billing_toss_payments_pending_fulfillment
  on public.billing_toss_payments (created_at)
  where status = 'paid'
    and fulfillment_status in ('pending', 'failed');

create index if not exists idx_billing_toss_subscriptions_terminal_reconcile
  on public.billing_toss_subscriptions (updated_at)
  where status in ('cancelled', 'expired')
    and (
      terminal_entitlement_applied_at is null
      or billing_key_delete_pending
    );

create or replace function public.finalize_toss_billing_payment(
  p_operation text,
  p_user_id uuid,
  p_subscription_id uuid,
  p_payment_id uuid,
  p_checkout_session_id uuid,
  p_plan_version_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_credit_anchor_at timestamptz,
  p_customer_key text,
  p_billing_key text,
  p_billing_key_issued_at timestamptz,
  p_card_snapshot jsonb,
  p_paid_at timestamptz,
  p_renewal_lease_owner text,
  p_defer_plan_change_until timestamptz,
  p_now timestamptz
)
returns table (
  subscription_id uuid,
  already_applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.billing_toss_payments%rowtype;
  v_plan public.billing_plan_versions%rowtype;
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_open_subscription public.billing_toss_subscriptions%rowtype;
  v_session public.billing_toss_checkout_sessions%rowtype;
  v_entitlement public.user_entitlements%rowtype;
  v_was_applied boolean := false;
  v_has_entitlement boolean := false;
  v_defer_plan_change boolean := false;
begin
  if p_operation not in ('initial', 'renewal', 'upgrade') then
    raise exception 'unsupported_billing_operation';
  end if;
  if p_user_id is null
     or p_subscription_id is null
     or p_payment_id is null
     or p_plan_version_id is null
     or p_period_start is null
     or p_period_end is null
     or p_credit_anchor_at is null
     or p_customer_key is null
     or length(trim(p_customer_key)) = 0
     or p_paid_at is null
     or p_now is null then
    raise exception 'billing_settlement_parameters_missing';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'billing_settlement_period_invalid';
  end if;

  -- This lock is short and protects the no-row case before the partial unique
  -- index can be observed. No Toss API request is made in this transaction.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select *
    into v_payment
    from public.billing_toss_payments
    where id = p_payment_id
      and user_id = p_user_id
    for update;
  if not found then
    raise exception 'billing_payment_missing';
  end if;
  if v_payment.status <> 'paid' then
    raise exception 'billing_payment_not_paid';
  end if;
  if v_payment.plan_version_id is distinct from p_plan_version_id then
    raise exception 'billing_payment_plan_version_mismatch';
  end if;
  if v_payment.payment_kind <> p_operation then
    raise exception 'billing_payment_operation_mismatch';
  end if;

  select *
    into v_plan
    from public.billing_plan_versions
    where id = p_plan_version_id;
  if not found or v_plan.plan_key not in ('standard', 'pro') then
    raise exception 'billing_plan_version_missing';
  end if;
  if v_payment.plan_key <> v_plan.plan_key then
    raise exception 'billing_payment_plan_key_mismatch';
  end if;

  if p_operation = 'initial' then
    if p_checkout_session_id is null
       or p_billing_key is null
       or length(trim(p_billing_key)) = 0 then
      raise exception 'billing_initial_payment_parameters_missing';
    end if;

    select *
      into v_session
      from public.billing_toss_checkout_sessions
      where id = p_checkout_session_id
        and user_id = p_user_id
      for update;
    if not found then
      raise exception 'billing_checkout_session_missing';
    end if;
    if v_payment.checkout_session_id is distinct from v_session.id
       or v_session.plan_version_id is distinct from p_plan_version_id
       or v_session.plan_key <> v_plan.plan_key
       or v_session.amount_krw <> v_payment.amount_krw then
      raise exception 'billing_checkout_payment_mismatch';
    end if;

    select *
      into v_subscription
      from public.billing_toss_subscriptions
      where last_payment_id = v_payment.id
      for update;

    if not found then
      select *
        into v_open_subscription
        from public.billing_toss_subscriptions
        where user_id = p_user_id
          and status in ('active', 'past_due', 'grace', 'pending_cancel')
        for update;
      if found then
        raise exception 'billing_open_subscription_exists';
      end if;

      insert into public.billing_toss_subscriptions (
        id,
        user_id,
        plan_key,
        plan_version_id,
        status,
        customer_key,
        billing_key,
        billing_method,
        billing_key_issued_at,
        card_snapshot,
        current_period_start,
        current_period_end,
        next_billing_at,
        renewal_due_at,
        last_payment_id
      )
      values (
        p_subscription_id,
        p_user_id,
        v_plan.plan_key,
        v_plan.id,
        'active',
        p_customer_key,
        p_billing_key,
        'CARD',
        p_billing_key_issued_at,
        coalesce(p_card_snapshot, '{}'::jsonb),
        p_period_start,
        p_period_end,
        p_period_end,
        p_period_end,
        v_payment.id
      )
      returning * into v_subscription;
    elsif v_subscription.id <> p_subscription_id then
      -- The first successful finalizer wins. The caller can use the returned
      -- subscription id, while a duplicate callback remains idempotent.
      v_was_applied := true;
    end if;

    update public.billing_toss_checkout_sessions
      set status = 'paid',
          failure_code = null,
          failure_message = null
      where id = v_session.id;
  else
    select *
      into v_subscription
      from public.billing_toss_subscriptions
      where id = p_subscription_id
        and user_id = p_user_id
      for update;
    if not found then
      raise exception 'billing_subscription_missing';
    end if;

    if p_operation = 'renewal' then
      if v_subscription.last_payment_id = v_payment.id
         and v_subscription.renewal_due_at = p_period_end then
        v_was_applied := true;
      elsif v_subscription.renewal_lease_owner is distinct from p_renewal_lease_owner
        or v_subscription.renewal_due_at <> p_period_start then
        raise exception 'billing_renewal_lease_lost';
      else
        update public.billing_toss_subscriptions
          set plan_key = v_plan.plan_key,
              plan_version_id = v_plan.id,
              status = 'active',
              current_period_start = p_period_start,
              current_period_end = p_period_end,
              renewal_due_at = p_period_end,
              next_billing_at = p_period_end,
              grace_until = null,
              renewal_attempt_count = 0,
              renewal_lease_owner = null,
              renewal_lease_expires_at = null,
              pending_plan_key = null,
              pending_plan_version_id = null,
              last_payment_id = v_payment.id
          where id = v_subscription.id
          returning * into v_subscription;
      end if;
    elsif v_subscription.last_payment_id = v_payment.id
      and v_subscription.plan_version_id = v_plan.id then
      v_was_applied := true;
    else
      update public.billing_toss_subscriptions
        set plan_key = v_plan.plan_key,
            plan_version_id = v_plan.id,
            pending_plan_key = null,
            pending_plan_version_id = null,
            last_payment_id = v_payment.id
        where id = v_subscription.id
        returning * into v_subscription;
    end if;
  end if;

  select *
    into v_entitlement
    from public.user_entitlements
    where user_id = p_user_id
    for update;
  v_has_entitlement := found;
  if found and v_entitlement.plan_key = 'internal' then
    raise exception 'internal_entitlement_billing_forbidden';
  end if;

  v_defer_plan_change := p_operation = 'renewal'
    and p_defer_plan_change_until is not null
    and p_defer_plan_change_until > p_now
    and v_has_entitlement;

  if v_defer_plan_change then
    update public.user_entitlements
      set status = 'active',
          current_period_start = p_period_start,
          current_period_end = p_period_end,
          billing_period_start = p_period_start,
          billing_period_end = p_period_end,
          credit_anchor_at = p_credit_anchor_at,
          provider_customer_id = p_customer_key,
          provider_subscription_id = v_subscription.id,
          provider_price_id = v_plan.provider_price_id,
          cancel_at_period_end = false,
          plan_change_pending = jsonb_build_object(
            'plan_key', v_plan.plan_key,
            'plan_version_id', v_plan.id,
            'effective_at', p_defer_plan_change_until
          ),
          grace_until = null,
          entitlement_updated_at = p_now
      where user_id = p_user_id;
  else
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
      provider_customer_id,
      provider_subscription_id,
      provider_price_id,
      cancel_at_period_end,
      plan_change_pending,
      grace_until,
      entitlement_updated_at
    )
    values (
      p_user_id,
      v_plan.plan_key,
      'active',
      p_period_start,
      p_period_end,
      p_period_start,
      p_period_end,
      p_credit_anchor_at,
      v_plan.id,
      p_customer_key,
      v_subscription.id,
      v_plan.provider_price_id,
      false,
      null,
      null,
      p_now
    )
    on conflict (user_id) do update
      set plan_key = excluded.plan_key,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          billing_period_start = excluded.billing_period_start,
          billing_period_end = excluded.billing_period_end,
          credit_anchor_at = excluded.credit_anchor_at,
          plan_version_id = excluded.plan_version_id,
          provider_customer_id = excluded.provider_customer_id,
          provider_subscription_id = excluded.provider_subscription_id,
          provider_price_id = excluded.provider_price_id,
          cancel_at_period_end = excluded.cancel_at_period_end,
          plan_change_pending = excluded.plan_change_pending,
          grace_until = excluded.grace_until,
          entitlement_updated_at = excluded.entitlement_updated_at;
  end if;

  update public.billing_toss_payments
    set subscription_id = v_subscription.id,
        fulfillment_status = 'applied',
        fulfillment_error = null,
        fulfillment_attempted_at = p_now,
        fulfillment_applied_at = p_now
    where id = v_payment.id;

  return query select v_subscription.id, v_was_applied;
end;
$$;

revoke all on function public.finalize_toss_billing_payment(
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  text,
  timestamptz,
  jsonb,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_toss_billing_payment(
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  text,
  timestamptz,
  jsonb,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) to service_role;
