-- One lightweight, user-owned Markdown notebook per company.

create table if not exists public.user_company_notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  title text not null default '리서치 노트북',
  content_md text not null default '',
  previous_content_md text,
  basis_release_id text,
  basis_period text,
  last_source_chat_session_id uuid references public.chat_sessions(id) on delete set null,
  last_source_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker),
  constraint user_company_notebooks_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0),
  constraint user_company_notebooks_title_length
    check (char_length(trim(title)) between 1 and 200),
  constraint user_company_notebooks_content_length
    check (char_length(content_md) <= 100000),
  constraint user_company_notebooks_previous_content_length
    check (previous_content_md is null or char_length(previous_content_md) <= 100000)
);

create index if not exists idx_user_company_notebooks_user_ticker
  on public.user_company_notebooks (user_id, ticker);
create index if not exists idx_user_company_notebooks_user_updated
  on public.user_company_notebooks (user_id, updated_at desc);

drop trigger if exists trg_user_company_notebooks_updated_at on public.user_company_notebooks;
create trigger trg_user_company_notebooks_updated_at
  before update on public.user_company_notebooks
  for each row
  execute function public.set_updated_at();

alter table public.user_company_notebooks enable row level security;

create policy "user_company_notebooks_select_own" on public.user_company_notebooks
  for select using (user_id = auth.uid());
create policy "user_company_notebooks_insert_own" on public.user_company_notebooks
  for insert with check (user_id = auth.uid());
create policy "user_company_notebooks_update_own" on public.user_company_notebooks
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_company_notebooks_delete_own" on public.user_company_notebooks
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on table public.user_company_notebooks to authenticated;
