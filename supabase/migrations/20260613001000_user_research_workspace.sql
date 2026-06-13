-- User-owned research workspace for personal watchlists, thesis tracking,
-- open questions, and saved research notes.

create table if not exists public.user_company_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  is_watchlisted boolean not null default true,
  is_holding boolean not null default false,
  priority integer not null default 0,
  interest_reason text,
  tags text[] not null default '{}'::text[],
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker),
  constraint user_company_marks_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0),
  constraint user_company_marks_interest_reason_length
    check (interest_reason is null or char_length(interest_reason) <= 1200)
);

create table if not exists public.user_company_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  question text not null,
  status text not null default 'open',
  source text not null default 'manual',
  source_chat_session_id uuid references public.chat_sessions(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_company_questions_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0),
  constraint user_company_questions_question_length
    check (char_length(trim(question)) between 1 and 1200),
  constraint user_company_questions_status_check
    check (status in ('open', 'answered', 'dismissed')),
  constraint user_company_questions_source_check
    check (source in ('manual', 'generated_from_tearsheet', 'generated_from_thesis_check', 'saved_from_chat'))
);

create table if not exists public.user_company_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  title text not null default '종목 카드',
  summary text,
  content_md text not null default '',
  basis_release_id text,
  basis_period text,
  basis_document_type text,
  source_chat_session_id uuid references public.chat_sessions(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker),
  constraint user_company_cards_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0),
  constraint user_company_cards_title_length
    check (char_length(trim(title)) between 1 and 200)
);

create table if not exists public.user_company_theses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  title text not null,
  thesis_text text not null default '',
  status text not null default 'active',
  tags text[] not null default '{}'::text[],
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_company_theses_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0),
  constraint user_company_theses_title_length
    check (char_length(trim(title)) between 1 and 200),
  constraint user_company_theses_status_check
    check (status in ('active', 'needs_review', 'weakened', 'mixed', 'archived'))
);

create table if not exists public.user_thesis_checks (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.user_company_theses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  result_status text not null default 'needs_review',
  summary text not null default '',
  strengthening_points text[] not null default '{}'::text[],
  weakening_points text[] not null default '{}'::text[],
  neutral_points text[] not null default '{}'::text[],
  next_questions text[] not null default '{}'::text[],
  basis_release_id text,
  basis_period text,
  source_chat_session_id uuid references public.chat_sessions(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint user_thesis_checks_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0),
  constraint user_thesis_checks_result_status_check
    check (result_status in ('strengthened', 'weakened', 'mixed', 'insufficient', 'needs_review'))
);

create table if not exists public.user_research_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  title text not null,
  body text not null default '',
  note_type text not null default 'manual',
  tags text[] not null default '{}'::text[],
  source_chat_session_id uuid references public.chat_sessions(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_research_notes_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0),
  constraint user_research_notes_title_length
    check (char_length(trim(title)) between 1 and 200),
  constraint user_research_notes_type_check
    check (note_type in ('manual', 'chat_summary', 'thesis_check', 'filing_check', 'risk_memo', 'earnings_setup', 'earnings_review', 'tearsheet'))
);

create table if not exists public.user_research_note_sources (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.user_research_notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  citation_id uuid references public.citations(id) on delete set null,
  run_id uuid references public.agent_runs(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  ontology_object_id text,
  document_type text,
  filing_period text,
  created_at timestamptz not null default now(),
  constraint user_research_note_sources_ticker_check
    check (ticker = upper(ticker) and length(trim(ticker)) > 0)
);

create index if not exists idx_user_company_marks_user_updated
  on public.user_company_marks (user_id, updated_at desc);
create index if not exists idx_user_company_marks_user_holding
  on public.user_company_marks (user_id, is_holding, updated_at desc);
create index if not exists idx_user_company_questions_user_ticker_status
  on public.user_company_questions (user_id, ticker, status, updated_at desc);
create index if not exists idx_user_company_cards_user_ticker
  on public.user_company_cards (user_id, ticker);
create index if not exists idx_user_company_theses_user_ticker
  on public.user_company_theses (user_id, ticker, updated_at desc)
  where archived_at is null;
create index if not exists idx_user_thesis_checks_thesis_created
  on public.user_thesis_checks (thesis_id, created_at desc);
create index if not exists idx_user_research_notes_user_ticker_created
  on public.user_research_notes (user_id, ticker, created_at desc);
create index if not exists idx_user_research_note_sources_note
  on public.user_research_note_sources (note_id);

drop trigger if exists trg_user_company_marks_updated_at on public.user_company_marks;
create trigger trg_user_company_marks_updated_at
  before update on public.user_company_marks
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_user_company_questions_updated_at on public.user_company_questions;
create trigger trg_user_company_questions_updated_at
  before update on public.user_company_questions
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_user_company_cards_updated_at on public.user_company_cards;
create trigger trg_user_company_cards_updated_at
  before update on public.user_company_cards
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_user_company_theses_updated_at on public.user_company_theses;
create trigger trg_user_company_theses_updated_at
  before update on public.user_company_theses
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_user_research_notes_updated_at on public.user_research_notes;
create trigger trg_user_research_notes_updated_at
  before update on public.user_research_notes
  for each row
  execute function public.set_updated_at();

alter table public.user_company_marks enable row level security;
alter table public.user_company_questions enable row level security;
alter table public.user_company_cards enable row level security;
alter table public.user_company_theses enable row level security;
alter table public.user_thesis_checks enable row level security;
alter table public.user_research_notes enable row level security;
alter table public.user_research_note_sources enable row level security;

create policy "user_company_marks_select_own" on public.user_company_marks
  for select using (user_id = auth.uid());
create policy "user_company_marks_insert_own" on public.user_company_marks
  for insert with check (user_id = auth.uid());
create policy "user_company_marks_update_own" on public.user_company_marks
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_company_marks_delete_own" on public.user_company_marks
  for delete using (user_id = auth.uid());

create policy "user_company_questions_select_own" on public.user_company_questions
  for select using (user_id = auth.uid());
create policy "user_company_questions_insert_own" on public.user_company_questions
  for insert with check (user_id = auth.uid());
create policy "user_company_questions_update_own" on public.user_company_questions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_company_questions_delete_own" on public.user_company_questions
  for delete using (user_id = auth.uid());

create policy "user_company_cards_select_own" on public.user_company_cards
  for select using (user_id = auth.uid());
create policy "user_company_cards_insert_own" on public.user_company_cards
  for insert with check (user_id = auth.uid());
create policy "user_company_cards_update_own" on public.user_company_cards
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_company_cards_delete_own" on public.user_company_cards
  for delete using (user_id = auth.uid());

create policy "user_company_theses_select_own" on public.user_company_theses
  for select using (user_id = auth.uid());
create policy "user_company_theses_insert_own" on public.user_company_theses
  for insert with check (user_id = auth.uid());
create policy "user_company_theses_update_own" on public.user_company_theses
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_company_theses_delete_own" on public.user_company_theses
  for delete using (user_id = auth.uid());

create policy "user_thesis_checks_select_own" on public.user_thesis_checks
  for select using (user_id = auth.uid());
create policy "user_thesis_checks_insert_own" on public.user_thesis_checks
  for insert with check (user_id = auth.uid());
create policy "user_thesis_checks_update_own" on public.user_thesis_checks
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_thesis_checks_delete_own" on public.user_thesis_checks
  for delete using (user_id = auth.uid());

create policy "user_research_notes_select_own" on public.user_research_notes
  for select using (user_id = auth.uid());
create policy "user_research_notes_insert_own" on public.user_research_notes
  for insert with check (user_id = auth.uid());
create policy "user_research_notes_update_own" on public.user_research_notes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_research_notes_delete_own" on public.user_research_notes
  for delete using (user_id = auth.uid());

create policy "user_research_note_sources_select_own" on public.user_research_note_sources
  for select using (user_id = auth.uid());
create policy "user_research_note_sources_insert_own" on public.user_research_note_sources
  for insert with check (user_id = auth.uid());
create policy "user_research_note_sources_update_own" on public.user_research_note_sources
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_research_note_sources_delete_own" on public.user_research_note_sources
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on table public.user_company_marks to authenticated;
grant select, insert, update, delete on table public.user_company_questions to authenticated;
grant select, insert, update, delete on table public.user_company_cards to authenticated;
grant select, insert, update, delete on table public.user_company_theses to authenticated;
grant select, insert, update, delete on table public.user_thesis_checks to authenticated;
grant select, insert, update, delete on table public.user_research_notes to authenticated;
grant select, insert, update, delete on table public.user_research_note_sources to authenticated;
