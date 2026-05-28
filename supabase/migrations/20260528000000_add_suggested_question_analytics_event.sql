ALTER TABLE analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;

ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_event_name_check CHECK (
    event_name IN (
      'page_viewed',
      'cta_clicked',
      'home_cta_clicked',
      'signup_started',
      'login_completed',
      'company_selected',
      'question_prefilled',
      'suggested_question_clicked',
      'starter_question_clicked',
      'question_submitted',
      'answer_completed',
      'answer_failed',
      'citation_opened',
      'share_created',
      'session_renamed',
      'session_deleted',
      'attachment_added',
      'attachment_rejected',
      'usage_warning_shown',
      'usage_limit_reached',
      'quota_warning_shown',
      'quota_blocked',
      'upgrade_clicked',
      'subscription_started'
    )
  );
