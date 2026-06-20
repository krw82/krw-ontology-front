-- Toss Payments auto-billing state.
--
-- Toss issues a billingKey after buyer authentication. Toss does not run the
-- monthly subscription schedule for us, so we store the billing key server-side
-- and charge due subscriptions from our own scheduler.

create table if not exists public.billing_toss_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(customer_key) between 2 and 300),
  check (customer_key ~ '^[A-Za-z0-9_\-=.@]+$'),
  check (customer_key ~ '[-_=.@]')
);

create table if not exists public.billing_toss_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_key text not null check (plan_key in ('standard', 'pro')),
  plan_version_id uuid references public.billing_plan_versions(id),
  amount_krw integer not null check (amount_krw > 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  order_name text not null,
  customer_key text not null,
  status text not null default 'created'
    check (status in ('created', 'auth_succeeded', 'paid', 'failed', 'cancelled', 'expired')),
  success_url text not null,
  fail_url text not null,
  auth_key_received_at timestamptz,
  failure_code text,
  failure_message text,
  provider_response jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_toss_checkout_sessions_user_created
  on public.billing_toss_checkout_sessions (user_id, created_at desc);

create index if not exists idx_billing_toss_checkout_sessions_created_open
  on public.billing_toss_checkout_sessions (expires_at)
  where status = 'created';

create table if not exists public.billing_toss_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_key text not null check (plan_key in ('standard', 'pro')),
  plan_version_id uuid references public.billing_plan_versions(id),
  status text not null default 'active'
    check (status in ('active', 'past_due', 'grace', 'pending_cancel', 'cancelled', 'expired')),
  customer_key text not null,
  billing_key text not null,
  billing_method text not null default 'CARD' check (billing_method in ('CARD', 'TRANSFER')),
  billing_key_issued_at timestamptz,
  card_snapshot jsonb not null default '{}'::jsonb,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  next_billing_at timestamptz not null,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  last_payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create unique index if not exists idx_billing_toss_subscriptions_one_open
  on public.billing_toss_subscriptions (user_id)
  where status in ('active', 'past_due', 'grace', 'pending_cancel');

create index if not exists idx_billing_toss_subscriptions_due
  on public.billing_toss_subscriptions (next_billing_at)
  where status in ('active', 'past_due', 'grace');

create table if not exists public.billing_toss_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.billing_toss_subscriptions(id) on delete set null,
  checkout_session_id uuid references public.billing_toss_checkout_sessions(id) on delete set null,
  plan_key text not null check (plan_key in ('standard', 'pro')),
  plan_version_id uuid references public.billing_plan_versions(id),
  payment_kind text not null check (payment_kind in ('initial', 'renewal', 'upgrade')),
  order_id text not null unique,
  order_name text not null,
  idempotency_key uuid not null unique,
  amount_krw integer not null check (amount_krw > 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'cancelled')),
  provider_payment_key text,
  provider_status text,
  failure_code text,
  failure_message text,
  provider_response jsonb not null default '{}'::jsonb,
  requested_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_billing_toss_payments_checkout_initial
  on public.billing_toss_payments (checkout_session_id)
  where payment_kind = 'initial' and checkout_session_id is not null;

create index if not exists idx_billing_toss_payments_user_created
  on public.billing_toss_payments (user_id, created_at desc);

do $$
begin
  alter table public.billing_toss_subscriptions
    add constraint billing_toss_subscriptions_last_payment_fk
    foreign key (last_payment_id)
    references public.billing_toss_payments(id)
    on delete set null
    not valid;
exception
  when duplicate_object then null;
end $$;

alter table public.billing_toss_subscriptions
  validate constraint billing_toss_subscriptions_last_payment_fk;

drop trigger if exists trg_billing_toss_customers_updated_at
  on public.billing_toss_customers;
create trigger trg_billing_toss_customers_updated_at
  before update on public.billing_toss_customers
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_billing_toss_checkout_sessions_updated_at
  on public.billing_toss_checkout_sessions;
create trigger trg_billing_toss_checkout_sessions_updated_at
  before update on public.billing_toss_checkout_sessions
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_billing_toss_subscriptions_updated_at
  on public.billing_toss_subscriptions;
create trigger trg_billing_toss_subscriptions_updated_at
  before update on public.billing_toss_subscriptions
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_billing_toss_payments_updated_at
  on public.billing_toss_payments;
create trigger trg_billing_toss_payments_updated_at
  before update on public.billing_toss_payments
  for each row
  execute function public.set_updated_at();

alter table public.billing_toss_customers enable row level security;
alter table public.billing_toss_checkout_sessions enable row level security;
alter table public.billing_toss_subscriptions enable row level security;
alter table public.billing_toss_payments enable row level security;

revoke all on public.billing_toss_customers from public, anon, authenticated;
revoke all on public.billing_toss_checkout_sessions from public, anon, authenticated;
revoke all on public.billing_toss_subscriptions from public, anon, authenticated;
revoke all on public.billing_toss_payments from public, anon, authenticated;

grant select, insert, update, delete on public.billing_toss_customers to service_role;
grant select, insert, update, delete on public.billing_toss_checkout_sessions to service_role;
grant select, insert, update, delete on public.billing_toss_subscriptions to service_role;
grant select, insert, update, delete on public.billing_toss_payments to service_role;
