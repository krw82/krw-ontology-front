-- A new row is created only for accounts registered after this migration.
-- That makes the first-use flow safe to roll out without redirecting existing
-- researchers who already have a working workspace habit.

create table if not exists public.user_onboarding_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding_version smallint not null default 2,
  status text not null default 'not_started',
  started_at timestamptz,
  first_company_selected_at timestamptz,
  first_question_started_at timestamptz,
  first_evidence_opened_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_onboarding_states_version_check check (onboarding_version = 2),
  constraint user_onboarding_states_status_check
    check (status in ('not_started', 'in_progress', 'completed', 'skipped'))
);

create index if not exists idx_user_onboarding_states_status_created
  on public.user_onboarding_states (status, created_at desc);

drop trigger if exists trg_user_onboarding_states_updated_at on public.user_onboarding_states;
create trigger trg_user_onboarding_states_updated_at
  before update on public.user_onboarding_states
  for each row execute function public.set_updated_at();

create or replace function public.create_start_onboarding_state_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_onboarding_states (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_start_onboarding_state_for_new_user() from public;

drop trigger if exists trg_create_start_onboarding_state_for_new_user on auth.users;
create trigger trg_create_start_onboarding_state_for_new_user
  after insert on auth.users
  for each row execute function public.create_start_onboarding_state_for_new_user();

alter table public.user_onboarding_states enable row level security;
revoke all on table public.user_onboarding_states from anon, authenticated;
grant select, insert, update, delete on table public.user_onboarding_states to service_role;

notify pgrst, 'reload schema';

-- Keep the server-owned analytics allow-list aligned with the v2 onboarding
-- lifecycle. Prompt text is intentionally never written to analytics.
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
      'pulse_summary_actioned', 'pulse_filter_changed', 'pulse_preferences_updated',
      'pulse_new_items_seen', 'pulse_end_reached', 'pulse_feedback_submitted',
      'pulse_source_degraded', 'pulse_answer_prefilled',
      'performance_metric_reported', 'coverage_level_changed',
      'coverage_cleared', 'coverage_activated',
      'filing_judgment_started', 'filing_judgment_completed',
      'filing_judgment_revised', 'thesis_updated',
      'monitoring_rule_created', 'decision_session_closed',
      'second_opportunity_resolved',
      'onboarding_started', 'onboarding_company_selected',
      'onboarding_question_started', 'onboarding_evidence_opened',
      'onboarding_skipped'
    )
  );
