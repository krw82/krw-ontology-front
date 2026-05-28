-- Usage and upgrade funnel for free-to-paid pressure.
SELECT
  COUNT(*) FILTER (WHERE event_name = 'usage_warning_shown') AS usage_warnings,
  COUNT(*) FILTER (WHERE event_name = 'usage_limit_reached') AS usage_limits,
  COUNT(*) FILTER (WHERE event_name = 'upgrade_clicked') AS upgrade_clicks,
  COUNT(DISTINCT COALESCE(user_id::text, 'anon:' || anonymous_id)) FILTER (
    WHERE event_name = 'usage_limit_reached'
  ) AS users_limited,
  COUNT(DISTINCT COALESCE(user_id::text, 'anon:' || anonymous_id)) FILTER (
    WHERE event_name = 'upgrade_clicked'
  ) AS users_clicked_upgrade,
  ROUND(
    COUNT(*) FILTER (WHERE event_name = 'upgrade_clicked')::numeric
      / NULLIF(COUNT(*) FILTER (WHERE event_name = 'usage_limit_reached'), 0)
      * 100,
    2
  ) AS limit_to_upgrade_click_rate_pct
FROM analytics_events
WHERE created_at >= NOW() - INTERVAL '30 days';
