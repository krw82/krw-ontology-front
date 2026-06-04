-- Add durable chat artifacts for interactive news-event selection.

alter table public.agent_runs
  add column if not exists run_kind text not null default 'company_research',
  add column if not exists selected_news_event_context jsonb,
  add column if not exists source_artifact_id uuid,
  add column if not exists source_event_id text;

alter table public.agent_runs
  drop constraint if exists agent_runs_run_kind_check;

alter table public.agent_runs
  add constraint agent_runs_run_kind_check
  check (run_kind in ('company_research', 'news_discovery', 'news_research'));

create table if not exists public.chat_message_artifacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chat_message_artifacts_type_check
    check (type in ('news_event_selection', 'verified_source_summary'))
);

create table if not exists public.chat_message_artifact_selections (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.chat_message_artifacts(id) on delete cascade,
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_payload_json jsonb not null default '{}'::jsonb,
  user_message_id uuid references public.messages(id) on delete set null,
  research_run_id uuid references public.agent_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.agent_runs
  drop constraint if exists agent_runs_source_artifact_id_fkey;

alter table public.agent_runs
  add constraint agent_runs_source_artifact_id_fkey
  foreign key (source_artifact_id)
  references public.chat_message_artifacts(id)
  on delete set null;

create index if not exists idx_agent_runs_run_kind
  on public.agent_runs (run_kind, queued_at);

create index if not exists idx_chat_message_artifacts_session_created
  on public.chat_message_artifacts (session_id, created_at);

create index if not exists idx_chat_message_artifacts_message
  on public.chat_message_artifacts (message_id);

create index if not exists idx_chat_message_artifacts_run
  on public.chat_message_artifacts (run_id);

create unique index if not exists uq_chat_artifact_selection_event
  on public.chat_message_artifact_selections (artifact_id, event_id);

create index if not exists idx_chat_artifact_selections_research_run
  on public.chat_message_artifact_selections (research_run_id)
  where research_run_id is not null;

create index if not exists idx_chat_artifact_selections_user_created
  on public.chat_message_artifact_selections (user_id, created_at);

alter table public.chat_message_artifacts enable row level security;
alter table public.chat_message_artifact_selections enable row level security;

revoke all on table public.chat_message_artifacts from anon, authenticated;
grant select on table public.chat_message_artifacts to authenticated;
grant select, insert, update, delete on table public.chat_message_artifacts to service_role;

revoke all on table public.chat_message_artifact_selections from anon, authenticated;
grant select on table public.chat_message_artifact_selections to authenticated;
grant select, insert, update, delete on table public.chat_message_artifact_selections to service_role;

drop policy if exists "chat_message_artifacts_select_own" on public.chat_message_artifacts;
create policy "chat_message_artifacts_select_own" on public.chat_message_artifacts
  for select using (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_artifacts_insert_own" on public.chat_message_artifacts;
create policy "chat_message_artifacts_insert_own" on public.chat_message_artifacts
  for insert with check (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_artifacts_update_own" on public.chat_message_artifacts;
create policy "chat_message_artifacts_update_own" on public.chat_message_artifacts
  for update using (public.session_owner(session_id) = auth.uid())
  with check (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_artifact_selections_select_own" on public.chat_message_artifact_selections;
create policy "chat_message_artifact_selections_select_own" on public.chat_message_artifact_selections
  for select using (
    exists (
      select 1
      from public.chat_message_artifacts a
      where a.id = artifact_id
        and public.session_owner(a.session_id) = auth.uid()
    )
  );

drop policy if exists "chat_message_artifact_selections_insert_own" on public.chat_message_artifact_selections;
create policy "chat_message_artifact_selections_insert_own" on public.chat_message_artifact_selections
  for insert with check (
    exists (
      select 1
      from public.chat_message_artifacts a
      where a.id = artifact_id
        and public.session_owner(a.session_id) = auth.uid()
    )
  );

drop policy if exists "chat_message_artifact_selections_update_own" on public.chat_message_artifact_selections;
create policy "chat_message_artifact_selections_update_own" on public.chat_message_artifact_selections
  for update using (
    exists (
      select 1
      from public.chat_message_artifacts a
      where a.id = artifact_id
        and public.session_owner(a.session_id) = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.chat_message_artifacts a
      where a.id = artifact_id
        and public.session_owner(a.session_id) = auth.uid()
    )
  );
