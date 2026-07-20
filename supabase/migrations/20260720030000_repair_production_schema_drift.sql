-- Repair databases whose migration history advanced while one or more schema
-- objects remained on the pre-coverage-level definition. Keep this migration
-- idempotent: it must also be safe for a clean database that has applied the
-- preceding migrations in order.

-- The browse endpoint reads only these projection columns. Recreate the
-- projection trigger and backfill existing catalog rows so the web process
-- never needs to deserialize the large catalog payload for a company card.
alter table public.ontology_companies
  add column if not exists browse_core_strength text,
  add column if not exists browse_critical_risk text;

create or replace function public.set_ontology_company_browse_projection()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.browse_core_strength := coalesce(
    nullif(array_to_string(array(
      select value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.company_json -> 'primary_business_activities') = 'array'
            then new.company_json -> 'primary_business_activities'
          else '[]'::jsonb
        end
      )
    ), ', '), ''),
    nullif(array_to_string(array(
      select value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.coverage_json -> 'core_strengths') = 'array'
            then new.coverage_json -> 'core_strengths'
          else '[]'::jsonb
        end
      )
    ), ', '), '')
  );
  new.browse_critical_risk := coalesce(
    nullif(array_to_string(array(
      select value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.company_json -> 'key_external_factors') = 'array'
            then new.company_json -> 'key_external_factors'
          else '[]'::jsonb
        end
      )
    ), ', '), ''),
    nullif(array_to_string(array(
      select value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.coverage_json -> 'critical_risks') = 'array'
            then new.coverage_json -> 'critical_risks'
          else '[]'::jsonb
        end
      )
    ), ', '), '')
  );
  return new;
end;
$$;

drop trigger if exists trg_ontology_company_browse_projection on public.ontology_companies;
create trigger trg_ontology_company_browse_projection
  before insert or update of company_json, coverage_json
  on public.ontology_companies
  for each row
  execute function public.set_ontology_company_browse_projection();

update public.ontology_companies
set company_json = company_json;

-- `20260720010000_simplify_company_coverage_levels` renamed the mark column,
-- but the filing-judgment RPC was originally defined in an earlier migration.
-- Preserve its complete, audited definition and change only the stale guard.
do $repair$
declare
  v_function_oid regprocedure := 'public.save_user_filing_judgment_revision(uuid,uuid,text,text,text,text,text,jsonb,jsonb,text,integer)'::regprocedure;
  v_definition text;
  v_legacy_guard constant text := 'mark.coverage_status in (''exploring'', ''watching'', ''holding'')';
  v_current_guard constant text := 'mark.coverage_level is not null';
begin
  select pg_get_functiondef(v_function_oid) into v_definition;
  if position(v_legacy_guard in v_definition) > 0 then
    execute replace(v_definition, v_legacy_guard, v_current_guard);
  elsif position(v_current_guard in v_definition) = 0 then
    raise exception 'save_user_filing_judgment_revision has an unexpected coverage guard';
  end if;
end;
$repair$;

revoke all on function public.save_user_filing_judgment_revision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, integer)
  from public, anon, authenticated;
grant execute on function public.save_user_filing_judgment_revision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, integer)
  to service_role;

-- Keep the database allow-list aligned with the application event union. A
-- stale constraint made harmless client performance reports fail and also
-- caused close_user_decision_session to return 500 after its authoritative
-- row was inserted.
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
