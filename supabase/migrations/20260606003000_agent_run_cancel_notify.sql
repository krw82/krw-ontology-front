-- Wake active workers when an agent run is cancelled.
-- The notification is only a wakeup signal; workers still verify the durable
-- agent_runs row before aborting.

create or replace function public.notify_agent_run_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if
    new.cancel_requested_at is not null
    and old.cancel_requested_at is distinct from new.cancel_requested_at
  then
    perform pg_notify('agent_run_cancel', new.id::text);
  elsif new.status = 'cancelled' and old.status is distinct from new.status then
    perform pg_notify('agent_run_cancel', new.id::text);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_agent_run_cancel on public.agent_runs;
create trigger trg_notify_agent_run_cancel
  after update of cancel_requested_at, status on public.agent_runs
  for each row
  execute function public.notify_agent_run_cancel();

revoke all on function public.notify_agent_run_cancel()
from public, anon, authenticated;
