-- SEC EDGAR Form 13F snapshots for institutional manager holdings.

create table if not exists public.institutional_managers (
  cik text primary key,
  name text not null,
  display_name text,
  country_code text,
  notes text,
  latest_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint institutional_managers_cik_check check (cik ~ '^[0-9]{10}$'),
  constraint institutional_managers_country_code_check
    check (country_code is null or country_code ~ '^[A-Z]{2}$')
);

create table if not exists public.sec_13f_filings (
  id uuid primary key default gen_random_uuid(),
  cik text not null references public.institutional_managers(cik) on delete cascade,
  accession_number text not null unique,
  form text not null,
  report_period date not null,
  filing_date date not null,
  accepted_at timestamptz,
  filing_detail_url text not null,
  primary_document_url text,
  information_table_url text not null,
  entry_count integer not null default 0,
  total_value_usd numeric(20, 2) not null default 0,
  source text not null default 'sec_edgar',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_13f_filings_form_check check (form in ('13F-HR', '13F-HR/A')),
  constraint sec_13f_filings_entry_count_check check (entry_count >= 0),
  constraint sec_13f_filings_total_value_check check (total_value_usd >= 0)
);

create table if not exists public.sec_13f_holdings (
  id uuid primary key default gen_random_uuid(),
  filing_id uuid not null references public.sec_13f_filings(id) on delete cascade,
  cik text not null references public.institutional_managers(cik) on delete cascade,
  report_period date not null,
  position_key text not null,
  issuer_name text not null,
  title_of_class text not null,
  cusip text not null,
  ticker text,
  value_usd numeric(20, 2) not null default 0,
  shares numeric(24, 4),
  share_type text,
  put_call text,
  investment_discretion text,
  other_manager text,
  voting_authority_sole numeric(24, 4),
  voting_authority_shared numeric(24, 4),
  voting_authority_none numeric(24, 4),
  created_at timestamptz not null default now(),
  constraint sec_13f_holdings_value_check check (value_usd >= 0),
  constraint sec_13f_holdings_unique_position unique (filing_id, position_key)
);

create index if not exists idx_institutional_managers_updated
  on public.institutional_managers (latest_refresh_at desc);
create index if not exists idx_sec_13f_filings_cik_period
  on public.sec_13f_filings (cik, report_period desc, filing_date desc);
create index if not exists idx_sec_13f_holdings_filing_value
  on public.sec_13f_holdings (filing_id, value_usd desc);
create index if not exists idx_sec_13f_holdings_cik_period
  on public.sec_13f_holdings (cik, report_period desc);
create index if not exists idx_sec_13f_holdings_cusip
  on public.sec_13f_holdings (cusip);

drop trigger if exists trg_institutional_managers_updated_at
  on public.institutional_managers;
create trigger trg_institutional_managers_updated_at
  before update on public.institutional_managers
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_sec_13f_filings_updated_at
  on public.sec_13f_filings;
create trigger trg_sec_13f_filings_updated_at
  before update on public.sec_13f_filings
  for each row
  execute function public.set_updated_at();

alter table public.institutional_managers enable row level security;
alter table public.sec_13f_filings enable row level security;
alter table public.sec_13f_holdings enable row level security;

drop policy if exists "institutional_managers_select_authenticated"
  on public.institutional_managers;
create policy "institutional_managers_select_authenticated"
  on public.institutional_managers
  for select to authenticated using (true);

drop policy if exists "sec_13f_filings_select_authenticated"
  on public.sec_13f_filings;
create policy "sec_13f_filings_select_authenticated"
  on public.sec_13f_filings
  for select to authenticated using (true);

drop policy if exists "sec_13f_holdings_select_authenticated"
  on public.sec_13f_holdings;
create policy "sec_13f_holdings_select_authenticated"
  on public.sec_13f_holdings
  for select to authenticated using (true);

grant select on table public.institutional_managers to authenticated;
grant select on table public.sec_13f_filings to authenticated;
grant select on table public.sec_13f_holdings to authenticated;

grant select, insert, update, delete on table public.institutional_managers to service_role;
grant select, insert, update, delete on table public.sec_13f_filings to service_role;
grant select, insert, update, delete on table public.sec_13f_holdings to service_role;

insert into public.institutional_managers (
  cik,
  name,
  display_name,
  country_code,
  notes
) values
  (
    '0001608046',
    'National Pension Service',
    '국민연금공단 / National Pension Service',
    'KR',
    'Korea National Pension Service 13F filer on SEC EDGAR.'
  ),
  (
    '0002012383',
    'BlackRock, Inc.',
    '블랙록 / BlackRock, Inc.',
    'US',
    'BlackRock 13F filer on SEC EDGAR.'
  ),
  (
    '0001067983',
    'Berkshire Hathaway Inc',
    '버크셔 해서웨이 / Berkshire Hathaway',
    'US',
    'Berkshire Hathaway 13F filer on SEC EDGAR.'
  ),
  (
    '0001697748',
    'ARK Investment Management LLC',
    '캐시 우드 ARK / ARK Investment Management',
    'US',
    'Cathie Wood''s ARK Investment Management 13F filer on SEC EDGAR.'
  )
on conflict (cik) do update set
  name = excluded.name,
  display_name = excluded.display_name,
  country_code = excluded.country_code,
  notes = excluded.notes;
