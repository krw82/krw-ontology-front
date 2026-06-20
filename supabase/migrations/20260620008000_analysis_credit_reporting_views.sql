-- Operator-facing reporting views for token, credit, and provider-cost
-- analysis during the shadow rollout.

create or replace view public.analysis_credit_run_costs as
select
  r.id as reservation_id,
  r.user_id,
  r.request_id,
  r.run_id,
  r.status,
  r.terminal_status,
  r.plan_key_snapshot,
  r.plan_version_id,
  r.credit_policy_version,
  r.pricing_version,
  r.provider,
  r.provider_model,
  r.provider_model_version,
  r.credit_period_start,
  r.credit_period_end,
  r.input_tokens,
  r.output_tokens,
  r.prompt_cache_hit_tokens,
  r.prompt_cache_miss_tokens,
  r.reserved_credits_raw,
  r.settled_credits_raw,
  (r.reserved_credits_raw::numeric / 1000) as reserved_credits_display,
  (r.settled_credits_raw::numeric / 1000) as settled_credits_display,
  r.actual_provider_cost_usd,
  case
    when r.input_tokens + r.output_tokens > 0 then
      r.actual_provider_cost_usd / (r.input_tokens + r.output_tokens)
    else null
  end as provider_cost_usd_per_token,
  r.metadata,
  r.created_at,
  r.settled_at
from public.run_credit_reservations r;

create or replace view public.analysis_credit_weekly_usage_summary as
select
  b.user_id,
  b.period_kind,
  b.period_start,
  b.period_end,
  b.plan_key_snapshot,
  b.plan_version_id,
  b.credit_policy_version,
  b.credits_limit_raw,
  b.credits_used_raw,
  b.credits_reserved_raw,
  b.credits_released_raw,
  (b.credits_limit_raw::numeric / 1000) as credits_limit_display,
  (b.credits_used_raw::numeric / 1000) as credits_used_display,
  (b.credits_reserved_raw::numeric / 1000) as credits_reserved_display,
  (greatest(b.credits_limit_raw - b.credits_used_raw - b.credits_reserved_raw, 0)::numeric / 1000) as credits_remaining_display,
  b.actual_provider_cost_usd,
  b.run_count,
  case
    when b.run_count > 0 then b.credits_used_raw::numeric / b.run_count
    else null
  end as avg_credits_raw_per_run,
  case
    when b.run_count > 0 then (b.credits_used_raw::numeric / 1000) / b.run_count
    else null
  end as avg_credits_display_per_run,
  case
    when b.run_count > 0 then b.actual_provider_cost_usd / b.run_count
    else null
  end as avg_provider_cost_usd_per_run,
  b.updated_at
from public.usage_credit_balances b;

revoke all on public.analysis_credit_run_costs from public, anon, authenticated;
revoke all on public.analysis_credit_weekly_usage_summary from public, anon, authenticated;
grant select on public.analysis_credit_run_costs to service_role;
grant select on public.analysis_credit_weekly_usage_summary to service_role;
