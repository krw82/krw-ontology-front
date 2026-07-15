-- SEC 8-K/6-K filing notifications. The filing event is deliberately kept
-- independent from delivery so a later automatic analysis pipeline can attach
-- analysis state and emit an `analysis_ready` notification without changing
-- subscriptions or push delivery records.

create table if not exists public.sec_company_identifiers (
  ticker text primary key,
  cik text unique,
  company_name text,
  lookup_status text not null default 'pending',
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_company_identifiers_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'),
  constraint sec_company_identifiers_cik_check
    check (cik is null or cik ~ '^[0-9]{10}$'),
  constraint sec_company_identifiers_lookup_status_check
    check (lookup_status in ('pending', 'resolved', 'not_found', 'failed')),
  constraint sec_company_identifiers_resolved_check
    check ((lookup_status = 'resolved') = (cik is not null))
);

create table if not exists public.sec_filing_events (
  id uuid primary key default gen_random_uuid(),
  ticker text not null references public.sec_company_identifiers(ticker) on delete restrict,
  cik text not null,
  accession_number text not null unique,
  form_type text not null,
  is_amendment boolean not null default false,
  filing_date date not null,
  report_date date,
  accepted_at timestamptz,
  primary_document_name text,
  filing_detail_url text not null,
  primary_document_url text,
  source_metadata jsonb not null default '{}'::jsonb,
  -- Reserved for the later 8-K/6-K automatic analysis pipeline. This release
  -- never moves this beyond not_requested.
  analysis_status text not null default 'not_requested',
  analysis_requested_at timestamptz,
  analysis_completed_at timestamptz,
  analysis_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_filing_events_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'),
  constraint sec_filing_events_cik_check check (cik ~ '^[0-9]{10}$'),
  constraint sec_filing_events_form_type_check
    check (form_type in ('8-K', '8-K/A', '6-K', '6-K/A')),
  constraint sec_filing_events_analysis_status_check
    check (analysis_status in ('not_requested', 'queued', 'processing', 'ready', 'failed')),
  constraint sec_filing_events_analysis_error_length
    check (analysis_error is null or char_length(analysis_error) <= 2000)
);

create index if not exists idx_sec_filing_events_ticker_filing_date
  on public.sec_filing_events (ticker, filing_date desc, created_at desc);
create index if not exists idx_sec_filing_events_analysis_status
  on public.sec_filing_events (analysis_status, created_at)
  where analysis_status <> 'not_requested';

create table if not exists public.filing_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  notify_8k boolean not null default true,
  notify_6k boolean not null default true,
  include_amendments boolean not null default false,
  timezone text not null default 'Asia/Seoul',
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint filing_notification_preferences_timezone_length
    check (char_length(timezone) between 1 and 80)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  vapid_key_id text not null default 'v1',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint push_subscriptions_status_check
    check (status in ('active', 'revoked')),
  constraint push_subscriptions_endpoint_length
    check (char_length(endpoint) between 1 and 4096),
  constraint push_subscriptions_p256dh_length
    check (char_length(p256dh) between 1 and 1024),
  constraint push_subscriptions_auth_length
    check (char_length(auth) between 1 and 1024),
  constraint push_subscriptions_vapid_key_id_length
    check (char_length(vapid_key_id) between 1 and 80)
);

create index if not exists idx_push_subscriptions_active_user
  on public.push_subscriptions (user_id, last_seen_at desc)
  where status = 'active';

create table if not exists public.user_filing_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  kind text not null default 'filing_received',
  title text not null,
  body text not null,
  destination_path text not null,
  read_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_filing_notifications_kind_check
    check (kind in ('filing_received', 'analysis_ready')),
  constraint user_filing_notifications_title_length
    check (char_length(title) between 1 and 160),
  constraint user_filing_notifications_body_length
    check (char_length(body) between 1 and 500),
  constraint user_filing_notifications_destination_path_check
    check (destination_path like '/%' and destination_path not like '//%'),
  constraint user_filing_notifications_unique_event_kind
    unique (user_id, filing_event_id, kind)
);

create index if not exists idx_user_filing_notifications_user_created
  on public.user_filing_notifications (user_id, created_at desc);
create index if not exists idx_user_filing_notifications_user_unread
  on public.user_filing_notifications (user_id, created_at desc)
  where read_at is null;

create table if not exists public.filing_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.user_filing_notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  worker_id text,
  claim_token uuid,
  lease_expires_at timestamptz,
  provider_status integer,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint filing_notification_deliveries_status_check
    check (status in ('pending', 'claimed', 'sent', 'retry', 'failed')),
  constraint filing_notification_deliveries_attempts_check
    check (attempts >= 0),
  constraint filing_notification_deliveries_last_error_length
    check (last_error is null or char_length(last_error) <= 2000),
  constraint filing_notification_deliveries_unique_notification_subscription
    unique (notification_id, subscription_id)
);

create index if not exists idx_filing_notification_deliveries_due
  on public.filing_notification_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'retry');
create index if not exists idx_filing_notification_deliveries_lease
  on public.filing_notification_deliveries (lease_expires_at)
  where status = 'claimed';

drop trigger if exists trg_sec_company_identifiers_updated_at on public.sec_company_identifiers;
create trigger trg_sec_company_identifiers_updated_at
  before update on public.sec_company_identifiers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sec_filing_events_updated_at on public.sec_filing_events;
create trigger trg_sec_filing_events_updated_at
  before update on public.sec_filing_events
  for each row execute function public.set_updated_at();

drop trigger if exists trg_filing_notification_preferences_updated_at on public.filing_notification_preferences;
create trigger trg_filing_notification_preferences_updated_at
  before update on public.filing_notification_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists trg_filing_notification_deliveries_updated_at on public.filing_notification_deliveries;
create trigger trg_filing_notification_deliveries_updated_at
  before update on public.filing_notification_deliveries
  for each row execute function public.set_updated_at();

create or replace function public.claim_filing_notification_deliveries(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns table (id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or char_length(trim(p_worker_id)) = 0 then
    raise exception 'p_worker_id is required';
  end if;

  return query
  with candidates as (
    select delivery.id
    from public.filing_notification_deliveries delivery
    where (
      (delivery.status in ('pending', 'retry') and delivery.next_attempt_at <= now())
      or (delivery.status = 'claimed' and delivery.lease_expires_at <= now())
    )
    order by delivery.next_attempt_at asc, delivery.created_at asc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  ), claimed as (
    update public.filing_notification_deliveries delivery
    set status = 'claimed',
        worker_id = p_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.id, delivery.claim_token
  )
  select claimed.id, claimed.claim_token from claimed;
end;
$$;

revoke all on function public.claim_filing_notification_deliveries(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_filing_notification_deliveries(text, integer, integer) to service_role;

alter table public.sec_company_identifiers enable row level security;
alter table public.sec_filing_events enable row level security;
alter table public.filing_notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.user_filing_notifications enable row level security;
alter table public.filing_notification_deliveries enable row level security;

revoke all on table public.sec_company_identifiers from public, anon, authenticated;
revoke all on table public.sec_filing_events from public, anon, authenticated;
revoke all on table public.push_subscriptions from public, anon, authenticated;
revoke all on table public.filing_notification_deliveries from public, anon, authenticated;
revoke all on table public.filing_notification_preferences from public, anon, authenticated;
revoke all on table public.user_filing_notifications from public, anon, authenticated;

grant select, insert, update, delete on table public.sec_company_identifiers to service_role;
grant select, insert, update, delete on table public.sec_filing_events to service_role;
grant select, insert, update, delete on table public.filing_notification_preferences to service_role;
grant select, insert, update, delete on table public.push_subscriptions to service_role;
grant select, insert, update, delete on table public.user_filing_notifications to service_role;
grant select, insert, update, delete on table public.filing_notification_deliveries to service_role;

grant select, insert, update on table public.filing_notification_preferences to authenticated;
grant select, update on table public.user_filing_notifications to authenticated;

create policy "filing_notification_preferences_own" on public.filing_notification_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_filing_notifications_select_own" on public.user_filing_notifications
  for select to authenticated using (user_id = auth.uid());
create policy "user_filing_notifications_update_own" on public.user_filing_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
