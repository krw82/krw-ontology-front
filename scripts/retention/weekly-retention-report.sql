-- 주간 리텐션 리포트 (매주 월요일 실행)
-- 실행 방법 (Mac에서, 프로젝트 루트):
--   PGPASSWORD=$(grep -oE "postgresql://[^ ]+" .env.mac-worker.production | head -1 | sed -E 's#postgresql://[^:]+:([^@]+)@.*#\1#') \
--   psql "host=aws-1-ap-northeast-2.pooler.supabase.com port=5432 dbname=postgres user=postgres.deaumgysfwfcctzhbaxb sslmode=require" -f scripts/retention/weekly-retention-report.sql
--
-- 기준선 (2026-08-19 측정): 8/14~8/18 가입 10명 전원 D1/D7 = 0% (전 주 코호트 33% 복귀)
-- 목표: 신규 옵트인 >= 40% / 답변완료자 팔로우 전환 >= 50% / D7 >= 15% (팔로우+푸시 코호트 >= 25%)

-- 1) 직전 주 코호트: 가입일 이후 재방문 여부
WITH cohort AS (
  SELECT id, email_confirmed_at::date AS jd
  FROM auth.users
  WHERE email_confirmed_at >= date_trunc('week', current_date) - interval '1 week'
    AND email_confirmed_at < date_trunc('week', current_date)
), act AS (
  SELECT e.user_id,
         COUNT(DISTINCT e.created_at::date) AS active_days,
         EXISTS (
           SELECT 1 FROM analytics_events e2
           WHERE e2.user_id = c.id AND e2.created_at::date > c.jd
         ) AS returned
  FROM cohort c
  JOIN analytics_events e ON e.user_id = c.id
  GROUP BY e.user_id
)
SELECT c.jd AS join_date,
       COUNT(*) AS users,
       COUNT(a.user_id) AS with_activity,
       COUNT(*) FILTER (WHERE a.returned) AS returned_after_join_day,
       round(100.0 * COUNT(*) FILTER (WHERE a.returned) / NULLIF(COUNT(a.user_id), 0), 1) AS return_pct
FROM cohort c
LEFT JOIN act a ON a.user_id = c.id
GROUP BY c.jd
ORDER BY c.jd;

-- 2) 마일스톤 달성 여부별 재방문 (팔로우/푸시 효과 검증)
WITH cohort AS (
  SELECT id, email_confirmed_at::date AS jd
  FROM auth.users
  WHERE email_confirmed_at >= current_date - interval '14 days'
), m AS (
  SELECT user_id,
         bool_or(milestone = 'first_company_followed') AS followed,
         bool_or(milestone = 'push_enabled') AS pushed,
         bool_or(milestone = 'first_answer_completed') AS answered
  FROM user_retention_milestones
  GROUP BY user_id
), ret AS (
  SELECT DISTINCT e.user_id
  FROM analytics_events e
  JOIN cohort c ON c.id = e.user_id
  WHERE e.created_at::date > c.jd
)
SELECT COALESCE(m.answered, false) AS answered,
       COALESCE(m.followed, false) AS followed,
       COALESCE(m.pushed, false) AS pushed,
       COUNT(DISTINCT c.id) AS users,
       COUNT(DISTINCT r.user_id) AS returned_users,
       round(100.0 * COUNT(DISTINCT r.user_id) / NULLIF(COUNT(DISTINCT c.id), 0), 1) AS return_pct
FROM cohort c
LEFT JOIN m ON m.user_id = c.id
LEFT JOIN ret r ON r.user_id = c.id
GROUP BY 1, 2, 3
ORDER BY users DESC;

-- 3) 퍼널 카운터 (현재 누적)
SELECT
  (SELECT COUNT(*) FROM auth.users) AS total_users,
  (SELECT COUNT(*) FROM push_subscriptions WHERE status = 'active') AS active_push_subs,
  (SELECT COUNT(DISTINCT user_id) FROM push_subscriptions WHERE status = 'active') AS push_users,
  (SELECT COUNT(*) FROM user_filing_subscriptions) AS filing_subs,
  (SELECT COUNT(*) FROM user_retention_milestones) AS milestones;

-- 4) 다이제스트/푸시 영수증 (직근 7일)
SELECT receipt_type, COUNT(*) AS n
FROM filing_push_receipts
WHERE created_at >= current_date - interval '7 days'
GROUP BY receipt_type;
