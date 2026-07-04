-- CUSIP -> ticker mapping cache and quarter-over-quarter 13F position changes.

create table if not exists public.sec_13f_cusip_mappings (
  cusip text primary key,
  ticker text,
  name text,
  exch_code text,
  figi text,
  composite_figi text,
  share_class_figi text,
  market_sector text,
  security_type text,
  security_type_2 text,
  security_description text,
  provider text not null default 'openfigi',
  provider_status text not null default 'mapped',
  raw_response jsonb,
  mapped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_13f_cusip_mappings_cusip_check
    check (cusip ~ '^[A-Z0-9]{9}$'),
  constraint sec_13f_cusip_mappings_provider_status_check
    check (provider_status in ('mapped', 'not_found', 'error'))
);

create table if not exists public.sec_13f_position_changes (
  id uuid primary key default gen_random_uuid(),
  filing_id uuid not null references public.sec_13f_filings(id) on delete cascade,
  previous_filing_id uuid references public.sec_13f_filings(id) on delete set null,
  cik text not null references public.institutional_managers(cik) on delete cascade,
  report_period date not null,
  previous_report_period date,
  position_key text not null,
  issuer_name text not null,
  title_of_class text,
  cusip text not null,
  ticker text,
  change_type text not null,
  current_value_usd numeric(20, 2) not null default 0,
  previous_value_usd numeric(20, 2),
  value_change_usd numeric(20, 2),
  value_change_pct numeric(20, 8),
  current_weight numeric(20, 10),
  previous_weight numeric(20, 10),
  weight_change numeric(20, 10),
  current_shares numeric(24, 4),
  previous_shares numeric(24, 4),
  shares_change numeric(24, 4),
  shares_change_pct numeric(20, 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_13f_position_changes_change_type_check
    check (change_type in ('new', 'increased', 'decreased', 'unchanged', 'sold')),
  constraint sec_13f_position_changes_unique_position
    unique (filing_id, position_key)
);

create index if not exists idx_sec_13f_cusip_mappings_ticker
  on public.sec_13f_cusip_mappings (ticker);
create index if not exists idx_sec_13f_cusip_mappings_status
  on public.sec_13f_cusip_mappings (provider_status);
create index if not exists idx_sec_13f_position_changes_filing_value
  on public.sec_13f_position_changes (filing_id, current_value_usd desc);
create index if not exists idx_sec_13f_position_changes_cik_period
  on public.sec_13f_position_changes (cik, report_period desc);
create index if not exists idx_sec_13f_position_changes_cusip
  on public.sec_13f_position_changes (cusip);
create index if not exists idx_sec_13f_position_changes_ticker
  on public.sec_13f_position_changes (ticker);
create index if not exists idx_sec_13f_position_changes_change_type
  on public.sec_13f_position_changes (change_type);
create index if not exists idx_sec_13f_position_changes_weight_change
  on public.sec_13f_position_changes (filing_id, weight_change desc);

drop trigger if exists trg_sec_13f_cusip_mappings_updated_at
  on public.sec_13f_cusip_mappings;
create trigger trg_sec_13f_cusip_mappings_updated_at
  before update on public.sec_13f_cusip_mappings
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_sec_13f_position_changes_updated_at
  on public.sec_13f_position_changes;
create trigger trg_sec_13f_position_changes_updated_at
  before update on public.sec_13f_position_changes
  for each row
  execute function public.set_updated_at();

alter table public.sec_13f_cusip_mappings enable row level security;
alter table public.sec_13f_position_changes enable row level security;

drop policy if exists "sec_13f_cusip_mappings_select_authenticated"
  on public.sec_13f_cusip_mappings;
create policy "sec_13f_cusip_mappings_select_authenticated"
  on public.sec_13f_cusip_mappings
  for select to authenticated using (true);

drop policy if exists "sec_13f_position_changes_select_authenticated"
  on public.sec_13f_position_changes;
create policy "sec_13f_position_changes_select_authenticated"
  on public.sec_13f_position_changes
  for select to authenticated using (true);

grant select on table public.sec_13f_cusip_mappings to authenticated;
grant select on table public.sec_13f_position_changes to authenticated;

grant select, insert, update, delete on table public.sec_13f_cusip_mappings
  to service_role;
grant select, insert, update, delete on table public.sec_13f_position_changes
  to service_role;
