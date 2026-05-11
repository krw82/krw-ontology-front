-- Atomic usage increment function.
-- Eliminates the SELECT-then-UPDATE race condition in quota recording.
CREATE OR REPLACE FUNCTION increment_usage_daily(
  p_user_id UUID,
  p_date DATE,
  p_cost DOUBLE PRECISION
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO usage_daily (user_id, date, question_count, estimated_cost_usd)
  VALUES (p_user_id, p_date, 1, p_cost)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    question_count = usage_daily.question_count + 1,
    estimated_cost_usd = usage_daily.estimated_cost_usd + EXCLUDED.estimated_cost_usd;
$$;
