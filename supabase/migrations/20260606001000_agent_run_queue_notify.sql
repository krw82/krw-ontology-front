-- Wake long-running supervisors when durable agent queue rows become available.

create or replace function public.notify_agent_run_queued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'queued' or new.cancel_requested_at is not null then
    return new;
  end if;

  if tg_op = 'INSERT'
     or old.status is distinct from new.status
     or old.cancel_requested_at is not null then
    perform pg_notify('agent_run_queued', new.id::text);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_agent_run_queued on public.agent_runs;
create trigger trg_notify_agent_run_queued
  after insert or update of status, cancel_requested_at
  on public.agent_runs
  for each row
  execute function public.notify_agent_run_queued();

revoke all on function public.notify_agent_run_queued() from public, anon, authenticated;
