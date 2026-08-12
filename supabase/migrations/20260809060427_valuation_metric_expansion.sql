-- Forward-only compatibility migration for valuation domain tables that may
-- have been created by the initial migration before the v1.1 metric expansion.
-- This migration is intentionally additive and safe to run against both a
-- legacy local database and a fresh database.

alter table if exists public.fundamental_snapshots
  add column if not exists cost_of_revenue_ttm numeric,
  add column if not exists operating_income_ttm numeric,
  add column if not exists income_before_tax_ttm numeric,
  add column if not exists income_tax_expense_ttm numeric,
  add column if not exists total_assets numeric,
  add column if not exists total_current_assets numeric,
  add column if not exists total_current_liabilities numeric,
  add column if not exists accounts_receivable numeric,
  add column if not exists inventory numeric,
  add column if not exists accounts_payable numeric,
  add column if not exists previous_period_end date,
  add column if not exists previous_common_equity numeric,
  add column if not exists previous_total_assets numeric,
  add column if not exists previous_cash_and_equivalents numeric,
  add column if not exists previous_total_debt numeric,
  add column if not exists previous_accounts_receivable numeric,
  add column if not exists previous_inventory numeric,
  add column if not exists previous_accounts_payable numeric;

alter table if exists public.valuation_snapshots
  add column if not exists reference_price numeric,
  add column if not exists currency text,
  add column if not exists roe_ttm numeric,
  add column if not exists roa_ttm numeric,
  add column if not exists roic_ttm numeric,
  add column if not exists current_ratio numeric,
  add column if not exists cash_conversion_cycle_days numeric,
  add column if not exists days_sales_outstanding numeric,
  add column if not exists days_inventory_outstanding numeric,
  add column if not exists days_payables_outstanding numeric,
  add column if not exists metric_inputs jsonb;

-- Legacy deployments created the price type check before quote snapshots were
-- introduced. Keep the quote endpoint usable while retaining all prior types.
alter table public.market_price_snapshots
  drop constraint if exists market_price_snapshots_price_type_check;

alter table public.market_price_snapshots
  add constraint market_price_snapshots_price_type_check
  check (price_type in ('quote', 'regular_close', 'previous_close', 'adjusted_close'));

-- Existing valuation rows must retain their original price/currency source.
-- Fail closed if a legacy row cannot be backfilled rather than inventing a
-- value or silently changing the meaning of an old snapshot.
update public.valuation_snapshots v
set reference_price = p.price,
    currency = p.currency
from public.market_price_snapshots p
where v.price_snapshot_id = p.id
  and (v.reference_price is null or v.currency is null);

update public.valuation_snapshots
set metric_inputs = '{}'::jsonb
where metric_inputs is null;

do $$
begin
  if exists (
    select 1
    from public.valuation_snapshots
    where reference_price is null or currency is null
  ) then
    raise exception
      'valuation_metric_expansion preflight failed: valuation_snapshots has orphaned or null price links';
  end if;
end
$$;

alter table public.valuation_snapshots
  alter column reference_price set not null,
  alter column currency set not null,
  alter column metric_inputs set default '{}'::jsonb,
  alter column metric_inputs set not null;

alter table public.valuation_snapshots
  drop constraint if exists valuation_snapshots_metric_inputs_object_check;

alter table public.valuation_snapshots
  add constraint valuation_snapshots_metric_inputs_object_check
  check (jsonb_typeof(metric_inputs) = 'object');

create index if not exists idx_fundamental_snapshots_ticker_period
  on public.fundamental_snapshots (ticker, period_end desc);

create index if not exists idx_valuation_snapshots_metric_version
  on public.valuation_snapshots (ticker, calculation_version, session_date desc);

-- Preserve the existing service-role-only access policy after altering legacy
-- tables. RLS is enabled even when the table was created by an older schema.
alter table public.fundamental_snapshots enable row level security;
alter table public.valuation_snapshots enable row level security;
revoke all on table public.fundamental_snapshots from public, anon, authenticated;
revoke all on table public.valuation_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.fundamental_snapshots to service_role;
grant select, insert, update, delete on table public.valuation_snapshots to service_role;

notify pgrst, 'reload schema';
