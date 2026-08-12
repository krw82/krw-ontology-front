-- Customer-initiated automatic refunds for confirmed Toss subscription charges.
--
-- A refund starts only for the latest paid charge within seven days when no
-- analysis reservation was created after that charge.  The database owns the
-- eligibility decision and freezes new reservations while Toss cancellation is
-- in flight, so a browser retry or a race with an analysis request cannot turn
-- into both paid usage and a successful automatic refund.

create table if not exists public.billing_toss_refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid not null unique
    references public.billing_toss_payments(id) on delete restrict,
  subscription_id uuid references public.billing_toss_subscriptions(id)
    on delete set null,
  amount_krw integer not null check (amount_krw > 0),
  status text not null default 'processing' check (
    status in ('processing', 'succeeded', 'failed', 'uncertain')
  ),
  idempotency_key uuid not null default gen_random_uuid() unique,
  provider_cancel_transaction_key text,
  provider_response jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message text,
  provider_requested_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_toss_refunds_user_created
  on public.billing_toss_refunds (user_id, created_at desc);

create index if not exists idx_billing_toss_refunds_reconcile
  on public.billing_toss_refunds (updated_at)
  where status in ('processing', 'uncertain');

create unique index if not exists idx_billing_toss_refunds_one_open_user
  on public.billing_toss_refunds (user_id)
  where status in ('processing', 'uncertain');

drop trigger if exists trg_billing_toss_refunds_updated_at
  on public.billing_toss_refunds;
create trigger trg_billing_toss_refunds_updated_at
  before update on public.billing_toss_refunds
  for each row
  execute function public.set_updated_at();

alter table public.billing_toss_refunds enable row level security;
revoke all on public.billing_toss_refunds from public, anon, authenticated;
grant select, insert, update, delete on public.billing_toss_refunds to service_role;

-- Do not interrupt a reservation that existed before the refund began: it is
-- part of the eligibility check.  Block only a new reservation (or an expired
-- one being reused) while a refund is in flight.
create or replace function public.guard_analysis_credit_reservation_during_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'reserved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status not in ('released', 'expired') then
    return new;
  end if;
  if exists (
       select 1
         from public.billing_toss_refunds as refund
        where refund.user_id = new.user_id
          and refund.status in ('processing', 'uncertain')
     ) then
    raise exception 'refund_pending_blocks_paid_usage';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_analysis_credit_reservation_during_refund()
  from public, anon, authenticated;

drop trigger if exists trg_guard_analysis_credit_reservation_during_refund
  on public.run_credit_reservations;
create trigger trg_guard_analysis_credit_reservation_during_refund
  before insert or update of status on public.run_credit_reservations
  for each row
  execute function public.guard_analysis_credit_reservation_during_refund();

create or replace function public.prepare_toss_auto_refund(
  p_user_id uuid,
  p_payment_id uuid,
  p_now timestamptz default now()
)
returns table (
  refund_id uuid,
  provider_payment_key text,
  amount_krw integer,
  idempotency_key uuid,
  refund_status text,
  should_call_provider boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.billing_toss_payments%rowtype;
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_existing_refund public.billing_toss_refunds%rowtype;
begin
  if p_user_id is null or p_payment_id is null then
    raise exception 'refund_parameters_missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- reserve_analysis_credits locks this same row before it creates a
  -- reservation. Taking it here makes the check below and the refund insert
  -- serialize with an in-flight analysis request, not merely with one that
  -- already committed before this statement began.
  perform 1
    from public.user_entitlements
   where user_id = p_user_id
   for update;
  if not found then
    raise exception 'refund_entitlement_missing';
  end if;

  select *
    into v_existing_refund
    from public.billing_toss_refunds
   where user_id = p_user_id
     and payment_id = p_payment_id
   for update;
  if found then
    if v_existing_refund.status = 'failed' then
      if exists (
        select 1
          from public.billing_toss_refunds as refund
         where refund.user_id = p_user_id
           and refund.id <> v_existing_refund.id
           and refund.status in ('processing', 'uncertain')
      ) then
        raise exception 'refund_already_processing';
      end if;
      select *
        into v_payment
        from public.billing_toss_payments
       where id = p_payment_id
         and user_id = p_user_id
       for update;
      if not found then
        raise exception 'refund_payment_missing';
      end if;
      if v_payment.status <> 'paid'
         or v_payment.fulfillment_status <> 'applied'
         or v_payment.provider_payment_key is null
         or v_payment.paid_at is null then
        raise exception 'refund_payment_not_eligible';
      end if;
      if p_now > v_payment.paid_at + interval '7 days' then
        raise exception 'refund_window_expired';
      end if;
      select *
        into v_subscription
        from public.billing_toss_subscriptions
       where id = v_payment.subscription_id
         and user_id = p_user_id
       for update;
      if not found then
        raise exception 'refund_subscription_missing';
      end if;
      if v_subscription.last_payment_id is distinct from v_payment.id
         or v_subscription.status not in ('active', 'pending_cancel')
         or v_subscription.active_operation_id is not null
         or v_subscription.pending_plan_key is not null then
        raise exception 'refund_subscription_state_changed';
      end if;
      if exists (
        select 1
          from public.run_credit_reservations as reservation
         where reservation.user_id = p_user_id
           and reservation.created_at >= v_payment.paid_at
           and reservation.created_at <= p_now
           and reservation.status in ('reserved', 'running', 'settled')
      ) then
        raise exception 'refund_paid_usage_exists';
      end if;
      update public.billing_toss_refunds
         set status = 'processing',
             failure_code = null,
             failure_message = null,
             provider_requested_at = p_now,
             completed_at = null
       where id = v_existing_refund.id
       returning * into v_existing_refund;
    end if;
    if v_payment.provider_payment_key is null then
      select payment.provider_payment_key
        into v_payment.provider_payment_key
        from public.billing_toss_payments as payment
       where payment.id = p_payment_id
         and payment.user_id = p_user_id;
    end if;
    return query select
      v_existing_refund.id,
      v_payment.provider_payment_key,
      v_existing_refund.amount_krw,
      v_existing_refund.idempotency_key,
      v_existing_refund.status,
      v_existing_refund.status = 'processing';
    return;
  end if;

  if exists (
    select 1
      from public.billing_toss_refunds
     where user_id = p_user_id
       and status in ('processing', 'uncertain')
  ) then
    raise exception 'refund_already_processing';
  end if;

  select *
    into v_payment
    from public.billing_toss_payments
   where id = p_payment_id
     and user_id = p_user_id
   for update;
  if not found then
    raise exception 'refund_payment_missing';
  end if;
  if v_payment.status <> 'paid'
     or v_payment.fulfillment_status <> 'applied'
     or v_payment.provider_payment_key is null
     or v_payment.paid_at is null then
    raise exception 'refund_payment_not_eligible';
  end if;
  if p_now > v_payment.paid_at + interval '7 days' then
    raise exception 'refund_window_expired';
  end if;

  select *
    into v_subscription
    from public.billing_toss_subscriptions
   where id = v_payment.subscription_id
     and user_id = p_user_id
   for update;
  if not found then
    raise exception 'refund_subscription_missing';
  end if;
  if v_subscription.last_payment_id is distinct from v_payment.id then
    raise exception 'refund_not_latest_payment';
  end if;
  if v_subscription.status not in ('active', 'pending_cancel')
     or v_subscription.active_operation_id is not null
     or v_subscription.pending_plan_key is not null then
    raise exception 'refund_subscription_state_changed';
  end if;

  if exists (
    select 1
      from public.run_credit_reservations as reservation
     where reservation.user_id = p_user_id
       and reservation.created_at >= v_payment.paid_at
       and reservation.created_at <= p_now
       and reservation.status in ('reserved', 'running', 'settled')
  ) then
    raise exception 'refund_paid_usage_exists';
  end if;

  insert into public.billing_toss_refunds (
    user_id,
    payment_id,
    subscription_id,
    amount_krw,
    status,
    provider_requested_at
  )
  values (
    p_user_id,
    v_payment.id,
    v_subscription.id,
    v_payment.amount_krw,
    'processing',
    p_now
  )
  returning * into v_existing_refund;

  return query select
    v_existing_refund.id,
    v_payment.provider_payment_key,
    v_existing_refund.amount_krw,
    v_existing_refund.idempotency_key,
    v_existing_refund.status,
    true;
end;
$$;

revoke all on function public.prepare_toss_auto_refund(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_toss_auto_refund(uuid, uuid, timestamptz)
  to service_role;

create or replace function public.mark_toss_auto_refund_recoverable(
  p_user_id uuid,
  p_refund_id uuid,
  p_status text,
  p_failure_code text,
  p_failure_message text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.billing_toss_refunds%rowtype;
begin
  if p_status not in ('failed', 'uncertain') then
    raise exception 'refund_recoverable_status_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select *
    into v_refund
    from public.billing_toss_refunds
   where id = p_refund_id
     and user_id = p_user_id
   for update;
  if not found or v_refund.status = 'succeeded' then
    return false;
  end if;

  update public.billing_toss_refunds
     set status = p_status,
         failure_code = left(coalesce(p_failure_code, 'refund_error'), 100),
         failure_message = left(coalesce(p_failure_message, '환불 처리에 실패했습니다.'), 500),
         completed_at = case when p_status = 'failed' then p_now else null end
   where id = v_refund.id;
  return true;
end;
$$;

revoke all on function public.mark_toss_auto_refund_recoverable(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_toss_auto_refund_recoverable(uuid, uuid, text, text, text, timestamptz)
  to service_role;

-- Finalization runs only after Toss has returned CANCELED for the exact paid
-- payment.  It is intentionally one transaction: provider cancellation,
-- subscription/entitlement reversal, and the refund ledger cannot diverge.
create or replace function public.finalize_toss_auto_refund(
  p_user_id uuid,
  p_refund_id uuid,
  p_provider_payment_key text,
  p_provider_status text,
  p_provider_response jsonb,
  p_now timestamptz default now()
)
returns table (refund_id uuid, already_applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.billing_toss_refunds%rowtype;
  v_payment public.billing_toss_payments%rowtype;
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_entitlement public.user_entitlements%rowtype;
  v_operation public.billing_toss_operations%rowtype;
  v_from_plan public.billing_plan_versions%rowtype;
  v_free_plan public.billing_plan_versions%rowtype;
  v_previous_payment_id uuid;
  v_credit_anchor_at timestamptz;
begin
  if p_user_id is null or p_refund_id is null
     or p_provider_payment_key is null or length(trim(p_provider_payment_key)) = 0 then
    raise exception 'refund_finalizer_parameters_missing';
  end if;
  if p_provider_status <> 'CANCELED' then
    raise exception 'refund_provider_not_cancelled';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select *
    into v_refund
    from public.billing_toss_refunds
   where id = p_refund_id
     and user_id = p_user_id
   for update;
  if not found then
    raise exception 'refund_missing';
  end if;
  if v_refund.status = 'succeeded' then
    return query select v_refund.id, true;
    return;
  end if;
  if v_refund.status not in ('processing', 'uncertain') then
    raise exception 'refund_not_finalizable';
  end if;

  select *
    into v_payment
    from public.billing_toss_payments
   where id = v_refund.payment_id
     and user_id = p_user_id
   for update;
  if not found then
    raise exception 'refund_payment_missing';
  end if;
  if v_payment.provider_payment_key is distinct from p_provider_payment_key then
    raise exception 'refund_provider_payment_mismatch';
  end if;

  select *
    into v_subscription
    from public.billing_toss_subscriptions
   where id = v_refund.subscription_id
     and user_id = p_user_id
   for update;
  if not found then
    raise exception 'refund_subscription_missing';
  end if;

  select *
    into v_entitlement
    from public.user_entitlements
   where user_id = p_user_id
   for update;
  if found and v_entitlement.plan_key = 'internal' then
    raise exception 'refund_internal_entitlement_forbidden';
  end if;

  if v_payment.payment_kind = 'upgrade' then
    select *
      into v_operation
      from public.billing_toss_operations
     where id = v_payment.operation_id
       and user_id = p_user_id
       and kind = 'upgrade'
     for update;
    if not found or v_operation.from_plan_version_id is null then
      raise exception 'refund_upgrade_source_missing';
    end if;

    select *
      into v_from_plan
      from public.billing_plan_versions
     where id = v_operation.from_plan_version_id;
    if not found or v_from_plan.plan_key not in ('lite', 'standard', 'pro') then
      raise exception 'refund_upgrade_plan_missing';
    end if;

    select id
      into v_previous_payment_id
      from public.billing_toss_payments
     where subscription_id = v_subscription.id
       and id <> v_payment.id
       and status = 'paid'
     order by paid_at desc nulls last, created_at desc
     limit 1;
    if v_previous_payment_id is null then
      raise exception 'refund_upgrade_previous_payment_missing';
    end if;

    update public.billing_toss_subscriptions
       set plan_key = v_from_plan.plan_key,
           plan_version_id = v_from_plan.id,
           status = 'active',
           cancel_at_period_end = false,
           cancelled_at = null,
           pending_plan_key = null,
           pending_plan_version_id = null,
           grace_until = null,
           active_operation_id = null,
           active_operation_expires_at = null,
           last_payment_id = v_previous_payment_id
     where id = v_subscription.id
     returning * into v_subscription;

    v_credit_anchor_at := coalesce(v_entitlement.credit_anchor_at, v_subscription.current_period_start);
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
      v_from_plan.plan_key,
      'active',
      v_subscription.current_period_start,
      v_subscription.current_period_end,
      v_subscription.current_period_start,
      v_subscription.current_period_end,
      v_credit_anchor_at,
      v_from_plan.id,
      v_subscription.customer_key,
      v_subscription.id::text,
      v_from_plan.provider_price_id,
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

    update public.usage_credit_balances as balance
       set plan_key_snapshot = v_from_plan.plan_key,
           plan_version_id = v_from_plan.id,
           credit_policy_version = v_from_plan.credit_policy_version,
           credits_limit_raw = greatest(
             coalesce(v_from_plan.weekly_credit_limit_raw, 0),
             balance.credits_used_raw + balance.credits_reserved_raw
           ),
           updated_at = p_now
     where balance.user_id = p_user_id
       and balance.period_kind = 'weekly'
       and balance.period_start <= p_now
       and balance.period_end > p_now;
  else
    select *
      into v_free_plan
      from public.billing_plan_versions
     where plan_key = 'free'
       and is_current
     order by effective_from desc
     limit 1;
    if not found then
      raise exception 'refund_free_plan_missing';
    end if;

    update public.billing_toss_subscriptions
       set status = 'cancelled',
           cancel_at_period_end = false,
           cancelled_at = p_now,
           grace_until = null,
           renewal_lease_owner = null,
           renewal_lease_expires_at = null,
           pending_plan_key = null,
           pending_plan_version_id = null,
           active_operation_id = null,
           active_operation_expires_at = null,
           terminal_entitlement_applied_at = p_now,
           billing_key_delete_pending = true
     where id = v_subscription.id
     returning * into v_subscription;

    v_credit_anchor_at := coalesce(v_entitlement.credit_anchor_at, p_now);
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
      'free',
      'active',
      p_now,
      p_now + interval '100 years',
      p_now,
      p_now + interval '100 years',
      v_credit_anchor_at,
      v_free_plan.id,
      null,
      null,
      v_free_plan.provider_price_id,
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
     set status = 'cancelled',
         provider_status = p_provider_status,
         provider_response = coalesce(p_provider_response, '{}'::jsonb),
         failure_code = null,
         failure_message = null
   where id = v_payment.id;

  update public.billing_toss_refunds
     set status = 'succeeded',
         provider_response = coalesce(p_provider_response, '{}'::jsonb),
         provider_cancel_transaction_key = coalesce(
           nullif(
             coalesce(p_provider_response ->> 'lastTransactionKey', ''),
             ''
           ),
           nullif(
             coalesce(
               p_provider_response -> 'cancels' -> -1 ->> 'transactionKey',
               ''
             ),
             ''
           )
         ),
         failure_code = null,
         failure_message = null,
         completed_at = p_now
   where id = v_refund.id;

  return query select v_refund.id, false;
end;
$$;

revoke all on function public.finalize_toss_auto_refund(uuid, uuid, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_toss_auto_refund(uuid, uuid, text, text, jsonb, timestamptz)
  to service_role;
