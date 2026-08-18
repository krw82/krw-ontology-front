-- Seed the GLM-5.3 provider pricing policy required by the production
-- deep-healthz agent_v1_pricing gate (the glm production registry moved
-- every entry to glm-5.3 on 2026-08-17).
--
-- GLM-5.3 has no published per-token API rate yet: Z.AI exposes it through
-- the flat-rate Coding Plan (https://docs.z.ai/guides/overview/pricing),
-- which is exactly how this deployment consumes it. Record the truthful
-- marginal per-token operator cost of zero so credit settlement charges
-- nothing for GLM runs. When Z.AI publishes official per-token rates,
-- insert a new versioned row with the priced values and let this one lapse
-- (effective_to) or keep the zero-cost row if the plan remains the access
-- path.
insert into public.provider_pricing_policies (
  version,
  provider,
  provider_model,
  provider_model_version,
  input_cache_hit_cost_per_million,
  input_cache_miss_cost_per_million,
  output_cost_per_million,
  effective_from,
  effective_to,
  source_url,
  verified_at
) values (
  'glm-5.3-coding-plan-2026-08',
  'glm',
  'glm-5.3',
  'GLM-5.3',
  0,
  0,
  0,
  now(),
  null,
  'https://docs.z.ai/guides/overview/pricing',
  now()
) on conflict (version) do nothing;
