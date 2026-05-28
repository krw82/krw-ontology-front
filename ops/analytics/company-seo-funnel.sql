-- Company SEO funnel: company page visit -> chat entry -> question -> answer.
-- Run in Supabase SQL editor. Adjust the interval as needed.
WITH events AS (
  SELECT
    COALESCE(user_id::text, 'anon:' || anonymous_id) AS actor_id,
    event_name,
    created_at,
    properties,
    properties->>'ticker' AS ticker
  FROM analytics_events
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND (
      event_name IN (
        'page_viewed',
        'cta_clicked',
        'suggested_question_clicked',
        'question_submitted',
        'answer_completed',
        'answer_failed'
      )
    )
),
company_page_views AS (
  SELECT ticker, COUNT(*) AS page_views, COUNT(DISTINCT actor_id) AS visitors
  FROM events
  WHERE event_name = 'page_viewed'
    AND properties->>'page_type' = 'company_detail'
    AND ticker IS NOT NULL
  GROUP BY ticker
),
company_ctas AS (
  SELECT ticker, COUNT(*) AS chat_starts, COUNT(DISTINCT actor_id) AS chat_start_visitors
  FROM events
  WHERE (
      event_name = 'cta_clicked'
      AND properties->>'cta_id' IN (
        'company_start_analysis',
        'company_hero_suggested_question',
        'company_card'
      )
    )
    OR event_name = 'suggested_question_clicked'
  GROUP BY ticker
),
company_questions AS (
  SELECT ticker, COUNT(*) AS questions, COUNT(DISTINCT actor_id) AS question_users
  FROM events
  WHERE event_name = 'question_submitted'
    AND ticker IS NOT NULL
  GROUP BY ticker
),
company_answers AS (
  SELECT
    ticker,
    COUNT(*) FILTER (WHERE event_name = 'answer_completed') AS answers_completed,
    COUNT(*) FILTER (WHERE event_name = 'answer_failed') AS answers_failed
  FROM events
  WHERE event_name IN ('answer_completed', 'answer_failed')
    AND ticker IS NOT NULL
  GROUP BY ticker
)
SELECT
  pv.ticker,
  pv.page_views,
  pv.visitors,
  COALESCE(cta.chat_starts, 0) AS chat_starts,
  ROUND(COALESCE(cta.chat_starts, 0)::numeric / NULLIF(pv.page_views, 0) * 100, 2)
    AS page_to_chat_start_rate_pct,
  COALESCE(q.questions, 0) AS questions,
  ROUND(COALESCE(q.questions, 0)::numeric / NULLIF(cta.chat_starts, 0) * 100, 2)
    AS chat_start_to_question_rate_pct,
  COALESCE(a.answers_completed, 0) AS answers_completed,
  COALESCE(a.answers_failed, 0) AS answers_failed,
  ROUND(
    COALESCE(a.answers_completed, 0)::numeric / NULLIF(q.questions, 0) * 100,
    2
  ) AS question_to_answer_success_rate_pct
FROM company_page_views pv
LEFT JOIN company_ctas cta ON cta.ticker = pv.ticker
LEFT JOIN company_questions q ON q.ticker = pv.ticker
LEFT JOIN company_answers a ON a.ticker = pv.ticker
ORDER BY pv.page_views DESC, pv.ticker;
