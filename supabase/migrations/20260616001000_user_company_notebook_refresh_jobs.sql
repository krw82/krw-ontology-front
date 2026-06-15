-- Durable status rows for per-company notebook refresh work.

create table if not exists public.user_company_notebook_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  status text not null default 'queued',
  notebook_id uuid references public.user_company_notebooks(id) on delete set null,
  recent_conversation_count integer not null default 0,
  saved_question_count integer not null default 0,
  last_source_chat_session_id uuid references public.chat_sessions(id) on delete set null,
  last_source_message_id uuid references public.messages(id) on delete set null,
  error_code text,
  error_message text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_company_notebook_refresh_jobs_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0),
  constraint user_company_notebook_refresh_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint user_company_notebook_refresh_jobs_recent_count_check
    check (recent_conversation_count >= 0),
  constraint user_company_notebook_refresh_jobs_question_count_check
    check (saved_question_count >= 0),
  constraint user_company_notebook_refresh_jobs_error_code_length
    check (error_code is null or char_length(error_code) <= 80),
  constraint user_company_notebook_refresh_jobs_error_message_length
    check (error_message is null or char_length(error_message) <= 2000)
);

create index if not exists idx_user_company_notebook_refresh_jobs_user_ticker_created
  on public.user_company_notebook_refresh_jobs (user_id, ticker, created_at desc);

create index if not exists idx_user_company_notebook_refresh_jobs_user_status
  on public.user_company_notebook_refresh_jobs (user_id, status, updated_at desc);

create unique index if not exists idx_user_company_notebook_refresh_jobs_active
  on public.user_company_notebook_refresh_jobs (user_id, ticker)
  where status in ('queued', 'running');

drop trigger if exists trg_user_company_notebook_refresh_jobs_updated_at on public.user_company_notebook_refresh_jobs;
create trigger trg_user_company_notebook_refresh_jobs_updated_at
  before update on public.user_company_notebook_refresh_jobs
  for each row
  execute function public.set_updated_at();

alter table public.user_company_notebook_refresh_jobs enable row level security;

create policy "user_company_notebook_refresh_jobs_select_own" on public.user_company_notebook_refresh_jobs
  for select using (user_id = auth.uid());
create policy "user_company_notebook_refresh_jobs_insert_own" on public.user_company_notebook_refresh_jobs
  for insert with check (user_id = auth.uid());
create policy "user_company_notebook_refresh_jobs_update_own" on public.user_company_notebook_refresh_jobs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_company_notebook_refresh_jobs_delete_own" on public.user_company_notebook_refresh_jobs
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on table public.user_company_notebook_refresh_jobs to authenticated;
