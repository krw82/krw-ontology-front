-- Add source metadata for provider pricing snapshots.

alter table public.provider_pricing_policies
  add column if not exists source_url text,
  add column if not exists verified_at timestamptz;

update public.provider_pricing_policies
  set source_url = 'https://api-docs.deepseek.com/quick_start/pricing',
      verified_at = '2026-06-20T00:00:00Z'
  where version = 'deepseek-v4-flash-2026-06'
    and provider = 'deepseek'
    and provider_model = 'deepseek-v4-flash';
