-- Make worker lease expiry self-contained. A client reconnect should not be
-- responsible for releasing reserved budget or marking the assistant message
-- terminal after a worker crash.

create or replace function public.claim_agent_run(
  p_worker_id text,
  p_lease_seconds integer,
  p_global_limit integer
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count integer;
  v_lease_seconds integer := greatest(coalesce(p_lease_seconds, 300), 30);
  v_global_limit integer := greatest(coalesce(p_global_limit, 1), 1);
  v_expired record;
  v_user_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;

  for v_expired in
    update public.agent_runs as r
      set status = 'expired',
          error_code = 'lease_expired',
          error_message = 'Worker lease expired',
          finished_at = now(),
          lease_expires_at = null
      where r.status = 'running'
        and r.lease_expires_at is not null
        and r.lease_expires_at < now()
      returning r.id, r.session_id, r.assistant_message_id, r.request_id
  loop
    update public.messages as m
      set status = 'failed',
          content = '분석 시간이 초과되었습니다. 다시 시도해주세요.'
      where m.id = v_expired.assistant_message_id
        and m.status <> 'completed';

    select s.user_id
      into v_user_id
      from public.chat_sessions as s
      where s.id = v_expired.session_id;

    if v_user_id is not null and v_expired.request_id is not null then
      perform public.release_execution_budget(
        v_user_id,
        v_expired.request_id,
        v_expired.id,
        'lease_expired'
      );
    end if;

    if not exists (
      select 1
      from public.agent_run_events as e
      where e.run_id = v_expired.id
        and e.event_type in ('done', 'error', 'cancelled')
    ) then
      insert into public.agent_run_events (run_id, event_type, payload)
      values (
        v_expired.id,
        'error',
        jsonb_build_object(
          'run_id', v_expired.id,
          'error_code', 'lease_expired',
          'error_message', '분석 시간이 초과되었습니다. 다시 시도해주세요.'
        )
      );
    end if;
  end loop;

  select count(*)
    into v_active_count
    from public.agent_runs as r
    where r.status = 'running'
      and r.lease_expires_at is not null
      and r.lease_expires_at > now();

  if v_active_count >= v_global_limit then
    return;
  end if;

  return query
  with candidate as (
    select r.id
    from public.agent_runs as r
    where r.status = 'queued'
      and r.cancel_requested_at is null
    order by r.queued_at asc nulls last, r.id asc
    for update skip locked
    limit 1
  )
  update public.agent_runs as r
    set status = 'running',
        worker_id = p_worker_id,
        claimed_at = now(),
        started_at = coalesce(r.started_at, now()),
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds)
    from candidate
    where r.id = candidate.id
    returning r.id;
end;
$$;

grant execute on function public.claim_agent_run(text, integer, integer)
  to service_role;
