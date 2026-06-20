-- Harden Toss auto-billing lifecycle and make weekly credit enforcement aware
-- of paid entitlement expiry, pending plan changes, and immediate upgrades.

alter table public.user_entitlements
  add column if not exists grace_until timestamptz;

alter table public.billing_toss_checkout_sessions
  add column if not exists billing_key_idempotency_key uuid not null default gen_random_uuid();

alter table public.billing_toss_subscriptions
  add column if not exists grace_until timestamptz,
  add column if not exists renewal_due_at timestamptz,
  add column if not exists renewal_attempt_count integer not null default 0
    check (renewal_attempt_count >= 0),
  add column if not exists renewal_lease_owner text,
  add column if not exists renewal_lease_expires_at timestamptz,
  add column if not exists pending_plan_key text
    check (pending_plan_key is null or pending_plan_key in ('standard', 'pro')),
  add column if not exists pending_plan_version_id uuid
    references public.billing_plan_versions(id);

update public.billing_toss_subscriptions
  set renewal_due_at = current_period_end
  where renewal_due_at is null;

alter table public.billing_toss_subscriptions
  alter column renewal_due_at set not null;

alter table public.billing_toss_payments
  add column if not exists billing_period_start timestamptz,
  add column if not exists billing_period_end timestamptz,
  add column if not exists attempt_number integer not null default 1
    check (attempt_number > 0);

create index if not exists idx_billing_toss_subscriptions_renewal_claim
  on public.billing_toss_subscriptions (
    next_billing_at,
    renewal_lease_expires_at
  )
  where status in ('active', 'past_due', 'grace');

create unique index if not exists idx_billing_toss_payments_open_period
  on public.billing_toss_payments (
    subscription_id,
    payment_kind,
    billing_period_start
  )
  where subscription_id is not null
    and billing_period_start is not null
    and status in ('pending', 'paid');

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
  v_pending_plan_key text;
  v_pending_plan_version_id uuid;
  v_pending_effective_at timestamptz;
  v_anchor timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_reserve bigint := greatest(coalesce(p_reserve_credits_raw, 0), 0);
  v_limit bigint;
  v_would_exceed boolean;
  v_allowed boolean;
  v_reason text;
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

  if jsonb_typeof(v_ent.plan_change_pending) = 'object' then
    v_pending_plan_key := v_ent.plan_change_pending ->> 'plan_key';
    begin
      v_pending_plan_version_id :=
        nullif(v_ent.plan_change_pending ->> 'plan_version_id', '')::uuid;
      v_pending_effective_at :=
        nullif(v_ent.plan_change_pending ->> 'effective_at', '')::timestamptz;
    exception
      when invalid_text_representation or invalid_datetime_format then
        v_pending_plan_version_id := null;
        v_pending_effective_at := null;
    end;

    if v_pending_plan_key in ('free', 'standard', 'pro')
       and v_pending_effective_at is not null
       and v_pending_effective_at <= p_now then
      if v_pending_plan_version_id is null then
        select id
          into v_pending_plan_version_id
          from public.billing_plan_versions
          where plan_key = v_pending_plan_key
            and is_current
          order by effective_from desc
          limit 1;
      end if;

      update public.user_entitlements
        set plan_key = v_pending_plan_key,
            plan_version_id = v_pending_plan_version_id,
            plan_change_pending = null,
            entitlement_updated_at = now()
        where user_id = p_user_id
        returning * into v_ent;
    end if;
  end if;

  if v_ent.status not in ('active', 'grace') then
    return query select false, 'entitlement_inactive', null::uuid,
      null::timestamptz, null::timestamptz, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  if v_ent.plan_key in ('standard', 'pro')
     and coalesce(v_ent.billing_period_end, v_ent.current_period_end) <= p_now
     and not (
       v_ent.status = 'grace'
       and v_ent.grace_until is not null
       and v_ent.grace_until > p_now
     ) then
    return query select false, 'entitlement_expired', null::uuid,
      null::timestamptz, null::timestamptz, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  v_plan_key := case
    when v_ent.plan_key = 'power' then 'pro'
    when v_ent.plan_key in ('free', 'standard', 'pro', 'beta', 'internal')
      then v_ent.plan_key
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
          provider_price_id = coalesce(
            v_ent.provider_price_id,
            v_plan_version.provider_price_id
          ),
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

  select c.period_start, c.period_end
    into v_period_start, v_period_end
    from public.current_weekly_credit_period(v_anchor, p_now) as c;

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
  on conflict on constraint usage_credit_balances_pkey do nothing;

  select *
    into v_balance
    from public.usage_credit_balances as ucb
    where ucb.user_id = p_user_id
      and ucb.period_kind = 'weekly'
      and ucb.period_start = v_period_start
      and ucb.period_end = v_period_end
    for update;

  -- Upgrades increase the active weekly bucket immediately. Downgrades never
  -- reduce an already-created bucket; the lower limit starts next week.
  if v_limit > v_balance.credits_limit_raw then
    update public.usage_credit_balances as ucb
      set plan_key_snapshot = v_plan_key,
          plan_version_id = v_plan_version.id,
          credit_policy_version = v_plan_version.credit_policy_version,
          credits_limit_raw = v_limit,
          updated_at = now()
      where ucb.user_id = p_user_id
        and ucb.period_kind = 'weekly'
        and ucb.period_start = v_period_start
        and ucb.period_end = v_period_end
      returning * into v_balance;
  end if;

  select *
    into v_existing
    from public.run_credit_reservations
    where user_id = p_user_id
      and request_id = p_request_id
    for update;

  if found and v_existing.status in ('reserved', 'running', 'settled') then
    v_allowed :=
      v_balance.credits_used_raw + v_balance.credits_reserved_raw
      <= v_balance.credits_limit_raw;
    v_reason := case
      when v_allowed then null
      else 'weekly_credit_limit_exceeded'
    end;
    return query select v_allowed, v_reason, v_existing.id,
      v_existing.credit_period_start, v_existing.credit_period_end,
      v_balance.credits_used_raw, v_balance.credits_reserved_raw,
      v_balance.credits_limit_raw;
    return;
  end if;

  v_would_exceed :=
    v_balance.credits_used_raw
    + v_balance.credits_reserved_raw
    + v_reserve
    > v_balance.credits_limit_raw;
  v_allowed := not v_would_exceed;
  v_reason := case
    when v_would_exceed then 'weekly_credit_limit_exceeded'
    else null
  end;

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
          metadata = jsonb_build_object(
            'shadow_allowed', v_allowed,
            'shadow_reason', v_reason
          ),
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
      metadata,
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
      jsonb_build_object(
        'shadow_allowed', v_allowed,
        'shadow_reason', v_reason
      ),
      p_expires_at
    )
    returning * into v_existing;
  end if;

  update public.usage_credit_balances as ucb
    set credits_reserved_raw = ucb.credits_reserved_raw + v_reserve,
        updated_at = now()
    where ucb.user_id = p_user_id
      and ucb.period_kind = 'weekly'
      and ucb.period_start = v_period_start
      and ucb.period_end = v_period_end
    returning * into v_balance;

  insert into public.usage_credit_ledger (
    user_id,
    run_credit_reservation_id,
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
    v_existing.id,
    p_request_id,
    'weekly',
    v_period_start,
    v_period_end,
    'reservation',
    v_reserve,
    jsonb_build_object(
      'shadow_allowed', v_allowed,
      'shadow_reason', v_reason
    )
  );

  return query select v_allowed, v_reason, v_existing.id,
    v_period_start, v_period_end, v_balance.credits_used_raw,
    v_balance.credits_reserved_raw, v_balance.credits_limit_raw;
end;
$$;

revoke all on function public.reserve_analysis_credits(uuid, text, bigint, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_analysis_credits(uuid, text, bigint, timestamptz, timestamptz)
  to service_role;
