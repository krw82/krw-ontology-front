-- Coverage is a current user choice, not a lifecycle bucket. Keep only the
-- two active levels and represent an unchecked company with NULL.

drop trigger if exists trg_reconcile_coverage_on_entitlement_change
  on public.user_entitlements;
drop trigger if exists trg_reconcile_coverage_on_entitlement_delete
  on public.user_entitlements;

drop function if exists public.sweep_expired_company_coverage_limits(timestamptz, integer);
drop function if exists public.reconcile_coverage_on_entitlement_change();
drop function if exists public.set_user_company_coverage_status(uuid, text, text, text, text, integer, text, text[], integer);
drop function if exists public.reconcile_user_company_coverage_limit(uuid, integer, text);

alter table public.user_company_marks
  rename column coverage_status to coverage_level;

alter table public.user_company_marks
  add column if not exists coverage_cleared_at timestamptz,
  alter column coverage_level drop not null,
  alter column coverage_level drop default,
  drop constraint if exists user_company_marks_coverage_status_check,
  drop constraint if exists user_company_marks_coverage_level_check;

update public.user_company_marks
set coverage_level = case coverage_level
  when 'holding' then 'holding'
  when 'watching' then 'interest'
  when 'exploring' then 'interest'
  else null
end,
coverage_cleared_at = case when coverage_level = 'closed' then now() else null end;

alter table public.user_company_marks
  add constraint user_company_marks_coverage_level_check
    check (coverage_level is null or coverage_level in ('interest', 'holding'));

drop index if exists public.idx_user_company_marks_user_coverage;
create index idx_user_company_marks_user_coverage_level
  on public.user_company_marks (user_id, coverage_level, updated_at desc)
  where coverage_level is not null;

alter table public.user_company_coverage_events
  rename column previous_status to previous_coverage_level;
alter table public.user_company_coverage_events
  rename column coverage_status to coverage_level;

alter table public.user_company_coverage_events
  add column if not exists event_type text not null default 'legacy',
  alter column coverage_level drop not null,
  drop constraint if exists user_company_coverage_events_previous_status_check,
  drop constraint if exists user_company_coverage_events_status_check,
  drop constraint if exists user_company_coverage_events_previous_coverage_level_check,
  drop constraint if exists user_company_coverage_events_coverage_level_check,
  drop constraint if exists user_company_coverage_events_event_type_check;

update public.user_company_coverage_events
set previous_coverage_level = case previous_coverage_level
  when 'holding' then 'holding'
  when 'watching' then 'interest'
  when 'exploring' then 'interest'
  else null
end,
coverage_level = case coverage_level
  when 'holding' then 'holding'
  when 'watching' then 'interest'
  when 'exploring' then 'interest'
  else null
end;

update public.user_company_coverage_events
set event_type = case
  when coverage_level is null then 'cleared'
  when previous_coverage_level is null then 'selected'
  when previous_coverage_level is distinct from coverage_level then 'level_changed'
  else 'unchanged'
end;

alter table public.user_company_coverage_events
  add constraint user_company_coverage_events_previous_coverage_level_check
    check (previous_coverage_level is null or previous_coverage_level in ('interest', 'holding')),
  add constraint user_company_coverage_events_coverage_level_check
    check (coverage_level is null or coverage_level in ('interest', 'holding')),
  add constraint user_company_coverage_events_event_type_check
    check (event_type in ('selected', 'level_changed', 'cleared', 'unchanged', 'plan_reconciliation', 'legacy'));

create or replace function public.reconcile_user_company_coverage_limit(
  p_user_id uuid,
  p_active_limit integer,
  p_preferred_ticker text default null
)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preferred_ticker text := upper(trim(coalesce(p_preferred_ticker, '')));
  v_mark public.user_company_marks%rowtype;
  v_previous_coverage_level text;
  v_event_id uuid;
  v_cleared_tickers text[] := '{}'::text[];
begin
  if p_user_id is null or p_active_limit is null or p_active_limit < 0 then
    raise exception 'invalid coverage reconciliation' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 734251));

  for v_mark in
    select mark.*
    from public.user_company_marks mark
    where mark.user_id = p_user_id and mark.coverage_level is not null
    order by
      case when mark.ticker = v_preferred_ticker then 0 else 1 end,
      case mark.coverage_level when 'holding' then 0 else 1 end,
      mark.priority desc,
      coalesce(mark.last_activity_at, mark.updated_at) desc,
      mark.ticker
    offset p_active_limit
  loop
    v_previous_coverage_level := v_mark.coverage_level;
    update public.user_company_marks mark
    set coverage_level = null, coverage_cleared_at = now(), last_activity_at = now(), updated_at = now()
    where mark.user_id = p_user_id and mark.ticker = v_mark.ticker
    returning * into v_mark;

    update public.user_company_monitoring_rules rule
    set enabled = false, updated_at = now()
    where rule.user_id = p_user_id and rule.ticker = v_mark.ticker and rule.enabled;

    v_event_id := gen_random_uuid();
    insert into public.user_company_coverage_events (
      id, user_id, ticker, previous_coverage_level, coverage_level, event_type,
      changed, source, idempotency_key, request_payload, response_payload
    ) values (
      v_event_id, p_user_id, v_mark.ticker, v_previous_coverage_level, null, 'plan_reconciliation',
      true, 'plan_reconciliation', 'plan-reconcile:' || v_event_id::text,
      jsonb_build_object('ticker', v_mark.ticker, 'coverage_level', null, 'source', 'plan_reconciliation', 'active_limit', p_active_limit),
      jsonb_build_object('mark', to_jsonb(v_mark), 'event_id', v_event_id, 'previous_coverage_level', v_previous_coverage_level, 'coverage_level', null, 'changed', true, 'idempotent_replay', false, 'reconciled', true)
    );
    v_cleared_tickers := array_append(v_cleared_tickers, v_mark.ticker);
  end loop;
  return v_cleared_tickers;
end;
$$;

create or replace function public.reconcile_coverage_on_entitlement_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if tg_op = 'DELETE'
    or new.plan_key = 'free'
    or new.status not in ('active', 'grace')
    or (new.status = 'active' and new.current_period_end <= now())
    or (new.status = 'grace' and (new.grace_until is null or new.grace_until <= now())) then
    perform public.reconcile_user_company_coverage_limit(v_user_id, 3, null);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_reconcile_coverage_on_entitlement_change
  after insert or update of plan_key, status, current_period_end, grace_until
  on public.user_entitlements
  for each row execute function public.reconcile_coverage_on_entitlement_change();
create trigger trg_reconcile_coverage_on_entitlement_delete
  after delete on public.user_entitlements
  for each row execute function public.reconcile_coverage_on_entitlement_change();

create or replace function public.sweep_expired_company_coverage_limits(
  p_now timestamptz default now(),
  p_limit integer default 250
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user record;
  v_cleared text[];
  v_reconciled_users integer := 0;
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid coverage expiry sweep' using errcode = '22023';
  end if;
  for v_user in
    select entitlement.user_id
    from public.user_entitlements entitlement
    where (entitlement.plan_key = 'free' or entitlement.status not in ('active', 'grace')
      or (entitlement.status = 'active' and entitlement.current_period_end <= p_now)
      or (entitlement.status = 'grace' and (entitlement.grace_until is null or entitlement.grace_until <= p_now)))
      and (select count(*) from public.user_company_marks mark where mark.user_id = entitlement.user_id and mark.coverage_level is not null) > 3
    order by entitlement.user_id
    limit p_limit
  loop
    v_cleared := public.reconcile_user_company_coverage_limit(v_user.user_id, 3, null);
    if cardinality(v_cleared) > 0 then v_reconciled_users := v_reconciled_users + 1; end if;
  end loop;
  return v_reconciled_users;
end;
$$;

create or replace function public.set_user_company_coverage_level(
  p_user_id uuid,
  p_ticker text,
  p_coverage_level text,
  p_idempotency_key text,
  p_source text default 'api',
  p_priority integer default null,
  p_interest_reason text default null,
  p_tags text[] default null,
  p_active_limit integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticker text := upper(trim(coalesce(p_ticker, '')));
  v_coverage_level text := nullif(lower(trim(coalesce(p_coverage_level, ''))), '');
  v_key text := trim(coalesce(p_idempotency_key, ''));
  v_source text := trim(coalesce(p_source, 'api'));
  v_previous_coverage_level text;
  v_active_count integer;
  v_event public.user_company_coverage_events%rowtype;
  v_event_id uuid;
  v_mark public.user_company_marks%rowtype;
  v_request_payload jsonb;
  v_event_type text;
begin
  if p_user_id is null then raise exception 'p_user_id is required' using errcode = '22023'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_ticker) not between 1 and 16 then raise exception 'invalid ticker' using errcode = '22023'; end if;
  if v_coverage_level is not null and v_coverage_level not in ('interest', 'holding') then raise exception 'invalid coverage level' using errcode = '22023'; end if;
  if char_length(v_key) not between 8 and 200 then raise exception 'invalid idempotency key' using errcode = '22023'; end if;
  if char_length(v_source) not between 1 and 80 then raise exception 'invalid source' using errcode = '22023'; end if;
  if p_active_limit is not null and p_active_limit < 0 then raise exception 'invalid active limit' using errcode = '22023'; end if;

  v_request_payload := jsonb_build_object('ticker', v_ticker, 'coverage_level', v_coverage_level, 'source', v_source, 'priority', p_priority, 'interest_reason', p_interest_reason, 'tags', to_jsonb(p_tags));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 734251));

  select event.* into v_event from public.user_company_coverage_events event
  where event.user_id = p_user_id and event.idempotency_key = v_key;
  if found then
    if v_event.request_payload <> v_request_payload then raise exception 'idempotency_key_conflict' using errcode = '22023'; end if;
    select mark.* into strict v_mark from public.user_company_marks mark where mark.user_id = p_user_id and mark.ticker = v_ticker;
    return jsonb_set(v_event.response_payload, '{mark}', to_jsonb(v_mark), true);
  end if;

  select mark.coverage_level into v_previous_coverage_level
  from public.user_company_marks mark where mark.user_id = p_user_id and mark.ticker = v_ticker for update;

  if v_coverage_level is not null and v_previous_coverage_level is null and p_active_limit is not null then
    select count(*) into v_active_count from public.user_company_marks mark
    where mark.user_id = p_user_id and mark.coverage_level is not null;
    if v_active_count >= p_active_limit then raise exception 'coverage_limit_reached' using errcode = 'P0001'; end if;
  end if;

  insert into public.user_company_marks as mark (
    user_id, ticker, coverage_level, coverage_cleared_at, priority, interest_reason, tags, last_activity_at, updated_at
  ) values (
    p_user_id, v_ticker, v_coverage_level, case when v_coverage_level is null then now() else null end,
    coalesce(p_priority, 0), p_interest_reason, coalesce(p_tags, '{}'::text[]), now(), now()
  ) on conflict (user_id, ticker) do update set
    coverage_level = excluded.coverage_level,
    coverage_cleared_at = case when excluded.coverage_level is null then now() else null end,
    priority = coalesce(p_priority, mark.priority),
    interest_reason = case when p_interest_reason is null then mark.interest_reason else p_interest_reason end,
    tags = coalesce(p_tags, mark.tags), last_activity_at = now(), updated_at = now();

  select mark.* into strict v_mark from public.user_company_marks mark where mark.user_id = p_user_id and mark.ticker = v_ticker;

  if v_coverage_level is null then
    update public.user_company_monitoring_rules rule set enabled = false, updated_at = now()
    where rule.user_id = p_user_id and rule.ticker = v_ticker and rule.enabled;
  end if;

  v_event_type := case
    when v_coverage_level is null then 'cleared'
    when v_previous_coverage_level is null then 'selected'
    when v_previous_coverage_level is distinct from v_coverage_level then 'level_changed'
    else 'unchanged'
  end;
  v_event_id := gen_random_uuid();
  insert into public.user_company_coverage_events (
    id, user_id, ticker, previous_coverage_level, coverage_level, event_type,
    changed, source, idempotency_key, request_payload, response_payload
  ) values (
    v_event_id, p_user_id, v_ticker, v_previous_coverage_level, v_coverage_level, v_event_type,
    v_previous_coverage_level is distinct from v_coverage_level, v_source, v_key, v_request_payload,
    jsonb_build_object('mark', to_jsonb(v_mark), 'event_id', v_event_id, 'previous_coverage_level', v_previous_coverage_level, 'coverage_level', v_coverage_level, 'changed', v_previous_coverage_level is distinct from v_coverage_level, 'idempotent_replay', false)
  ) returning * into v_event;
  return v_event.response_payload;
end;
$$;

create or replace function public.try_record_coverage_activation(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coverage_count integer;
  v_judgment_count integer;
  v_monitoring_rule_count integer;
  v_completed_loop_count integer;
  v_row_count integer := 0;
  v_inserted boolean := false;
begin
  if p_user_id is null then raise exception 'p_user_id is required' using errcode = '22023'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'forbidden' using errcode = '42501'; end if;

  select count(*) into v_coverage_count from public.user_company_marks mark
  where mark.user_id = p_user_id and mark.coverage_level is not null;
  select count(distinct judgment.id) into v_judgment_count
  from public.user_filing_judgments judgment
  join public.sec_filing_events event on event.id = judgment.filing_event_id
  join public.ontology_catalog_releases release on release.env = event.env and release.active
  join public.ontology_companies company on company.env = release.env and company.release_id = release.release_id and company.sec_cik = event.cik
  join public.user_company_marks mark on mark.user_id = judgment.user_id and mark.ticker = company.ticker and mark.coverage_level is not null
  where judgment.user_id = p_user_id and judgment.current_revision_id is not null;
  select count(distinct rule.id) into v_monitoring_rule_count
  from public.user_company_monitoring_rules rule
  join public.ontology_catalog_releases release on release.active
  join public.ontology_companies rule_company on rule_company.env = release.env and rule_company.release_id = release.release_id and rule_company.ticker = rule.ticker
  join public.ontology_companies covered_company on covered_company.env = rule_company.env and covered_company.release_id = rule_company.release_id and covered_company.sec_cik = rule_company.sec_cik
  join public.user_company_marks mark on mark.user_id = rule.user_id and mark.ticker = covered_company.ticker and mark.coverage_level is not null
  where rule.user_id = p_user_id and rule.enabled;
  select count(distinct judgment.id) into v_completed_loop_count
  from public.user_filing_judgments judgment
  join public.sec_filing_events event on event.id = judgment.filing_event_id
  join public.ontology_catalog_releases release on release.env = event.env and release.active
  join public.ontology_companies company on company.env = release.env and company.release_id = release.release_id and company.sec_cik = event.cik
  join public.user_company_marks mark on mark.user_id = judgment.user_id and mark.ticker = company.ticker and mark.coverage_level is not null
  join public.user_filing_source_opens source_open on source_open.user_id = judgment.user_id and source_open.filing_event_id = judgment.filing_event_id
  join public.user_filing_judgment_monitoring_rules judgment_rule on judgment_rule.user_id = judgment.user_id and judgment_rule.revision_id = judgment.current_revision_id
  join public.user_company_monitoring_rules rule on rule.id = judgment_rule.rule_id and rule.user_id = judgment.user_id and rule.ticker = judgment.ticker and rule.enabled
  where judgment.user_id = p_user_id and judgment.current_revision_id is not null;

  if v_coverage_count < 3 or v_judgment_count < 1 or v_monitoring_rule_count < 1 or v_completed_loop_count < 1 then return false; end if;
  insert into public.user_retention_milestones (user_id, milestone, metadata)
  values (p_user_id, 'coverage_activated', jsonb_build_object('coverage_count', v_coverage_count, 'judgment_count', v_judgment_count, 'monitoring_rule_count', v_monitoring_rule_count, 'completed_loop_count', v_completed_loop_count))
  on conflict (user_id, milestone) do nothing;
  get diagnostics v_row_count = row_count;
  v_inserted := v_row_count = 1;
  if v_inserted then
    insert into public.analytics_events (user_id, event_name, properties)
    values (p_user_id, 'coverage_activated', jsonb_build_object('source', 'system', 'source_type', 'coverage', 'status', 'completed', 'coverage_count', v_coverage_count, 'judgment_count', v_judgment_count, 'monitoring_rule_count', v_monitoring_rule_count, 'completed_loop_count', v_completed_loop_count));
  end if;
  return v_inserted;
end;
$$;

revoke all on function public.set_user_company_coverage_level(uuid, text, text, text, text, integer, text, text[], integer) from public, anon, authenticated;
grant execute on function public.set_user_company_coverage_level(uuid, text, text, text, text, integer, text, text[], integer) to service_role;
revoke all on function public.reconcile_user_company_coverage_limit(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.reconcile_user_company_coverage_limit(uuid, integer, text) to service_role;
revoke all on function public.try_record_coverage_activation(uuid) from public, anon, authenticated;
grant execute on function public.try_record_coverage_activation(uuid) to service_role;

-- Analytics accepts only the new coverage vocabulary as well. Historical
-- coverage selections are normalized before the old enum check is replaced.
update public.analytics_events
set event_name = case event_name
  when 'coverage_added' then 'coverage_level_changed'
  when 'coverage_status_changed' then 'coverage_level_changed'
  else event_name
end
where event_name in ('coverage_added', 'coverage_status_changed');

alter table public.analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (
    event_name in (
      'page_viewed', 'cta_clicked', 'home_cta_clicked', 'signup_started',
      'login_completed', 'company_selected', 'question_prefilled',
      'suggested_question_clicked', 'starter_question_clicked',
      'question_submitted', 'answer_completed', 'answer_failed',
      'citation_opened', 'share_created', 'share_viewed', 'share_answer_read',
      'share_cta_clicked', 'share_starter_loaded', 'session_renamed',
      'session_deleted', 'attachment_added', 'attachment_rejected',
      'usage_warning_shown', 'usage_limit_reached', 'quota_warning_shown',
      'quota_blocked', 'upgrade_clicked', 'subscription_started',
      'company_followed', 'push_permission_requested', 'push_permission_prompted',
      'push_permission_granted', 'push_permission_denied', 'push_subscribed',
      'push_unsubscribed', 'filing_notification_clicked',
      'filing_subscription_created', 'filing_subscription_removed',
      'filing_history_loaded', 'filing_detail_viewed',
      'push_notification_clicked', 'key_exhibit_opened', 'sec_source_opened',
      'filing_analysis_started', 'filing_history_backfilled',
      'historical_filing_opened', 'pwa_install_prompt_seen', 'pwa_installed',
      'test_push_requested', 'test_push_received', 'filing_detected',
      'filing_notification_created', 'push_provider_accepted',
      'sw_push_received', 'notification_show_called', 'notification_clicked',
      'filings_inbox_viewed', 'filing_marked_read', 'filing_snoozed',
      'filing_pinned', 'filing_archived', 'digest_opened',
      'alert_rule_created', 'alert_rule_removed',
      'filing_delivery_mode_changed', 'amendment_comparison_opened',
      'company_filing_timeline_viewed', 'pulse_viewed',
      'pulse_item_impression', 'pulse_item_opened', 'pulse_item_actioned',
      'pulse_filter_changed', 'pulse_preferences_updated',
      'pulse_new_items_seen', 'pulse_end_reached', 'pulse_feedback_submitted',
      'pulse_source_degraded', 'pulse_answer_prefilled', 'pulse_summary_actioned',
      'performance_metric_reported', 'coverage_level_changed',
      'coverage_cleared', 'coverage_activated',
      'filing_judgment_started', 'filing_judgment_completed',
      'filing_judgment_revised', 'thesis_updated',
      'monitoring_rule_created', 'decision_session_closed',
      'second_opportunity_resolved'
    )
  );
