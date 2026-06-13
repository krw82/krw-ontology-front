-- Durable rate limiting for chat run requests.
-- Production policy enforcement happens through this service-role-only counter,
-- not through the Next proxy.

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key text NOT NULL,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_updated_at
  ON public.rate_limit_counters(updated_at);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limit_counters FROM PUBLIC;
REVOKE ALL ON public.rate_limit_counters FROM anon;
REVOKE ALL ON public.rate_limit_counters FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_counters TO service_role;

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key text,
  p_bucket text,
  p_window_start timestamptz,
  p_window_seconds integer,
  p_limit integer
)
RETURNS TABLE (
  allowed boolean,
  current_count integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_retry_after integer;
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'rate limit key is required';
  END IF;
  IF p_bucket IS NULL OR length(trim(p_bucket)) = 0 THEN
    RAISE EXCEPTION 'rate limit bucket is required';
  END IF;
  IF p_window_seconds < 1 THEN
    RAISE EXCEPTION 'rate limit window must be positive';
  END IF;
  IF p_limit < 1 THEN
    RAISE EXCEPTION 'rate limit must be positive';
  END IF;

  INSERT INTO public.rate_limit_counters (
    key,
    bucket,
    window_start,
    count
  )
  VALUES (
    p_key,
    p_bucket,
    p_window_start,
    1
  )
  ON CONFLICT (key, bucket, window_start)
  DO UPDATE SET
    count = public.rate_limit_counters.count + 1,
    updated_at = now()
  RETURNING count INTO v_count;

  v_retry_after := GREATEST(
    1,
    CEIL(
      EXTRACT(
        epoch FROM (p_window_start + make_interval(secs => p_window_seconds) - now())
      )
    )::integer
  );

  RETURN QUERY SELECT
    v_count <= p_limit,
    v_count,
    CASE WHEN v_count <= p_limit THEN 0 ELSE v_retry_after END;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_rate_limit(text, text, timestamptz, integer, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_rate_limit(text, text, timestamptz, integer, integer)
  FROM anon;
REVOKE ALL ON FUNCTION public.increment_rate_limit(text, text, timestamptz, integer, integer)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(text, text, timestamptz, integer, integer)
  TO service_role;
