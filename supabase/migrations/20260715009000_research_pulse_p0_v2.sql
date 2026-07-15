-- Research Pulse P0 v2 is additive: legacy read/checkup rows remain valid
-- during the one-release API compatibility window.

alter table public.user_pulse_item_states
  add column if not exists reviewed_at timestamptz,
  add column if not exists last_impression_session_id uuid;

update public.user_pulse_item_states
set reviewed_at = read_at
where reviewed_at is null
  and read_at is not null;

create index if not exists idx_user_pulse_item_states_p0_v2_active
  on public.user_pulse_item_states (
    user_id,
    reviewed_at,
    dismissed_at,
    snoozed_until,
    updated_at desc
  );

create or replace function public.record_pulse_item_impression(
  p_user_id uuid,
  p_item_key text,
  p_source_type text,
  p_source_id text,
  p_kind text,
  p_feed_session_id uuid,
  p_seen_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_pulse_item_states (
    user_id,
    item_key,
    source_type,
    source_id,
    kind,
    first_seen_at,
    last_seen_at,
    last_impression_at,
    last_impression_session_id,
    impression_count
  ) values (
    p_user_id,
    p_item_key,
    p_source_type,
    p_source_id,
    p_kind,
    p_seen_at,
    p_seen_at,
    p_seen_at,
    p_feed_session_id,
    1
  )
  on conflict (user_id, item_key) do update
  set
    last_seen_at = excluded.last_seen_at,
    last_impression_at = excluded.last_impression_at,
    last_impression_session_id = excluded.last_impression_session_id,
    impression_count = public.user_pulse_item_states.impression_count + 1
  where public.user_pulse_item_states.last_impression_session_id is distinct from p_feed_session_id;
end;
$$;

revoke all on function public.record_pulse_item_impression(uuid, text, text, text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_pulse_item_impression(uuid, text, text, text, text, uuid, timestamptz)
  to service_role;

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
      'sw_push_received', 'notification_show_called', 'filings_inbox_viewed',
      'notification_clicked', 'filing_marked_read', 'filing_snoozed',
      'filing_pinned', 'filing_archived', 'digest_opened',
      'alert_rule_created', 'alert_rule_removed',
      'filing_delivery_mode_changed', 'amendment_comparison_opened',
      'company_filing_timeline_viewed', 'pulse_viewed',
      'pulse_item_impression', 'pulse_item_opened', 'pulse_item_actioned',
      'pulse_filter_changed', 'pulse_preferences_updated',
      'pulse_new_items_seen', 'pulse_end_reached', 'pulse_feedback_submitted',
      'pulse_source_degraded', 'pulse_answer_prefilled', 'pulse_summary_actioned'
    )
  );
