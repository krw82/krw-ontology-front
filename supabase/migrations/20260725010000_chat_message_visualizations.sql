-- Final structured visualization contract for chat messages.
--
-- The model never persists raw filing bodies. Each artifact contains only the
-- rendered numeric snapshot, deterministic visual spec, and evidence anchors.

create table if not exists public.chat_message_visualizations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  artifact_ref text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_chat_message_visualizations_message_ref
  on public.chat_message_visualizations (message_id, artifact_ref);

create index if not exists idx_chat_message_visualizations_session_created
  on public.chat_message_visualizations (session_id, created_at);

create index if not exists idx_chat_message_visualizations_message
  on public.chat_message_visualizations (message_id);

create index if not exists idx_chat_message_visualizations_run
  on public.chat_message_visualizations (run_id);

create table if not exists public.chat_message_presentations (
  message_id uuid primary key references public.messages(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  blocks_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_message_presentations_session
  on public.chat_message_presentations (session_id, created_at);

create index if not exists idx_chat_message_presentations_run
  on public.chat_message_presentations (run_id);

drop trigger if exists trg_chat_message_presentations_updated_at
  on public.chat_message_presentations;
create trigger trg_chat_message_presentations_updated_at
  before update on public.chat_message_presentations
  for each row execute function public.set_updated_at();

alter table public.chat_message_visualizations enable row level security;
alter table public.chat_message_presentations enable row level security;

revoke all on table public.chat_message_visualizations from anon, authenticated;
grant select on table public.chat_message_visualizations to authenticated;
grant select, insert, update, delete on table public.chat_message_visualizations to service_role;

revoke all on table public.chat_message_presentations from anon, authenticated;
grant select on table public.chat_message_presentations to authenticated;
grant select, insert, update, delete on table public.chat_message_presentations to service_role;

drop policy if exists "chat_message_visualizations_select_own"
  on public.chat_message_visualizations;
create policy "chat_message_visualizations_select_own"
  on public.chat_message_visualizations
  for select using (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_visualizations_insert_own"
  on public.chat_message_visualizations;
create policy "chat_message_visualizations_insert_own"
  on public.chat_message_visualizations
  for insert with check (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_visualizations_update_own"
  on public.chat_message_visualizations;
create policy "chat_message_visualizations_update_own"
  on public.chat_message_visualizations
  for update using (public.session_owner(session_id) = auth.uid())
  with check (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_presentations_select_own"
  on public.chat_message_presentations;
create policy "chat_message_presentations_select_own"
  on public.chat_message_presentations
  for select using (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_presentations_insert_own"
  on public.chat_message_presentations;
create policy "chat_message_presentations_insert_own"
  on public.chat_message_presentations
  for insert with check (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_presentations_update_own"
  on public.chat_message_presentations;
create policy "chat_message_presentations_update_own"
  on public.chat_message_presentations
  for update using (public.session_owner(session_id) = auth.uid())
  with check (public.session_owner(session_id) = auth.uid());
