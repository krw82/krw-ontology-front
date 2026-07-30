-- Billing Flow V2: every user-initiated billing mutation is represented by a
-- durable operation. This release has no compatibility path for the former
-- direct checkout/change-plan/cancel endpoints.

create table if not exists public.billing_toss_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.billing_toss_subscriptions(id) on delete set null,
  kind text not null check (
    kind in (
      'subscribe',
      'upgrade',
      'downgrade',
      'cancel_subscription',
      'resume_subscription',
      'cancel_plan_change',
      'replace_payment_method'
    )
  ),
  status text not null default 'prepared' check (
    status in (
      'prepared',
      'awaiting_auth',
      'processing',
      'payment_uncertain',
      'paid_pending_apply',
      'succeeded',
      'failed',
      'cancelled',
      'expired'
    )
  ),
  from_plan_key text check (from_plan_key is null or from_plan_key in ('standard', 'pro')),
  target_plan_key text check (target_plan_key is null or target_plan_key in ('standard', 'pro')),
  from_plan_version_id uuid references public.billing_plan_versions(id),
  target_plan_version_id uuid references public.billing_plan_versions(id),
  expected_subscription_version bigint,
  quoted_amount_krw integer not null default 0 check (quoted_amount_krw >= 0),
  next_amount_krw integer not null default 0 check (next_amount_krw >= 0),
  effective_at timestamptz,
  next_billing_at timestamptz,
  payment_id uuid references public.billing_toss_payments(id) on delete set null,
  checkout_session_id uuid references public.billing_toss_checkout_sessions(id) on delete set null,
  idempotency_key uuid not null default gen_random_uuid() unique,
  failure_code text,
  failure_message text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_toss_operations_user_created
  on public.billing_toss_operations (user_id, created_at desc);

create index if not exists idx_billing_toss_operations_reconcile
  on public.billing_toss_operations (updated_at)
  where status in ('awaiting_auth', 'processing', 'payment_uncertain', 'paid_pending_apply');

create unique index if not exists idx_billing_toss_operations_one_open_user
  on public.billing_toss_operations (user_id)
  where status in ('prepared', 'awaiting_auth', 'processing', 'payment_uncertain', 'paid_pending_apply');

alter table public.billing_toss_checkout_sessions
  add column if not exists purpose text not null default 'initial_subscription',
  add column if not exists operation_id uuid references public.billing_toss_operations(id) on delete set null,
  add column if not exists callback_token_hash text;

alter table public.billing_toss_checkout_sessions
  drop constraint if exists billing_toss_checkout_sessions_purpose_check;
alter table public.billing_toss_checkout_sessions
  add constraint billing_toss_checkout_sessions_purpose_check
  check (purpose in ('initial_subscription', 'replace_payment_method'));

create unique index if not exists idx_billing_toss_checkout_sessions_one_open_operation
  on public.billing_toss_checkout_sessions (operation_id)
  where operation_id is not null
    and status in ('created', 'auth_succeeded', 'processing');

alter table public.billing_toss_payments
  add column if not exists operation_id uuid references public.billing_toss_operations(id) on delete set null;

create unique index if not exists idx_billing_toss_payments_operation
  on public.billing_toss_payments (operation_id)
  where operation_id is not null;

alter table public.billing_toss_subscriptions
  add column if not exists state_version bigint not null default 1,
  add column if not exists active_operation_id uuid references public.billing_toss_operations(id) on delete set null,
  add column if not exists active_operation_expires_at timestamptz;

create index if not exists idx_billing_toss_subscriptions_active_operation
  on public.billing_toss_subscriptions (active_operation_expires_at)
  where active_operation_id is not null;

drop trigger if exists trg_billing_toss_subscriptions_state_version
  on public.billing_toss_subscriptions;
create or replace function public.bump_billing_toss_subscription_state_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.plan_key is distinct from old.plan_key
     or new.plan_version_id is distinct from old.plan_version_id
     or new.status is distinct from old.status
     or new.billing_key is distinct from old.billing_key
     or new.current_period_start is distinct from old.current_period_start
     or new.current_period_end is distinct from old.current_period_end
     or new.next_billing_at is distinct from old.next_billing_at
     or new.renewal_due_at is distinct from old.renewal_due_at
     or new.cancel_at_period_end is distinct from old.cancel_at_period_end
     or new.grace_until is distinct from old.grace_until
     or new.pending_plan_key is distinct from old.pending_plan_key
     or new.pending_plan_version_id is distinct from old.pending_plan_version_id
     or new.last_payment_id is distinct from old.last_payment_id then
    new.state_version := coalesce(old.state_version, 0) + 1;
  end if;
  return new;
end;
$$;

create trigger trg_billing_toss_subscriptions_state_version
  before update on public.billing_toss_subscriptions
  for each row
  execute function public.bump_billing_toss_subscription_state_version();

drop trigger if exists trg_billing_toss_operations_updated_at
  on public.billing_toss_operations;
create trigger trg_billing_toss_operations_updated_at
  before update on public.billing_toss_operations
  for each row
  execute function public.set_updated_at();

alter table public.billing_toss_operations enable row level security;
revoke all on public.billing_toss_operations from public, anon, authenticated;
grant select, insert, update, delete on public.billing_toss_operations to service_role;

-- Quote creation is server-side and serializes users before any money movement.
-- A new unconfirmed quote supersedes only another unconfirmed quote; it can
-- never cancel an authentication, payment, or recovery operation.
create or replace function public.prepare_toss_billing_operation(
  p_user_id uuid,
  p_kind text,
  p_target_plan_key text,
  p_now timestamptz default now()
)
returns table (operation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_id uuid;
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_entitlement public.user_entitlements%rowtype;
  v_current_plan public.billing_plan_versions%rowtype;
  v_target_plan public.billing_plan_versions%rowtype;
  v_free_plan public.billing_plan_versions%rowtype;
  v_has_subscription boolean := false;
  v_has_entitlement boolean := false;
  v_amount integer := 0;
  v_effective_at timestamptz := null;
  v_next_billing_at timestamptz := null;
  v_operation_expires_at timestamptz;
  v_period_seconds numeric;
  v_remaining_ratio numeric;
begin
  if p_user_id is null then
    raise exception 'billing_user_required';
  end if;
  if p_kind not in (
    'subscribe',
    'upgrade',
    'downgrade',
    'cancel_subscription',
    'resume_subscription',
    'cancel_plan_change',
    'replace_payment_method'
  ) then
    raise exception 'billing_operation_kind_invalid';
  end if;
  if p_target_plan_key is not null
     and p_target_plan_key not in ('standard', 'pro') then
    raise exception 'billing_target_plan_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  v_operation_expires_at := p_now + interval '30 minutes';

  update public.billing_toss_operations
    set status = 'expired',
        failure_code = 'quote_expired',
        failure_message = '결제 확인 시간이 만료되었습니다.',
        completed_at = p_now
    where user_id = p_user_id
      and status = 'prepared'
      and expires_at <= p_now;

  update public.billing_toss_operations
    set status = 'cancelled',
        failure_code = 'quote_replaced',
        failure_message = '새로운 선택으로 대체되었습니다.',
        completed_at = p_now
    where user_id = p_user_id
      and status = 'prepared';

  if exists (
    select 1
      from public.billing_toss_operations
      where user_id = p_user_id
        and status in ('awaiting_auth', 'processing', 'payment_uncertain', 'paid_pending_apply')
  ) then
    raise exception 'billing_operation_in_progress';
  end if;

  select *
    into v_entitlement
    from public.user_entitlements
    where user_id = p_user_id
    for update;
  v_has_entitlement := found;
  if v_has_entitlement and v_entitlement.plan_key = 'internal' then
    raise exception 'internal_entitlement_billing_forbidden';
  end if;

  select *
    into v_subscription
    from public.billing_toss_subscriptions
    where user_id = p_user_id
      and status in ('active', 'past_due', 'grace', 'pending_cancel')
    order by created_at desc
    limit 1
    for update;
  v_has_subscription := found;

  if v_has_subscription then
    if not v_has_entitlement
       or v_entitlement.provider_subscription_id is distinct from v_subscription.id::text
       or v_entitlement.plan_key is distinct from v_subscription.plan_key then
      raise exception 'billing_state_inconsistent';
    end if;
  elsif v_has_entitlement
    and v_entitlement.plan_key in ('standard', 'pro')
    and v_entitlement.status in ('active', 'past_due', 'grace') then
    raise exception 'billing_state_inconsistent';
  end if;

  -- A subscription that reached its period boundary must first be reconciled
  -- by the monthly worker. In particular, never revive a just-ended pending
  -- cancellation merely because the worker has not picked it up yet.
  if v_has_subscription
     and v_subscription.status in ('active', 'pending_cancel')
     and v_subscription.current_period_end <= p_now
     and p_kind in (
       'upgrade',
       'downgrade',
       'cancel_subscription',
       'resume_subscription',
       'cancel_plan_change'
     ) then
    raise exception 'billing_period_ended';
  end if;
  if v_has_subscription and v_subscription.status in ('active', 'pending_cancel') then
    v_operation_expires_at := least(v_operation_expires_at, v_subscription.current_period_end);
  end if;

  if p_kind in ('subscribe', 'upgrade', 'downgrade') then
    select *
      into v_target_plan
      from public.billing_plan_versions
      where plan_key = p_target_plan_key
        and is_current
      order by effective_from desc
      limit 1;
    if not found or v_target_plan.monthly_price_krw <= 0 then
      raise exception 'billing_target_plan_missing';
    end if;
  end if;

  if v_has_subscription then
    select *
      into v_current_plan
      from public.billing_plan_versions
      where id = v_subscription.plan_version_id;
    if not found then
      select *
        into v_current_plan
        from public.billing_plan_versions
        where plan_key = v_subscription.plan_key
          and is_current
        order by effective_from desc
        limit 1;
    end if;
    if not found then
      raise exception 'billing_current_plan_missing';
    end if;
  end if;

  case p_kind
    when 'subscribe' then
      if v_has_subscription then
        raise exception 'billing_open_subscription_exists';
      end if;
      v_amount := v_target_plan.monthly_price_krw;
      v_effective_at := p_now;
      v_next_billing_at := p_now + interval '1 month';

    when 'upgrade' then
      if not v_has_subscription
         or v_subscription.status not in ('active', 'pending_cancel') then
        raise exception 'billing_subscription_not_upgradeable';
      end if;
      if v_target_plan.monthly_price_krw <= v_current_plan.monthly_price_krw then
        raise exception 'billing_upgrade_target_invalid';
      end if;
      v_period_seconds := extract(epoch from (v_subscription.current_period_end - v_subscription.current_period_start));
      if v_period_seconds <= 0 then
        raise exception 'billing_period_invalid';
      end if;
      v_remaining_ratio := least(
        1::numeric,
        greatest(
          0::numeric,
          extract(epoch from (v_subscription.current_period_end - greatest(p_now, v_subscription.current_period_start))) / v_period_seconds
        )
      );
      v_amount := ceil(
        (v_target_plan.monthly_price_krw - v_current_plan.monthly_price_krw)::numeric * v_remaining_ratio
      )::integer;
      v_effective_at := p_now;
      v_next_billing_at := v_subscription.current_period_end;

    when 'downgrade' then
      if not v_has_subscription
         or v_subscription.status not in ('active', 'pending_cancel') then
        raise exception 'billing_subscription_not_downgradeable';
      end if;
      if v_target_plan.monthly_price_krw >= v_current_plan.monthly_price_krw then
        raise exception 'billing_downgrade_target_invalid';
      end if;
      if v_subscription.pending_plan_key is not null then
        raise exception 'billing_plan_change_already_pending';
      end if;
      v_effective_at := v_subscription.current_period_end;
      v_next_billing_at := v_subscription.current_period_end;

    when 'cancel_subscription' then
      if not v_has_subscription then
        raise exception 'billing_subscription_missing';
      end if;
      if v_subscription.status = 'pending_cancel' then
        raise exception 'billing_cancellation_already_pending';
      end if;
      v_effective_at := case
        when v_subscription.status in ('grace', 'past_due') then p_now
        else v_subscription.current_period_end
      end;

    when 'resume_subscription' then
      if not v_has_subscription or v_subscription.status <> 'pending_cancel' then
        raise exception 'billing_subscription_not_resumable';
      end if;
      v_effective_at := p_now;
      v_next_billing_at := v_subscription.current_period_end;

    when 'cancel_plan_change' then
      if not v_has_subscription or v_subscription.pending_plan_key is null then
        raise exception 'billing_plan_change_missing';
      end if;
      v_effective_at := p_now;
      v_next_billing_at := v_subscription.current_period_end;

    when 'replace_payment_method' then
      if not v_has_subscription or v_subscription.status not in ('grace', 'past_due') then
        raise exception 'billing_payment_method_not_changeable';
      end if;
      v_target_plan := v_current_plan;
      v_effective_at := p_now;
      v_next_billing_at := v_subscription.next_billing_at;
  end case;

  insert into public.billing_toss_operations (
    user_id,
    subscription_id,
    kind,
    from_plan_key,
    target_plan_key,
    from_plan_version_id,
    target_plan_version_id,
    expected_subscription_version,
    quoted_amount_krw,
    next_amount_krw,
    effective_at,
    next_billing_at,
    expires_at
  )
  values (
    p_user_id,
    case when v_has_subscription then v_subscription.id else null end,
    p_kind,
    case when v_has_subscription then v_subscription.plan_key else null end,
    case when p_kind in ('subscribe', 'upgrade', 'downgrade', 'replace_payment_method') then v_target_plan.plan_key else null end,
    case when v_has_subscription then v_current_plan.id else null end,
    case when p_kind in ('subscribe', 'upgrade', 'downgrade', 'replace_payment_method') then v_target_plan.id else null end,
    case when v_has_subscription then v_subscription.state_version else null end,
    v_amount,
    case when v_target_plan.id is not null then v_target_plan.monthly_price_krw else 0 end,
    v_effective_at,
    v_next_billing_at,
    v_operation_expires_at
  )
  returning id into v_operation_id;

  return query select v_operation_id;
end;
$$;

revoke all on function public.prepare_toss_billing_operation(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_toss_billing_operation(uuid, text, text, timestamptz)
  to service_role;

-- Confirmation rechecks the quoted subscription version. Operations that do
-- not move money update the subscription ledger and entitlement projection in
-- this one transaction. Paid operations only acquire a short lease here; the
-- provider request is deliberately outside the transaction.
create or replace function public.confirm_toss_billing_operation(
  p_user_id uuid,
  p_operation_id uuid,
  p_now timestamptz default now()
)
returns table (operation_id uuid, operation_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.billing_toss_operations%rowtype;
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_entitlement public.user_entitlements%rowtype;
  v_target_plan public.billing_plan_versions%rowtype;
  v_free_plan public.billing_plan_versions%rowtype;
  v_has_subscription boolean := false;
  v_has_entitlement boolean := false;
  v_access_end timestamptz;
begin
  if p_user_id is null or p_operation_id is null then
    raise exception 'billing_operation_parameters_missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select *
    into v_operation
    from public.billing_toss_operations
    where id = p_operation_id
      and user_id = p_user_id
    for update;
  if not found then
    raise exception 'billing_operation_missing';
  end if;

  if v_operation.status in ('succeeded', 'failed', 'cancelled', 'expired') then
    return query select v_operation.id, v_operation.status;
    return;
  end if;
  if v_operation.status in ('awaiting_auth', 'processing', 'payment_uncertain', 'paid_pending_apply') then
    return query select v_operation.id, v_operation.status;
    return;
  end if;
  if v_operation.expires_at <= p_now then
    update public.billing_toss_operations
      set status = 'expired',
          failure_code = 'quote_expired',
          failure_message = '결제 확인 시간이 만료되었습니다.',
          completed_at = p_now
      where id = v_operation.id;
    return query select v_operation.id, 'expired'::text;
    return;
  end if;

  if v_operation.subscription_id is not null then
    select *
      into v_subscription
      from public.billing_toss_subscriptions
      where id = v_operation.subscription_id
        and user_id = p_user_id
      for update;
    v_has_subscription := found;
    if not v_has_subscription then
      update public.billing_toss_operations
        set status = 'failed',
            failure_code = 'subscription_missing',
            failure_message = '구독 정보를 찾을 수 없습니다.',
            completed_at = p_now
        where id = v_operation.id;
      return query select v_operation.id, 'failed'::text;
      return;
    end if;
    if v_subscription.state_version is distinct from v_operation.expected_subscription_version then
      update public.billing_toss_operations
        set status = 'failed',
            failure_code = 'state_changed',
            failure_message = '구독 상태가 바뀌어 금액을 다시 확인해야 합니다.',
            completed_at = p_now
        where id = v_operation.id;
      return query select v_operation.id, 'failed'::text;
      return;
    end if;
    if v_subscription.status in ('active', 'pending_cancel')
       and v_subscription.current_period_end <= p_now
       and v_operation.kind in (
         'upgrade',
         'downgrade',
         'cancel_subscription',
         'resume_subscription',
         'cancel_plan_change'
       ) then
      update public.billing_toss_operations
        set status = 'failed',
            failure_code = 'billing_period_ended',
            failure_message = '현재 결제 기간 종료를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.',
            completed_at = p_now
        where id = v_operation.id;
      return query select v_operation.id, 'failed'::text;
      return;
    end if;
    if v_subscription.renewal_lease_owner is not null
       and v_subscription.renewal_lease_expires_at > p_now then
      update public.billing_toss_operations
        set status = 'failed',
            failure_code = 'renewal_in_progress',
            failure_message = '월 갱신을 확인 중입니다. 잠시 후 다시 시도해 주세요.',
            completed_at = p_now
        where id = v_operation.id;
      return query select v_operation.id, 'failed'::text;
      return;
    end if;
    if v_subscription.active_operation_id is not null
       and v_subscription.active_operation_id <> v_operation.id
       and coalesce(v_subscription.active_operation_expires_at, p_now + interval '1 second') > p_now then
      update public.billing_toss_operations
        set status = 'failed',
            failure_code = 'billing_operation_in_progress',
            failure_message = '다른 결제 작업을 확인 중입니다.',
            completed_at = p_now
        where id = v_operation.id;
      return query select v_operation.id, 'failed'::text;
      return;
    end if;
    if v_subscription.active_operation_id is not null
       and coalesce(v_subscription.active_operation_expires_at, p_now) <= p_now then
      update public.billing_toss_subscriptions
        set active_operation_id = null,
            active_operation_expires_at = null
        where id = v_subscription.id;
    end if;
  end if;

  select *
    into v_entitlement
    from public.user_entitlements
    where user_id = p_user_id
    for update;
  v_has_entitlement := found;
  if v_has_entitlement and v_entitlement.plan_key = 'internal' then
    raise exception 'internal_entitlement_billing_forbidden';
  end if;

  if v_operation.target_plan_version_id is not null then
    select *
      into v_target_plan
      from public.billing_plan_versions
      where id = v_operation.target_plan_version_id;
    if not found then
      update public.billing_toss_operations
        set status = 'failed',
            failure_code = 'target_plan_missing',
            failure_message = '선택한 플랜 정보를 찾을 수 없습니다.',
            completed_at = p_now
        where id = v_operation.id;
      return query select v_operation.id, 'failed'::text;
      return;
    end if;
  end if;

  case v_operation.kind
    when 'subscribe' then
      if exists (
        select 1
          from public.billing_toss_subscriptions
          where user_id = p_user_id
            and status in ('active', 'past_due', 'grace', 'pending_cancel')
      ) then
        update public.billing_toss_operations
          set status = 'failed',
              failure_code = 'billing_open_subscription_exists',
              failure_message = '이미 열린 유료 구독이 있습니다.',
              completed_at = p_now
          where id = v_operation.id;
        return query select v_operation.id, 'failed'::text;
        return;
      end if;
      update public.billing_toss_operations
        set status = 'awaiting_auth',
            confirmed_at = p_now
        where id = v_operation.id;

    when 'upgrade' then
      if v_operation.quoted_amount_krw = 0 then
        update public.billing_toss_subscriptions
          set plan_key = v_target_plan.plan_key,
              plan_version_id = v_target_plan.id,
              status = 'active',
              cancel_at_period_end = false,
              pending_plan_key = null,
              pending_plan_version_id = null,
              renewal_lease_owner = null,
              renewal_lease_expires_at = null
          where id = v_subscription.id;
        update public.user_entitlements
          set plan_key = v_target_plan.plan_key,
              status = 'active',
              plan_version_id = v_target_plan.id,
              provider_price_id = v_target_plan.provider_price_id,
              cancel_at_period_end = false,
              plan_change_pending = null,
              grace_until = null,
              entitlement_updated_at = p_now
          where user_id = p_user_id
            and provider_subscription_id = v_subscription.id::text;
        update public.billing_toss_operations
          set status = 'succeeded',
              confirmed_at = p_now,
              completed_at = p_now
          where id = v_operation.id;
      else
        update public.billing_toss_subscriptions
          set active_operation_id = v_operation.id,
              active_operation_expires_at = p_now + interval '30 minutes'
          where id = v_subscription.id;
        update public.billing_toss_operations
          set status = 'processing',
              confirmed_at = p_now
          where id = v_operation.id;
      end if;

    when 'downgrade' then
      update public.billing_toss_subscriptions
        set status = 'active',
            cancel_at_period_end = false,
            cancelled_at = null,
            pending_plan_key = v_target_plan.plan_key,
            pending_plan_version_id = v_target_plan.id,
            renewal_lease_owner = null,
            renewal_lease_expires_at = null
        where id = v_subscription.id;
      update public.user_entitlements
        set status = 'active',
            cancel_at_period_end = false,
            plan_change_pending = jsonb_build_object(
              'plan_key', v_target_plan.plan_key,
              'plan_version_id', v_target_plan.id,
              'effective_at', v_operation.effective_at
            ),
            entitlement_updated_at = p_now
        where user_id = p_user_id
          and provider_subscription_id = v_subscription.id::text;
      update public.billing_toss_operations
        set status = 'succeeded',
            confirmed_at = p_now,
            completed_at = p_now
        where id = v_operation.id;

    when 'cancel_plan_change' then
      update public.billing_toss_subscriptions
        set pending_plan_key = null,
            pending_plan_version_id = null
        where id = v_subscription.id;
      update public.user_entitlements
        set plan_change_pending = null,
            entitlement_updated_at = p_now
        where user_id = p_user_id
          and provider_subscription_id = v_subscription.id::text;
      update public.billing_toss_operations
        set status = 'succeeded',
            confirmed_at = p_now,
            completed_at = p_now
        where id = v_operation.id;

    when 'cancel_subscription' then
      if v_subscription.status in ('grace', 'past_due') then
        select *
          into v_free_plan
          from public.billing_plan_versions
          where plan_key = 'free'
            and is_current
          order by effective_from desc
          limit 1;
        if not found then
          raise exception 'free_plan_version_missing';
        end if;
        v_access_end := p_now + interval '100 years';
        update public.billing_toss_subscriptions
          set status = 'cancelled',
              cancel_at_period_end = false,
              cancelled_at = p_now,
              pending_plan_key = null,
              pending_plan_version_id = null,
              renewal_lease_owner = null,
              renewal_lease_expires_at = null,
              terminal_entitlement_applied_at = p_now,
              billing_key_delete_pending = true
          where id = v_subscription.id;
        update public.user_entitlements
          set plan_key = 'free',
              status = 'active',
              current_period_start = p_now,
              current_period_end = v_access_end,
              billing_period_start = p_now,
              billing_period_end = v_access_end,
              credit_anchor_at = null,
              plan_version_id = v_free_plan.id,
              provider_customer_id = null,
              provider_subscription_id = null,
              provider_price_id = v_free_plan.provider_price_id,
              cancel_at_period_end = false,
              plan_change_pending = null,
              grace_until = null,
              entitlement_updated_at = p_now
          where user_id = p_user_id
            and provider_subscription_id = v_subscription.id::text;
      else
        update public.billing_toss_subscriptions
          set status = 'pending_cancel',
              cancel_at_period_end = true,
              pending_plan_key = null,
              pending_plan_version_id = null,
              renewal_lease_owner = null,
              renewal_lease_expires_at = null
          where id = v_subscription.id;
        update public.user_entitlements
          set cancel_at_period_end = true,
              plan_change_pending = null,
              entitlement_updated_at = p_now
          where user_id = p_user_id
            and provider_subscription_id = v_subscription.id::text;
      end if;
      update public.billing_toss_operations
        set status = 'succeeded',
            confirmed_at = p_now,
            completed_at = p_now
        where id = v_operation.id;

    when 'resume_subscription' then
      update public.billing_toss_subscriptions
        set status = 'active',
            cancel_at_period_end = false,
            cancelled_at = null
        where id = v_subscription.id;
      update public.user_entitlements
        set status = 'active',
            cancel_at_period_end = false,
            grace_until = null,
            entitlement_updated_at = p_now
        where user_id = p_user_id
          and provider_subscription_id = v_subscription.id::text;
      update public.billing_toss_operations
        set status = 'succeeded',
            confirmed_at = p_now,
            completed_at = p_now
        where id = v_operation.id;

    when 'replace_payment_method' then
      update public.billing_toss_subscriptions
        set active_operation_id = v_operation.id,
            active_operation_expires_at = p_now + interval '30 minutes'
        where id = v_subscription.id;
      update public.billing_toss_operations
        set status = 'awaiting_auth',
            confirmed_at = p_now
        where id = v_operation.id;
  end case;

  select status
    into operation_status
    from public.billing_toss_operations
    where id = v_operation.id;
  return query select v_operation.id, operation_status;
end;
$$;

revoke all on function public.confirm_toss_billing_operation(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirm_toss_billing_operation(uuid, uuid, timestamptz)
  to service_role;

create or replace function public.mark_toss_billing_operation_recoverable(
  p_user_id uuid,
  p_operation_id uuid,
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
  v_operation public.billing_toss_operations%rowtype;
begin
  if p_status not in ('failed', 'payment_uncertain', 'paid_pending_apply') then
    raise exception 'billing_recoverable_status_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select *
    into v_operation
    from public.billing_toss_operations
    where id = p_operation_id
      and user_id = p_user_id
    for update;
  if not found or v_operation.status = 'succeeded' then
    return false;
  end if;

  update public.billing_toss_operations
    set status = p_status,
        failure_code = left(coalesce(p_failure_code, 'billing_error'), 100),
        failure_message = left(coalesce(p_failure_message, '결제 처리에 실패했습니다.'), 500),
        completed_at = case when p_status = 'failed' then p_now else null end
    where id = v_operation.id;

  if p_status = 'failed' and v_operation.subscription_id is not null then
    update public.billing_toss_subscriptions
      set active_operation_id = null,
          active_operation_expires_at = null
      where id = v_operation.subscription_id
        and active_operation_id = v_operation.id;
  end if;

  return true;
end;
$$;

revoke all on function public.mark_toss_billing_operation_recoverable(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_toss_billing_operation_recoverable(uuid, uuid, text, text, text, timestamptz)
  to service_role;

-- A paid operation settles the payment record, subscription ledger,
-- entitlement projection, and operation status together. If this transaction
-- fails after Toss has charged, the payment remains durable and the worker
-- retries this exact function; it never creates another charge for recovery.
create or replace function public.finalize_toss_billing_v2_payment(
  p_user_id uuid,
  p_operation_id uuid,
  p_payment_id uuid,
  p_billing_key text,
  p_billing_key_issued_at timestamptz,
  p_card_snapshot jsonb,
  p_now timestamptz default now()
)
returns table (subscription_id uuid, already_applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.billing_toss_operations%rowtype;
  v_payment public.billing_toss_payments%rowtype;
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_existing_subscription public.billing_toss_subscriptions%rowtype;
  v_session public.billing_toss_checkout_sessions%rowtype;
  v_entitlement public.user_entitlements%rowtype;
  v_target_plan public.billing_plan_versions%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_credit_anchor_at timestamptz;
  v_already_applied boolean := false;
begin
  if p_user_id is null or p_operation_id is null or p_payment_id is null then
    raise exception 'billing_finalizer_parameters_missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select *
    into v_operation
    from public.billing_toss_operations
    where id = p_operation_id
      and user_id = p_user_id
    for update;
  if not found then
    raise exception 'billing_operation_missing';
  end if;
  if v_operation.status = 'succeeded' and v_operation.subscription_id is not null then
    return query select v_operation.subscription_id, true;
    return;
  end if;
  if v_operation.kind not in ('subscribe', 'upgrade') then
    raise exception 'billing_finalizer_kind_invalid';
  end if;

  select *
    into v_payment
    from public.billing_toss_payments
    where id = p_payment_id
      and user_id = p_user_id
      and operation_id = v_operation.id
    for update;
  if not found then
    raise exception 'billing_operation_payment_missing';
  end if;
  if v_payment.status <> 'paid' then
    raise exception 'billing_operation_payment_not_paid';
  end if;

  select *
    into v_target_plan
    from public.billing_plan_versions
    where id = v_operation.target_plan_version_id;
  if not found or v_target_plan.plan_key not in ('standard', 'pro') then
    raise exception 'billing_target_plan_missing';
  end if;

  if v_operation.kind = 'subscribe' then
    if p_billing_key is null or length(trim(p_billing_key)) = 0 then
      raise exception 'billing_key_missing';
    end if;
    select *
      into v_session
      from public.billing_toss_checkout_sessions
      where id = v_operation.checkout_session_id
        and operation_id = v_operation.id
        and user_id = p_user_id
      for update;
    if not found or v_session.purpose <> 'initial_subscription' then
      raise exception 'billing_checkout_session_missing';
    end if;

    select *
      into v_existing_subscription
      from public.billing_toss_subscriptions
      where last_payment_id = v_payment.id
      for update;
    if found then
      v_subscription := v_existing_subscription;
      v_already_applied := true;
    else
      if exists (
        select 1
          from public.billing_toss_subscriptions
          where user_id = p_user_id
            and status in ('active', 'past_due', 'grace', 'pending_cancel')
      ) then
        raise exception 'billing_open_subscription_exists';
      end if;
      v_period_start := coalesce(v_payment.billing_period_start, v_payment.paid_at, p_now);
      v_period_end := coalesce(v_payment.billing_period_end, v_period_start + interval '1 month');
      insert into public.billing_toss_subscriptions (
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
        cancel_at_period_end,
        last_payment_id
      )
      values (
        p_user_id,
        v_target_plan.plan_key,
        v_target_plan.id,
        'active',
        v_session.customer_key,
        p_billing_key,
        'CARD',
        p_billing_key_issued_at,
        coalesce(p_card_snapshot, '{}'::jsonb),
        v_period_start,
        v_period_end,
        v_period_end,
        v_period_end,
        false,
        v_payment.id
      )
      returning * into v_subscription;
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
      where id = v_operation.subscription_id
        and user_id = p_user_id
      for update;
    if not found then
      raise exception 'billing_subscription_missing';
    end if;

    if v_subscription.last_payment_id = v_payment.id
       and v_subscription.plan_version_id = v_target_plan.id then
      v_already_applied := true;
    else
      if v_subscription.active_operation_id is distinct from v_operation.id
         or v_subscription.state_version is distinct from v_operation.expected_subscription_version then
        raise exception 'billing_operation_state_changed';
      end if;
      update public.billing_toss_subscriptions
        set plan_key = v_target_plan.plan_key,
            plan_version_id = v_target_plan.id,
            status = 'active',
            cancel_at_period_end = false,
            cancelled_at = null,
            pending_plan_key = null,
            pending_plan_version_id = null,
            grace_until = null,
            renewal_lease_owner = null,
            renewal_lease_expires_at = null,
            active_operation_id = null,
            active_operation_expires_at = null,
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
  if found and v_entitlement.plan_key = 'internal' then
    raise exception 'internal_entitlement_billing_forbidden';
  end if;

  v_credit_anchor_at := coalesce(
    v_entitlement.credit_anchor_at,
    v_subscription.current_period_start
  );
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
    v_target_plan.plan_key,
    'active',
    v_subscription.current_period_start,
    v_subscription.current_period_end,
    v_subscription.current_period_start,
    v_subscription.current_period_end,
    v_credit_anchor_at,
    v_target_plan.id,
    v_subscription.customer_key,
    v_subscription.id::text,
    v_target_plan.provider_price_id,
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

  update public.billing_toss_payments
    set subscription_id = v_subscription.id,
        billing_period_start = coalesce(billing_period_start, v_subscription.current_period_start),
        billing_period_end = coalesce(billing_period_end, v_subscription.current_period_end),
        fulfillment_status = 'applied',
        fulfillment_error = null,
        fulfillment_attempted_at = p_now,
        fulfillment_applied_at = p_now
    where id = v_payment.id;

  update public.billing_toss_operations
    set subscription_id = v_subscription.id,
        status = 'succeeded',
        failure_code = null,
        failure_message = null,
        completed_at = p_now
    where id = v_operation.id;

  update public.billing_toss_subscriptions
    set active_operation_id = null,
        active_operation_expires_at = null
    where id = v_subscription.id
      and active_operation_id = v_operation.id;

  return query select v_subscription.id, v_already_applied;
end;
$$;

revoke all on function public.finalize_toss_billing_v2_payment(uuid, uuid, uuid, text, timestamptz, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_toss_billing_v2_payment(uuid, uuid, uuid, text, timestamptz, jsonb, timestamptz)
  to service_role;

create table if not exists public.billing_toss_retired_billing_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.billing_toss_subscriptions(id) on delete cascade,
  billing_key text not null,
  status text not null default 'pending' check (status in ('pending', 'deleted', 'failed')),
  failure_code text,
  attempted_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, billing_key)
);

create index if not exists idx_billing_toss_retired_billing_keys_pending
  on public.billing_toss_retired_billing_keys (created_at)
  where status in ('pending', 'failed');

drop trigger if exists trg_billing_toss_retired_billing_keys_updated_at
  on public.billing_toss_retired_billing_keys;
create trigger trg_billing_toss_retired_billing_keys_updated_at
  before update on public.billing_toss_retired_billing_keys
  for each row
  execute function public.set_updated_at();

alter table public.billing_toss_retired_billing_keys enable row level security;
revoke all on public.billing_toss_retired_billing_keys from public, anon, authenticated;
grant select, insert, update, delete on public.billing_toss_retired_billing_keys to service_role;

create or replace function public.finalize_toss_billing_key_replacement(
  p_user_id uuid,
  p_operation_id uuid,
  p_billing_key text,
  p_billing_key_issued_at timestamptz,
  p_card_snapshot jsonb,
  p_now timestamptz default now()
)
returns table (subscription_id uuid, already_applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.billing_toss_operations%rowtype;
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_session public.billing_toss_checkout_sessions%rowtype;
  v_old_billing_key text;
begin
  if p_user_id is null or p_operation_id is null
     or p_billing_key is null or length(trim(p_billing_key)) = 0 then
    raise exception 'billing_key_replacement_parameters_missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select *
    into v_operation
    from public.billing_toss_operations
    where id = p_operation_id
      and user_id = p_user_id
    for update;
  if not found then
    raise exception 'billing_operation_missing';
  end if;
  if v_operation.status = 'succeeded' and v_operation.subscription_id is not null then
    return query select v_operation.subscription_id, true;
    return;
  end if;
  if v_operation.kind <> 'replace_payment_method' then
    raise exception 'billing_key_replacement_kind_invalid';
  end if;

  select *
    into v_subscription
    from public.billing_toss_subscriptions
    where id = v_operation.subscription_id
      and user_id = p_user_id
    for update;
  if not found then
    raise exception 'billing_subscription_missing';
  end if;
  if v_subscription.active_operation_id is distinct from v_operation.id then
    raise exception 'billing_operation_state_changed';
  end if;

  select *
    into v_session
    from public.billing_toss_checkout_sessions
    where id = v_operation.checkout_session_id
      and operation_id = v_operation.id
      and user_id = p_user_id
    for update;
  if not found or v_session.purpose <> 'replace_payment_method' then
    raise exception 'billing_checkout_session_missing';
  end if;

  v_old_billing_key := v_subscription.billing_key;
  update public.billing_toss_subscriptions
    set billing_key = p_billing_key,
        billing_key_issued_at = p_billing_key_issued_at,
        card_snapshot = coalesce(p_card_snapshot, '{}'::jsonb),
        active_operation_id = null,
        active_operation_expires_at = null
    where id = v_subscription.id
    returning * into v_subscription;

  if v_old_billing_key is distinct from p_billing_key then
    insert into public.billing_toss_retired_billing_keys (
      user_id,
      subscription_id,
      billing_key
    )
    values (p_user_id, v_subscription.id, v_old_billing_key)
    on conflict (subscription_id, billing_key) do nothing;
  end if;

  update public.billing_toss_checkout_sessions
    set status = 'paid',
        failure_code = null,
        failure_message = null
    where id = v_session.id;

  update public.billing_toss_operations
    set status = 'succeeded',
        failure_code = null,
        failure_message = null,
        completed_at = p_now
    where id = v_operation.id;

  return query select v_subscription.id, false;
end;
$$;

revoke all on function public.finalize_toss_billing_key_replacement(uuid, uuid, text, timestamptz, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_toss_billing_key_replacement(uuid, uuid, text, timestamptz, jsonb, timestamptz)
  to service_role;

create or replace function public.expire_toss_billing_operations(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
begin
  update public.billing_toss_operations
    set status = 'expired',
        failure_code = 'operation_expired',
        failure_message = '결제 작업 시간이 만료되었습니다.',
        completed_at = p_now
    where status in ('prepared', 'awaiting_auth')
      and expires_at <= p_now;
  get diagnostics v_expired = row_count;

  update public.billing_toss_subscriptions as subscription
    set active_operation_id = null,
        active_operation_expires_at = null
    from public.billing_toss_operations as operation
    where subscription.active_operation_id = operation.id
      and operation.status in ('succeeded', 'failed', 'cancelled', 'expired');

  return v_expired;
end;
$$;

revoke all on function public.expire_toss_billing_operations(timestamptz)
  from public, anon, authenticated;
grant execute on function public.expire_toss_billing_operations(timestamptz)
  to service_role;

create or replace function public.claim_due_toss_subscriptions(
  p_worker_id text,
  p_now timestamptz default now(),
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns table (subscription_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then
    raise exception 'lease_seconds must be between 30 and 1800';
  end if;

  return query
  with candidates as (
    select s.id
      from public.billing_toss_subscriptions as s
      where s.status in ('active', 'past_due', 'grace')
        and s.cancel_at_period_end = false
        and s.next_billing_at <= p_now
        and s.active_operation_id is null
        and (
          s.renewal_lease_expires_at is null
          or s.renewal_lease_expires_at <= p_now
        )
      order by s.next_billing_at asc
      limit p_limit
      for update skip locked
  )
  update public.billing_toss_subscriptions as s
    set renewal_lease_owner = p_worker_id,
        renewal_lease_expires_at =
          p_now + make_interval(secs => p_lease_seconds),
        updated_at = now()
    from candidates as c
    where s.id = c.id
    returning s.id;
end;
$$;

revoke all on function public.claim_due_toss_subscriptions(text, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_toss_subscriptions(text, timestamptz, integer, integer)
  to service_role;

-- A replacement card is valid only after the old key is atomically retired.
-- This claim ensures the immediate recovery attempt cannot race the monthly
-- worker or any other user-initiated operation.
create or replace function public.claim_toss_subscription_for_payment_recovery(
  p_user_id uuid,
  p_subscription_id uuid,
  p_worker_id text,
  p_now timestamptz default now(),
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  if p_user_id is null or p_subscription_id is null then
    raise exception 'billing_recovery_parameters_missing';
  end if;
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then
    raise exception 'lease_seconds must be between 30 and 1800';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  update public.billing_toss_subscriptions
    set next_billing_at = p_now,
        renewal_lease_owner = p_worker_id,
        renewal_lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        updated_at = now()
    where id = p_subscription_id
      and user_id = p_user_id
      and status in ('past_due', 'grace')
      and cancel_at_period_end = false
      and active_operation_id is null
      and (
        renewal_lease_expires_at is null
        or renewal_lease_expires_at <= p_now
      )
    returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_toss_subscription_for_payment_recovery(uuid, uuid, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_toss_subscription_for_payment_recovery(uuid, uuid, text, timestamptz, integer)
  to service_role;

-- The buyer may close Toss before authentication completes. Only a quote or
-- auth-waiting operation can be cancelled by the buyer; anything that could
-- have reached the provider remains recoverable instead of being discarded.
create or replace function public.cancel_toss_billing_operation(
  p_user_id uuid,
  p_operation_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.billing_toss_operations%rowtype;
begin
  if p_user_id is null or p_operation_id is null then
    raise exception 'billing_operation_parameters_missing';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select *
    into v_operation
    from public.billing_toss_operations
    where id = p_operation_id
      and user_id = p_user_id
    for update;
  if not found then
    raise exception 'billing_operation_missing';
  end if;
  if v_operation.status not in ('prepared', 'awaiting_auth') then
    return false;
  end if;

  update public.billing_toss_checkout_sessions
    set status = 'cancelled',
        failure_code = 'buyer_cancelled',
        failure_message = '사용자가 자동결제 인증을 취소했습니다.'
    where operation_id = v_operation.id
      and status in ('created', 'auth_succeeded');

  update public.billing_toss_operations
    set status = 'cancelled',
        failure_code = 'buyer_cancelled',
        failure_message = '자동결제 인증을 취소했습니다.',
        completed_at = p_now
    where id = v_operation.id;

  if v_operation.subscription_id is not null then
    update public.billing_toss_subscriptions
      set active_operation_id = null,
          active_operation_expires_at = null
      where id = v_operation.subscription_id
        and active_operation_id = v_operation.id;
  end if;
  return true;
end;
$$;

revoke all on function public.cancel_toss_billing_operation(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cancel_toss_billing_operation(uuid, uuid, timestamptz)
  to service_role;

-- Renewal failure changes the subscription ledger and entitlement projection
-- together. A possibly successful payment must never be treated as a decline
-- here; callers send only confirmed provider declines to this function.
create or replace function public.apply_toss_renewal_failure(
  p_user_id uuid,
  p_subscription_id uuid,
  p_grace_until timestamptz,
  p_retry_at timestamptz,
  p_next_attempt_count integer,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_entitlement public.user_entitlements%rowtype;
  v_free_plan public.billing_plan_versions%rowtype;
  v_access_end timestamptz;
begin
  if p_user_id is null
     or p_subscription_id is null
     or p_grace_until is null
     or p_next_attempt_count < 1 then
    raise exception 'renewal_failure_parameters_missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select *
    into v_subscription
    from public.billing_toss_subscriptions
    where id = p_subscription_id
      and user_id = p_user_id
    for update;
  if not found then
    raise exception 'billing_subscription_missing';
  end if;
  if v_subscription.status not in ('active', 'past_due', 'grace') then
    raise exception 'renewal_subscription_not_actionable';
  end if;
  if v_subscription.active_operation_id is not null then
    raise exception 'billing_operation_in_progress';
  end if;

  select *
    into v_entitlement
    from public.user_entitlements
    where user_id = p_user_id
    for update;
  if not found
     or v_entitlement.provider_subscription_id is distinct from v_subscription.id::text then
    raise exception 'billing_state_inconsistent';
  end if;
  if v_entitlement.plan_key = 'internal' then
    raise exception 'internal_entitlement_billing_forbidden';
  end if;

  if p_grace_until <= p_now then
    select *
      into v_free_plan
      from public.billing_plan_versions
      where plan_key = 'free'
        and is_current
      order by effective_from desc
      limit 1;
    if not found then
      raise exception 'free_plan_version_missing';
    end if;
    v_access_end := p_now + interval '100 years';

    update public.billing_toss_subscriptions
      set status = 'expired',
          grace_until = p_grace_until,
          renewal_attempt_count = p_next_attempt_count,
          pending_plan_key = null,
          pending_plan_version_id = null,
          renewal_lease_owner = null,
          renewal_lease_expires_at = null,
          terminal_entitlement_applied_at = p_now,
          billing_key_delete_pending = true
      where id = v_subscription.id;
    update public.user_entitlements
      set plan_key = 'free',
          status = 'active',
          current_period_start = p_now,
          current_period_end = v_access_end,
          billing_period_start = p_now,
          billing_period_end = v_access_end,
          credit_anchor_at = null,
          plan_version_id = v_free_plan.id,
          provider_customer_id = null,
          provider_subscription_id = null,
          provider_price_id = v_free_plan.provider_price_id,
          cancel_at_period_end = false,
          plan_change_pending = null,
          grace_until = null,
          entitlement_updated_at = p_now
      where user_id = p_user_id
        and provider_subscription_id = v_subscription.id::text;
    return 'expired';
  end if;

  if p_retry_at is null or p_retry_at <= p_now then
    raise exception 'renewal_retry_at_invalid';
  end if;
  update public.billing_toss_subscriptions
    set status = 'grace',
        grace_until = p_grace_until,
        renewal_attempt_count = p_next_attempt_count,
        next_billing_at = p_retry_at,
        renewal_lease_owner = null,
        renewal_lease_expires_at = null
    where id = v_subscription.id;
  update public.user_entitlements
    set status = 'grace',
        grace_until = p_grace_until,
        entitlement_updated_at = p_now
    where user_id = p_user_id
      and provider_subscription_id = v_subscription.id::text;
  return 'grace';
end;
$$;

revoke all on function public.apply_toss_renewal_failure(uuid, uuid, timestamptz, timestamptz, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_toss_renewal_failure(uuid, uuid, timestamptz, timestamptz, integer, timestamptz)
  to service_role;

-- Period-end cancellation, pre-V2 terminal records, and entitlement demotion
-- are reconciled by one transaction. It deliberately ignores an entitlement
-- owned by another subscription so a terminal historical row cannot revoke a
-- newer paid subscription.
create or replace function public.finalize_toss_terminal_subscriptions(
  p_now timestamptz default now(),
  p_limit integer default 25
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.billing_toss_subscriptions%rowtype;
  v_entitlement public.user_entitlements%rowtype;
  v_free_plan public.billing_plan_versions%rowtype;
  v_candidate_id uuid;
  v_candidate_user_id uuid;
  v_access_end timestamptz := p_now + interval '100 years';
  v_finalized integer := 0;
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100';
  end if;

  select *
    into v_free_plan
    from public.billing_plan_versions
    where plan_key = 'free'
      and is_current
    order by effective_from desc
    limit 1;
  if not found then
    raise exception 'free_plan_version_missing';
  end if;

  -- Take the per-user lock before any row locks. All billing mutations use
  -- that order, so a month-end worker cannot deadlock against a quote or
  -- payment finalizer that already holds the user's entitlement row.
  for v_candidate_id, v_candidate_user_id in
    select id, user_id
      from public.billing_toss_subscriptions
      where active_operation_id is null
        and (
          (status = 'pending_cancel' and current_period_end <= p_now)
          or (status in ('cancelled', 'expired') and terminal_entitlement_applied_at is null)
        )
      order by current_period_end asc, updated_at asc
      limit p_limit
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_candidate_user_id::text, 0));

    select *
      into v_subscription
      from public.billing_toss_subscriptions
      where id = v_candidate_id
        and user_id = v_candidate_user_id
        and active_operation_id is null
        and (
          (status = 'pending_cancel' and current_period_end <= p_now)
          or (status in ('cancelled', 'expired') and terminal_entitlement_applied_at is null)
        )
      for update;
    if not found then
      continue;
    end if;

    if v_subscription.status = 'pending_cancel' then
      update public.billing_toss_subscriptions
        set status = 'cancelled',
            cancel_at_period_end = false,
            cancelled_at = coalesce(cancelled_at, p_now),
            pending_plan_key = null,
            pending_plan_version_id = null,
            renewal_lease_owner = null,
            renewal_lease_expires_at = null,
            billing_key_delete_pending = true
        where id = v_subscription.id
        returning * into v_subscription;
    end if;

    select *
      into v_entitlement
      from public.user_entitlements
      where user_id = v_subscription.user_id
      for update;
    if found
       and v_entitlement.provider_subscription_id = v_subscription.id::text
       and v_entitlement.plan_key <> 'internal' then
      update public.user_entitlements
        set plan_key = 'free',
            status = 'active',
            current_period_start = p_now,
            current_period_end = v_access_end,
            billing_period_start = p_now,
            billing_period_end = v_access_end,
            credit_anchor_at = null,
            plan_version_id = v_free_plan.id,
            provider_customer_id = null,
            provider_subscription_id = null,
            provider_price_id = v_free_plan.provider_price_id,
            cancel_at_period_end = false,
            plan_change_pending = null,
            grace_until = null,
            entitlement_updated_at = p_now
        where user_id = v_subscription.user_id
          and provider_subscription_id = v_subscription.id::text;
    end if;

    update public.billing_toss_subscriptions
      set terminal_entitlement_applied_at = p_now,
          billing_key_delete_pending = true
      where id = v_subscription.id
        and terminal_entitlement_applied_at is null;
    v_finalized := v_finalized + 1;
  end loop;

  return v_finalized;
end;
$$;

revoke all on function public.finalize_toss_terminal_subscriptions(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_toss_terminal_subscriptions(timestamptz, integer)
  to service_role;
