-- Retention controls for the CIK-first filing product. These records keep only
-- filing metadata, user state, and short rule-match context; no SEC document
-- body is persisted.

alter table public.sec_filing_events
  add column if not exists alert_priority text not null default 'digest';

alter table public.sec_filing_events
  drop constraint if exists sec_filing_events_alert_priority_check,
  add constraint sec_filing_events_alert_priority_check
    check (alert_priority in ('urgent', 'normal', 'digest'));

update public.sec_filing_events
set alert_priority = case
  when primary_event_tag in (
    'cybersecurity_incident',
    'bankruptcy_or_receivership',
    'listing_or_delisting',
    'financial_statement_nonreliance'
  ) then 'urgent'
  when primary_event_tag in (
    'earnings_or_financial_results',
    'leadership_or_board_change',
    'acquisition_or_disposition',
    'debt_or_obligation',
    'important_contract',
    'contract_termination',
    'unregistered_securities_sale'
  ) then 'normal'
  when primary_event_tag = 'other_material_event'
    and sec_items @> array['8.01']::text[] then 'normal'
  else 'digest'
end
where alert_priority = 'digest';

alter table public.user_filing_subscriptions
  add column if not exists alert_preset text not null default 'important',
  add column if not exists delivery_mode text not null default 'inherit';

alter table public.user_filing_subscriptions
  drop constraint if exists user_filing_subscriptions_alert_preset_check,
  add constraint user_filing_subscriptions_alert_preset_check
    check (alert_preset in ('important', 'all')),
  drop constraint if exists user_filing_subscriptions_delivery_mode_check,
  add constraint user_filing_subscriptions_delivery_mode_check
    check (delivery_mode in ('inherit', 'important_immediate', 'all_immediate', 'daily_digest'));

alter table public.filing_notification_preferences
  add column if not exists delivery_mode text not null default 'important_immediate',
  add column if not exists daily_digest_at time not null default '08:30',
  add column if not exists last_digest_at timestamptz;

alter table public.filing_notification_preferences
  drop constraint if exists filing_notification_preferences_delivery_mode_check,
  add constraint filing_notification_preferences_delivery_mode_check
    check (delivery_mode in ('important_immediate', 'all_immediate', 'daily_digest'));

alter table public.user_filing_notifications
  add column if not exists pinned_at timestamptz,
  add column if not exists snoozed_until timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists digest_bucket date not null default date '0001-01-01',
  add column if not exists updated_at timestamptz not null default now();

alter table public.user_filing_notifications
  drop constraint if exists user_filing_notifications_kind_check,
  add constraint user_filing_notifications_kind_check
    check (kind in ('filing_received', 'analysis_ready', 'filing_digest')),
  drop constraint if exists user_filing_notifications_snooze_check,
  add constraint user_filing_notifications_snooze_check
    check (snoozed_until is null or archived_at is null);

alter table public.user_filing_notifications
  drop constraint if exists user_filing_notifications_unique_event_kind,
  add constraint user_filing_notifications_unique_event_kind_bucket
    unique (user_id, filing_event_id, kind, digest_bucket);

create index if not exists idx_user_filing_notifications_active
  on public.user_filing_notifications (user_id, pinned_at desc nulls last, created_at desc)
  where archived_at is null;

create index if not exists idx_user_filing_notifications_snoozed
  on public.user_filing_notifications (user_id, snoozed_until)
  where snoozed_until is not null and archived_at is null;

drop trigger if exists trg_user_filing_notifications_updated_at on public.user_filing_notifications;
create trigger trg_user_filing_notifications_updated_at
  before update on public.user_filing_notifications
  for each row execute function public.set_updated_at();

create table if not exists public.user_filing_keyword_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text,
  phrase text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_filing_keyword_rules_ticker_check
    check (ticker is null or (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$')),
  constraint user_filing_keyword_rules_phrase_check
    check (char_length(trim(phrase)) between 2 and 120),
  constraint user_filing_keyword_rules_unique_phrase
    unique (user_id, ticker, phrase)
);

create index if not exists idx_user_filing_keyword_rules_active
  on public.user_filing_keyword_rules (user_id, ticker)
  where enabled;

create unique index if not exists idx_user_filing_keyword_rules_unique_global_phrase
  on public.user_filing_keyword_rules (user_id, phrase)
  where ticker is null;

create table if not exists public.filing_keyword_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  rule_id uuid not null references public.user_filing_keyword_rules(id) on delete cascade,
  document_name text,
  matched_context text not null,
  created_at timestamptz not null default now(),
  constraint filing_keyword_matches_context_length check (char_length(matched_context) between 1 and 600),
  constraint filing_keyword_matches_unique_rule_event unique (rule_id, filing_event_id)
);

create index if not exists idx_filing_keyword_matches_user_event
  on public.filing_keyword_matches (user_id, filing_event_id, created_at desc);

create table if not exists public.filing_push_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid references public.user_filing_notifications(id) on delete cascade,
  receipt_key text not null,
  receipt_type text not null,
  created_at timestamptz not null default now(),
  constraint filing_push_receipts_key_length check (char_length(receipt_key) between 1 and 160),
  constraint filing_push_receipts_type_check
    check (receipt_type in ('sw_push_received', 'notification_show_called', 'notification_clicked', 'test_push_received')),
  constraint filing_push_receipts_unique_event unique (user_id, receipt_key, receipt_type)
);

create index if not exists idx_filing_push_receipts_user_created
  on public.filing_push_receipts (user_id, created_at desc);

create table if not exists public.user_filing_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_filing_feed_tokens_hash_length check (char_length(token_hash) = 64)
);

create unique index if not exists idx_user_filing_feed_tokens_active_user
  on public.user_filing_feed_tokens (user_id)
  where revoked_at is null;

drop trigger if exists trg_user_filing_keyword_rules_updated_at on public.user_filing_keyword_rules;
create trigger trg_user_filing_keyword_rules_updated_at
  before update on public.user_filing_keyword_rules
  for each row execute function public.set_updated_at();

alter table public.user_filing_keyword_rules enable row level security;
alter table public.filing_keyword_matches enable row level security;
alter table public.filing_push_receipts enable row level security;
alter table public.user_filing_feed_tokens enable row level security;

revoke all on table public.user_filing_keyword_rules from public, anon, authenticated;
revoke all on table public.filing_keyword_matches from public, anon, authenticated;
revoke all on table public.filing_push_receipts from public, anon, authenticated;
revoke all on table public.user_filing_feed_tokens from public, anon, authenticated;

grant select, insert, update, delete on table public.user_filing_keyword_rules to service_role;
grant select, insert, update, delete on table public.filing_keyword_matches to service_role;
grant select, insert, update, delete on table public.filing_push_receipts to service_role;
grant select, insert, update, delete on table public.user_filing_feed_tokens to service_role;

create or replace function public.cleanup_filing_notification_retention()
returns table (deliveries_deleted bigint, notifications_deleted bigint, filing_events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_deliveries bigint := 0;
  deleted_notifications bigint := 0;
  deleted_events bigint := 0;
begin
  delete from public.filing_notification_deliveries
  where created_at < now() - interval '30 days'
    and status in ('sent', 'failed');
  get diagnostics deleted_deliveries = row_count;

  delete from public.user_filing_notifications
  where created_at < now() - interval '90 days';
  get diagnostics deleted_notifications = row_count;

  delete from public.sec_filing_events event
  where event.first_seen_at < now() - interval '180 days'
    and not exists (
      select 1 from public.user_filing_notifications notification
      where notification.filing_event_id = event.id
    );
  get diagnostics deleted_events = row_count;

  return query select deleted_deliveries, deleted_notifications, deleted_events;
end;
$$;

revoke all on function public.cleanup_filing_notification_retention() from public, anon, authenticated;
grant execute on function public.cleanup_filing_notification_retention() to service_role;
