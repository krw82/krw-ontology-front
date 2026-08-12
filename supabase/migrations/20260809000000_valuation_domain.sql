-- Valuation domain. PER/PBR/EPS and related multiples are computed here from
-- fundamental inputs + market close, deliberately independent from the ontology
-- release lifecycle. The ontology describes the business; this domain describes
-- what the market is paying for it. Ticker is the join key at the UI layer.

create table if not exists public.market_instruments (
  ticker text primary key,
  cik text,
  company_name text,
  exchange text,
  currency text,
  security_type text not null default 'common_stock',
  share_class text,
  adr_ratio numeric,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_instruments_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'),
  constraint market_instruments_cik_check
    check (cik is null or cik ~ '^[0-9]{10}$'),
  constraint market_instruments_security_type_check
    check (security_type in ('common_stock', 'preferred_stock', 'adr', 'etf', 'other')),
  constraint market_instruments_status_check
    check (status in ('active', 'delisted', 'merged', 'unknown'))
);

create table if not exists public.fundamental_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  cik text,
  available_at timestamptz not null,
  period_end date not null,
  filing_date date,
  form_type text,
  accession_numbers text[] not null default '{}'::text[],
  currency text not null,
  -- Trailing twelve months inputs (as disclosed at available_at)
  diluted_eps_ttm numeric,
  net_income_common_ttm numeric,
  revenue_ttm numeric,
  operating_cash_flow_ttm numeric,
  capital_expenditures_ttm numeric,
  free_cash_flow_ttm numeric,
  -- Point-in-time balance sheet inputs
  common_equity numeric,
  shares_outstanding numeric,
  cash_and_equivalents numeric,
  total_debt numeric,
  input_lineage jsonb not null default '{}'::jsonb,
  quality_flags text[] not null default '{}'::text[],
  normalization_version text,
  provider text not null default 'fmp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fundamental_snapshots_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'),
  constraint fundamental_snapshots_cik_check
    check (cik is null or cik ~ '^[0-9]{10}$'),
  constraint fundamental_snapshots_accession_numbers_check
    check (cardinality(accession_numbers) <= 50),
  constraint fundamental_snapshots_quality_flags_check
    check (cardinality(quality_flags) <= 20),
  constraint fundamental_snapshots_input_lineage_object_check
    check (jsonb_typeof(input_lineage) = 'object'),
  constraint fundamental_snapshots_provider_check
    check (provider in ('fmp', 'sec_companyfacts')),
  constraint fundamental_snapshots_unique_disclosure
    unique (ticker, available_at, period_end, provider)
);

create index if not exists idx_fundamental_snapshots_ticker_available
  on public.fundamental_snapshots (ticker, available_at desc);
create index if not exists idx_fundamental_snapshots_latest
  on public.fundamental_snapshots (ticker, available_at desc)
  where quality_flags = '{}';

create table if not exists public.market_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  session_date date not null,
  price_type text not null default 'regular_close',
  price numeric not null,
  currency text not null,
  provider text not null,
  observed_at timestamptz not null,
  provider_reference text,
  quality_flags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint market_price_snapshots_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'),
  constraint market_price_snapshots_price_type_check
    check (price_type in ('quote', 'regular_close', 'previous_close', 'adjusted_close')),
  constraint market_price_snapshots_price_positive_check
    check (price > 0),
  constraint market_price_snapshots_quality_flags_check
    check (cardinality(quality_flags) <= 20),
  constraint market_price_snapshots_unique_session
    unique (ticker, session_date, price_type, provider)
);

create index if not exists idx_market_price_snapshots_ticker_date
  on public.market_price_snapshots (ticker, session_date desc);

create table if not exists public.valuation_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  session_date date not null,
  reference_price numeric not null,
  currency text not null,
  price_snapshot_id uuid references public.market_price_snapshots(id) on delete set null,
  fundamental_snapshot_id uuid references public.fundamental_snapshots(id) on delete set null,
  -- Inputs captured at computation time (denormalized for screening)
  market_cap numeric,
  enterprise_value numeric,
  eps_ttm_diluted numeric,
  book_value_per_share numeric,
  free_cash_flow_per_share numeric,
  -- Computed multiples (null when not meaningful)
  pe_ttm numeric,
  pb numeric,
  ps_ttm numeric,
  price_to_fcf_ttm numeric,
  earnings_yield numeric,
  fcf_yield numeric,
  metric_statuses jsonb not null default '{}'::jsonb,
  quality_flags text[] not null default '{}'::text[],
  -- Denormalized for display: when the fundamental inputs were disclosed
  fundamental_available_at timestamptz,
  fundamental_period_end date,
  calculation_version text not null,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint valuation_snapshots_ticker_check
    check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'),
  constraint valuation_snapshots_metric_statuses_object_check
    check (jsonb_typeof(metric_statuses) = 'object'),
  constraint valuation_snapshots_quality_flags_check
    check (cardinality(quality_flags) <= 20),
  constraint valuation_snapshots_calculation_version_length
    check (char_length(calculation_version) between 1 and 40),
  constraint valuation_snapshots_unique_session_version
    unique (ticker, session_date, calculation_version)
);

create index if not exists idx_valuation_snapshots_ticker_date
  on public.valuation_snapshots (ticker, session_date desc);
create index if not exists idx_valuation_snapshots_latest
  on public.valuation_snapshots (ticker, session_date desc, computed_at desc);

drop trigger if exists trg_market_instruments_updated_at on public.market_instruments;
create trigger trg_market_instruments_updated_at
  before update on public.market_instruments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_fundamental_snapshots_updated_at on public.fundamental_snapshots;
create trigger trg_fundamental_snapshots_updated_at
  before update on public.fundamental_snapshots
  for each row execute function public.set_updated_at();

alter table public.market_instruments enable row level security;
alter table public.fundamental_snapshots enable row level security;
alter table public.market_price_snapshots enable row level security;
alter table public.valuation_snapshots enable row level security;

revoke all on table public.market_instruments from public, anon, authenticated;
revoke all on table public.fundamental_snapshots from public, anon, authenticated;
revoke all on table public.market_price_snapshots from public, anon, authenticated;
revoke all on table public.valuation_snapshots from public, anon, authenticated;

grant select, insert, update, delete on table public.market_instruments to service_role;
grant select, insert, update, delete on table public.fundamental_snapshots to service_role;
grant select, insert, update, delete on table public.market_price_snapshots to service_role;
grant select, insert, update, delete on table public.valuation_snapshots to service_role;

notify pgrst, 'reload schema';
