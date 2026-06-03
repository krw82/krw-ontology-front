CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  anonymous_id TEXT,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  path TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_events_event_name_check CHECK (
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
      'share_viewed',
      'share_answer_read',
      'share_cta_clicked',
      'share_starter_loaded',
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
  ),
  CONSTRAINT analytics_events_identity_check CHECK (
    user_id IS NOT NULL OR anonymous_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
  ON analytics_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created_at
  ON analytics_events(event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created_at
  ON analytics_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_anonymous_created_at
  ON analytics_events(anonymous_id, created_at DESC)
  WHERE anonymous_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_session_created_at
  ON analytics_events(session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_ticker_created_at
  ON analytics_events((properties->>'ticker'), created_at DESC)
  WHERE properties ? 'ticker';

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE analytics_events FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE analytics_events TO service_role;
