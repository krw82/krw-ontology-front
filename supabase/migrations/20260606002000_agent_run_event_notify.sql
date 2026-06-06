-- Wake web SSE streams when durable agent run events are inserted.
-- The notification is only a wakeup signal; clients still read event rows from
-- public.agent_run_events by cursor.

create or replace function public.notify_agent_run_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_notify('agent_run_event', new.run_id::text);
  return new;
end;
$$;

drop trigger if exists trg_notify_agent_run_event on public.agent_run_events;
create trigger trg_notify_agent_run_event
  after insert on public.agent_run_events
  for each row
  execute function public.notify_agent_run_event();
