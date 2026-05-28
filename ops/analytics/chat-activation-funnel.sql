-- Chat activation funnel: chat page -> question submitted -> answer outcome.
WITH events AS (
  SELECT
    COALESCE(user_id::text, 'anon:' || anonymous_id) AS actor_id,
    event_name,
    created_at,
    properties
  FROM analytics_events
  WHERE created_at >= NOW() - INTERVAL '30 days'
)
SELECT
  COUNT(*) FILTER (
    WHERE event_name = 'page_viewed'
      AND properties->>'page_type' IN ('chat_new', 'chat_session')
  ) AS chat_page_views,
  COUNT(DISTINCT actor_id) FILTER (
    WHERE event_name = 'page_viewed'
      AND properties->>'page_type' IN ('chat_new', 'chat_session')
  ) AS chat_visitors,
  COUNT(*) FILTER (WHERE event_name = 'question_prefilled') AS prefilled_questions,
  COUNT(*) FILTER (WHERE event_name = 'question_submitted') AS submitted_questions,
  COUNT(*) FILTER (WHERE event_name = 'answer_completed') AS completed_answers,
  COUNT(*) FILTER (WHERE event_name = 'answer_failed') AS failed_answers,
  ROUND(
    COUNT(*) FILTER (WHERE event_name = 'question_submitted')::numeric
      / NULLIF(
        COUNT(*) FILTER (
          WHERE event_name = 'page_viewed'
            AND properties->>'page_type' IN ('chat_new', 'chat_session')
        ),
        0
      ) * 100,
    2
  ) AS chat_view_to_question_rate_pct,
  ROUND(
    COUNT(*) FILTER (WHERE event_name = 'answer_completed')::numeric
      / NULLIF(COUNT(*) FILTER (WHERE event_name = 'question_submitted'), 0)
      * 100,
    2
  ) AS question_to_answer_success_rate_pct;
