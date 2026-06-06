alter table public.agent_runs
  add column if not exists executor_type text not null default 'claude_agent';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_runs_executor_type_check'
      and conrelid = 'public.agent_runs'::regclass
  ) then
    alter table public.agent_runs
      add constraint agent_runs_executor_type_check
      check (executor_type in ('claude_agent', 'server_pipeline'));
  end if;
end $$;
