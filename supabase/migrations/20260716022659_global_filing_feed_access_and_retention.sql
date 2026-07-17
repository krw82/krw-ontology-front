-- Global catalog filing feed access, user-state continuity, and retention,
-- phase E. The Pulse read path is service-role only; no new public SEC table
-- access is granted to browser clients.

alter table public.user_filing_subscriptions
  add column if not exists env text not null default 'prod',
  add column if not exists catalog_collection_status text not null default 'dormant';

alter table public.user_filing_subscriptions
  drop constraint if exists user_filing_subscriptions_env_check,
  add constraint user_filing_subscriptions_env_check
    check (env in ('dev', 'staging', 'prod')),
  drop constraint if exists user_filing_subscriptions_catalog_collection_status_check,
  add constraint user_filing_subscriptions_catalog_collection_status_check
    check (catalog_collection_status in ('active', 'dormant'));

create index if not exists idx_user_filing_subscriptions_catalog_collection
  on public.user_filing_subscriptions (env, cik, user_id)
  where enabled and catalog_collection_status = 'active';

alter table public.filing_notification_preferences
  add column if not exists notify_form4 boolean not null default true,
  add column if not exists insider_notification_mode text not null default 'reported_p_s';

alter table public.filing_notification_preferences
  drop constraint if exists filing_notification_preferences_insider_notification_mode_check,
  add constraint filing_notification_preferences_insider_notification_mode_check
    check (insider_notification_mode in ('none', 'reported_p_s', 'all'));

-- Existing subscriptions remain visible even if a new catalog does not cover
-- their CIK. They become dormant collection targets rather than being deleted
-- or silently unsubscribed.
create or replace function public.sync_catalog_filing_subscription_status(p_env text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_count integer := 0;
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;

  update public.user_filing_subscriptions subscription
  set catalog_collection_status = case
        when exists (
          select 1
          from public.get_active_catalog_sec_targets(v_env) target
          where target.cik = subscription.cik
        ) then 'active'
        else 'dormant'
      end,
      updated_at = now()
  where subscription.env = v_env
    and subscription.catalog_collection_status is distinct from case
      when exists (
        select 1
        from public.get_active_catalog_sec_targets(v_env) target
        where target.cik = subscription.cik
      ) then 'active'
      else 'dormant'
    end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Individual legacy notification state was keyed by notification UUID. The
-- global source uses a durable filing-event UUID. Copying state before the
-- source cutover preserves read/save/snooze/dismiss decisions for each user.
insert into public.user_pulse_item_states (
  user_id,
  item_key,
  source_type,
  source_id,
  kind,
  first_seen_at,
  last_seen_at,
  view_count,
  read_at,
  reviewed_at,
  saved_at,
  snoozed_until,
  dismissed_at,
  last_impression_at,
  last_impression_session_id,
  impression_count,
  feedback,
  created_at,
  updated_at
)
select
  notification.user_id,
  'filing:' || notification.filing_event_id::text,
  'filing',
  notification.filing_event_id::text,
  'filing',
  notification.created_at,
  notification.updated_at,
  case when notification.read_at is null then 0 else 1 end,
  notification.read_at,
  notification.read_at,
  notification.pinned_at,
  notification.snoozed_until,
  notification.archived_at,
  null,
  null,
  0,
  null,
  notification.created_at,
  notification.updated_at
from public.user_filing_notifications notification
on conflict (user_id, item_key) do update
set first_seen_at = least(
      coalesce(public.user_pulse_item_states.first_seen_at, excluded.first_seen_at),
      coalesce(excluded.first_seen_at, public.user_pulse_item_states.first_seen_at)
    ),
    last_seen_at = greatest(
      coalesce(public.user_pulse_item_states.last_seen_at, excluded.last_seen_at),
      coalesce(excluded.last_seen_at, public.user_pulse_item_states.last_seen_at)
    ),
    read_at = coalesce(public.user_pulse_item_states.read_at, excluded.read_at),
    reviewed_at = coalesce(public.user_pulse_item_states.reviewed_at, excluded.reviewed_at),
    saved_at = coalesce(public.user_pulse_item_states.saved_at, excluded.saved_at),
    snoozed_until = greatest(
      public.user_pulse_item_states.snoozed_until,
      excluded.snoozed_until
    ),
    dismissed_at = coalesce(public.user_pulse_item_states.dismissed_at, excluded.dismissed_at),
    updated_at = greatest(public.user_pulse_item_states.updated_at, excluded.updated_at);

-- Source-level keyset query. p_limit only bounds one database round trip; the
-- caller can continue with the returned (occurred_at, filing_event_id) pair,
-- so this is not a global candidate cap.
create or replace function public.get_catalog_global_filing_feed(
  p_env text,
  p_snapshot_at timestamptz,
  p_before_occurred_at timestamptz default null,
  p_before_filing_event_id uuid default null,
  p_limit integer default 60
)
returns table (
  filing_event_id uuid,
  ticker text,
  covered_tickers text[],
  cik text,
  accession_number text,
  form_type text,
  is_amendment boolean,
  filing_date date,
  report_date date,
  accepted_at timestamptz,
  first_seen_at timestamptz,
  occurred_at timestamptz,
  feed_available_at timestamptz,
  feed_expires_at timestamptz,
  feed_lane smallint,
  feed_priority_rank smallint,
  alert_priority text,
  primary_event_tag text,
  sec_items text[],
  event_tags text[],
  filing_detail_url text,
  primary_document_url text,
  source_metadata jsonb,
  processing_status text,
  form4_reported_purchase_value numeric,
  form4_reported_sale_value numeric,
  form4_tenb5_one_status text,
  form4_has_reported_open_market_trade boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 60), 200));
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;
  if (p_before_occurred_at is null) <> (p_before_filing_event_id is null) then
    raise exception 'filing feed cursor requires both boundary fields';
  end if;

  return query
  with active_catalog_companies as (
    select
      company.sec_cik,
      array_agg(company.ticker order by company.ticker) as covered_tickers
    from public.ontology_catalog_releases release
    join public.ontology_companies company
      on company.env = release.env
     and company.release_id = release.release_id
    where release.env = v_env
      and release.active
      and company.sec_cik is not null
    group by company.sec_cik
  )
  select
    event.id,
    event.ticker,
    active_catalog_companies.covered_tickers,
    event.cik,
    event.accession_number,
    event.form_type,
    event.is_amendment,
    event.filing_date,
    event.report_date,
    event.accepted_at,
    event.first_seen_at,
    event.occurred_at,
    event.feed_available_at,
    event.feed_expires_at,
    event.feed_lane,
    event.feed_priority_rank,
    event.alert_priority,
    event.primary_event_tag,
    event.sec_items,
    event.event_tags,
    event.filing_detail_url,
    event.primary_document_url,
    event.source_metadata,
    event.processing_status,
    summary.reported_purchase_value,
    summary.reported_sale_value,
    summary.tenb5_one_status,
    summary.has_reported_open_market_trade
  from public.sec_filing_events event
  join active_catalog_companies
    on active_catalog_companies.sec_cik = event.cik
  left join public.sec_form4_event_summaries summary
    on summary.filing_event_id = event.id
  where event.env = v_env
    and event.feed_eligible
    and event.processing_status = 'ready'
    and event.feed_available_at <= v_snapshot_at
    and (event.feed_expires_at is null or event.feed_expires_at > v_snapshot_at)
    and (
      p_before_occurred_at is null
      or (event.occurred_at, event.id) < (p_before_occurred_at, p_before_filing_event_id)
    )
  order by event.occurred_at desc, event.id desc
  limit v_limit;
end;
$$;

create or replace function public.complete_sec_filing_notification_fanout(
  p_job_id uuid,
  p_claim_token uuid,
  p_progress_json jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.sec_filing_processing_jobs job
  set status = 'completed',
      completed_at = now(),
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      progress_json = coalesce(p_progress_json, '{}'::jsonb),
      last_error = null,
      updated_at = now()
  where job.id = p_job_id
    and job.stage = 'notification_fanout'
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > now();
  return found;
end;
$$;

-- Global events remain queryable through their feed window. Events with no
-- personal notification are not prematurely deleted while they are still a
-- valid catalog feed candidate or have retryable work.
create or replace function public.cleanup_filing_notification_retention()
returns table (deliveries_deleted bigint, notifications_deleted bigint, filing_events_deleted bigint)
language plpgsql
security definer
set search_path = public, pg_temp
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
  where event.occurred_at < now() - interval '180 days'
    and coalesce(event.feed_expires_at, event.occurred_at) < now() - interval '30 days'
    and not exists (
      select 1 from public.user_filing_notifications notification
      where notification.filing_event_id = event.id
    )
    and not exists (
      select 1 from public.sec_filing_processing_jobs job
      where job.filing_event_id = event.id
        and job.status in ('queued', 'claimed', 'retry')
    );
  get diagnostics deleted_events = row_count;

  return query select deleted_deliveries, deleted_notifications, deleted_events;
end;
$$;

revoke all on function public.sync_catalog_filing_subscription_status(text) from public, anon, authenticated;
revoke all on function public.get_catalog_global_filing_feed(text, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_sec_filing_notification_fanout(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cleanup_filing_notification_retention() from public, anon, authenticated;

grant execute on function public.sync_catalog_filing_subscription_status(text) to service_role;
grant execute on function public.get_catalog_global_filing_feed(text, timestamptz, timestamptz, uuid, integer) to service_role;
grant execute on function public.complete_sec_filing_notification_fanout(uuid, uuid, jsonb) to service_role;
grant execute on function public.cleanup_filing_notification_retention() to service_role;

notify pgrst, 'reload schema';
