-- Internal billing scaffold: plans are code-defined; user entitlement and
-- monthly usage are DB-backed so quota enforcement does not depend on a
-- payment provider.

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_key text not null default 'free'
    check (plan_key in ('free', 'pro', 'power', 'beta', 'internal')),
  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  run_id uuid references public.agent_runs(id) on delete set null,
  usage_kind text not null default 'question'
    check (usage_kind in ('question')),
  quantity integer not null default 1 check (quantity > 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (period_end > period_start),
  unique (user_id, request_id, usage_kind)
);

create table if not exists public.usage_period_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  question_count integer not null default 0 check (question_count >= 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start, period_end),
  check (period_end > period_start)
);

create index if not exists idx_usage_events_user_period
  on public.usage_events (user_id, period_start, period_end);

create index if not exists idx_user_entitlements_plan_status
  on public.user_entitlements (plan_key, status);

alter table public.user_entitlements enable row level security;
alter table public.usage_events enable row level security;
alter table public.usage_period_counters enable row level security;

create policy "Users can read own entitlement"
  on public.user_entitlements
  for select
  using (auth.uid() = user_id);

create policy "Users can read own usage events"
  on public.usage_events
  for select
  using (auth.uid() = user_id);

create policy "Users can read own usage counters"
  on public.usage_period_counters
  for select
  using (auth.uid() = user_id);

revoke insert, update, delete on public.user_entitlements from anon, authenticated;
revoke insert, update, delete on public.usage_events from anon, authenticated;
revoke insert, update, delete on public.usage_period_counters from anon, authenticated;

create or replace function public.record_usage_event(
  p_user_id uuid,
  p_request_id text,
  p_run_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cost numeric
)
returns table (
  inserted boolean,
  question_count integer,
  estimated_cost_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  did_insert boolean := false;
  inserted_count integer := 0;
begin
  insert into public.usage_events (
    user_id,
    request_id,
    run_id,
    usage_kind,
    quantity,
    estimated_cost_usd,
    period_start,
    period_end
  )
  values (
    p_user_id,
    p_request_id,
    p_run_id,
    'question',
    1,
    greatest(coalesce(p_cost, 0), 0),
    p_period_start,
    p_period_end
  )
  on conflict (user_id, request_id, usage_kind) do nothing;

  get diagnostics inserted_count = row_count;
  did_insert := inserted_count > 0;

  if did_insert then
    insert into public.usage_period_counters (
      user_id,
      period_start,
      period_end,
      question_count,
      estimated_cost_usd
    )
    values (
      p_user_id,
      p_period_start,
      p_period_end,
      1,
      greatest(coalesce(p_cost, 0), 0)
    )
    on conflict (user_id, period_start, period_end) do update
      set question_count = public.usage_period_counters.question_count + 1,
          estimated_cost_usd = public.usage_period_counters.estimated_cost_usd
            + excluded.estimated_cost_usd,
          updated_at = now();
  end if;

  return query
  select
    did_insert,
    coalesce(c.question_count, 0),
    coalesce(c.estimated_cost_usd, 0)
  from public.usage_period_counters c
  where c.user_id = p_user_id
    and c.period_start = p_period_start
    and c.period_end = p_period_end;

  if not found then
    return query select did_insert, 0, 0::numeric;
  end if;
end;
$$;

grant execute on function public.record_usage_event(
  uuid,
  text,
  uuid,
  timestamptz,
  timestamptz,
  numeric
) to service_role;
