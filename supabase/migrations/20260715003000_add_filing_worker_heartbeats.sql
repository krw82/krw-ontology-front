create table if not exists public.filing_notification_worker_heartbeats (
  worker_id text primary key,
  detection_enabled boolean not null,
  push_enabled boolean not null,
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint filing_notification_worker_heartbeats_worker_id_length check (char_length(worker_id) between 1 and 200),
  constraint filing_notification_worker_heartbeats_error_length check (last_error is null or char_length(last_error) <= 2000)
);

drop trigger if exists trg_filing_notification_worker_heartbeats_updated_at on public.filing_notification_worker_heartbeats;
create trigger trg_filing_notification_worker_heartbeats_updated_at
  before update on public.filing_notification_worker_heartbeats
  for each row execute function public.set_updated_at();

alter table public.filing_notification_worker_heartbeats enable row level security;
revoke all on table public.filing_notification_worker_heartbeats from public, anon, authenticated;
grant select, insert, update, delete on table public.filing_notification_worker_heartbeats to service_role;
