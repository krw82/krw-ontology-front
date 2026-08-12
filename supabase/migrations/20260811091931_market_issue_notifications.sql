-- A notification is an owned inbox item, not a filing-only record.  Keep the
-- existing table and delivery queue so browser push, receipts, and retention
-- continue to use one auditable path for both SEC filings and verified market
-- issues.  Exactly one source reference is required on every row.

alter table public.filing_notification_preferences
  add column if not exists notify_market_news boolean not null default true;

alter table public.user_filing_notifications
  alter column filing_event_id drop not null,
  add column if not exists market_issue_id uuid references public.market_issues(id) on delete cascade,
  add column if not exists ticker text;

alter table public.user_filing_notifications
  drop constraint if exists user_filing_notifications_kind_check,
  add constraint user_filing_notifications_kind_check
    check (kind in (
      'filing_received',
      'analysis_ready',
      'filing_digest',
      'market_issue_received',
      'market_issue_digest'
    )),
  drop constraint if exists user_filing_notifications_source_check,
  add constraint user_filing_notifications_source_check
    check ((filing_event_id is not null) <> (market_issue_id is not null)),
  drop constraint if exists user_filing_notifications_ticker_check,
  add constraint user_filing_notifications_ticker_check
    check (ticker is null or (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'));

alter table public.user_filing_notifications
  drop constraint if exists user_filing_notifications_unique_event_kind_bucket,
  add constraint user_filing_notifications_unique_filing_kind_bucket
    unique (user_id, filing_event_id, kind, digest_bucket),
  add constraint user_filing_notifications_unique_market_issue_kind_bucket
    unique (user_id, market_issue_id, kind, digest_bucket);

create index if not exists idx_user_filing_notifications_market_issue
  on public.user_filing_notifications (market_issue_id)
  where market_issue_id is not null;

create index if not exists idx_user_filing_notifications_user_market_issue
  on public.user_filing_notifications (user_id, ticker, created_at desc)
  where market_issue_id is not null and archived_at is null;
