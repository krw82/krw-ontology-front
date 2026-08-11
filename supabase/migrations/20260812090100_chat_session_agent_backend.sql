-- Direct krw-agent cutover.
-- Existing rooms are closed for new input; new rooms are Rust-owned.
-- Historical messages remain available to the retention/purge process.

alter table public.chat_sessions
  add column if not exists agent_backend text,
  add column if not exists closed_at timestamptz;

update public.chat_sessions
   set agent_backend = 'rust_agent',
       closed_at = coalesce(closed_at, clock_timestamp())
 where agent_backend is null
    or agent_backend <> 'rust_agent';

alter table public.chat_sessions
  alter column agent_backend set default 'rust_agent',
  alter column agent_backend set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'chat_sessions_agent_backend_check'
       and conrelid = 'public.chat_sessions'::regclass
  ) then
    alter table public.chat_sessions
      add constraint chat_sessions_agent_backend_check
      check (agent_backend = 'rust_agent');
  end if;
end
$$;

create index if not exists idx_chat_sessions_user_active_updated
  on public.chat_sessions (user_id, updated_at desc)
  where deleted_at is null and closed_at is null;

create or replace function public.prevent_chat_session_reopen()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.closed_at is not null and new.closed_at is null then
    raise exception 'chat_session_closed' using errcode = 'P0001';
  end if;
  if old.agent_backend is distinct from new.agent_backend then
    raise exception 'chat_session_backend_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_chat_session_reopen on public.chat_sessions;
create trigger trg_prevent_chat_session_reopen
before update on public.chat_sessions
for each row execute function public.prevent_chat_session_reopen();

revoke all on function public.prevent_chat_session_reopen() from public, anon, authenticated;
