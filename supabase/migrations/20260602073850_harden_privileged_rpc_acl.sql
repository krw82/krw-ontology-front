-- Harden worker-only SECURITY DEFINER RPCs.
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default, so service
-- role grants must be paired with explicit browser-role revokes.

create or replace function public.heartbeat_agent_run(
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 1800);
begin
  update public.agent_runs as r
    set heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds)
    where r.id = p_run_id
      and r.worker_id = p_worker_id
      and r.status = 'running';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.claim_agent_run(
  p_worker_id text,
  p_worker_env text,
  p_ontology_env text,
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
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 1800);
  v_global_limit integer := greatest(coalesce(p_global_limit, 1), 1);
  v_worker_env text := lower(trim(coalesce(p_worker_env, '')));
  v_ontology_env text := lower(trim(coalesce(p_ontology_env, '')));
  v_expired record;
  v_user_id uuid;
  v_finished_at timestamptz;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;
  if v_worker_env not in ('dev', 'staging', 'prod') then
    raise exception 'worker_env must be dev, staging, or prod';
  end if;
  if v_ontology_env not in ('dev', 'staging', 'prod') then
    raise exception 'ontology_env must be dev, staging, or prod';
  end if;
  if v_worker_env <> v_ontology_env then
    raise exception 'worker_env and ontology_env must match';
  end if;

  for v_expired in
    select r.id, r.session_id, r.assistant_message_id, r.request_id
    from public.agent_runs as r
    where r.status = 'running'
      and r.ontology_env = v_ontology_env
      and r.lease_expires_at is not null
      and r.lease_expires_at < now()
    for update skip locked
  loop
    v_finished_at := now();

    perform public.mark_agent_run_terminal(
      v_expired.id,
      'expired'::public.run_status,
      v_finished_at,
      'lease_expired',
      'Worker lease expired',
      null,
      null,
      null,
      null,
      null,
      'Worker lease expired before tool result was received'
    );

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
      and r.ontology_env = v_ontology_env
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
      and r.ontology_env = v_ontology_env
      and r.cancel_requested_at is null
    order by r.queued_at asc nulls last, r.id asc
    for update skip locked
    limit 1
  )
  update public.agent_runs as r
    set status = 'running',
        worker_id = p_worker_id,
        worker_env = v_worker_env,
        claimed_at = now(),
        started_at = coalesce(r.started_at, now()),
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds)
    from candidate
    where r.id = candidate.id
    returning r.id;
end;
$$;

create or replace function public.claim_agent_run(
  p_worker_id text,
  p_lease_seconds integer,
  p_global_limit integer
)
returns table (id uuid)
language sql
security definer
set search_path = public
as $$
  select *
  from public.claim_agent_run(
    p_worker_id,
    'prod',
    'prod',
    p_lease_seconds,
    p_global_limit
  );
$$;

revoke all on function public.claim_agent_run(text, integer, integer)
  from PUBLIC, anon, authenticated;
revoke all on function public.claim_agent_run(text, text, text, integer, integer)
  from PUBLIC, anon, authenticated;
revoke all on function public.heartbeat_agent_run(uuid, text, integer)
  from PUBLIC, anon, authenticated;
revoke all on function public.mark_agent_run_terminal(
  uuid,
  public.run_status,
  timestamptz,
  text,
  text,
  integer,
  integer,
  numeric,
  integer,
  uuid,
  text
) from PUBLIC, anon, authenticated;
revoke all on function public.publish_ontology_web_catalog(jsonb)
  from PUBLIC, anon, authenticated;
revoke all on function public.record_usage_event(
  uuid,
  text,
  uuid,
  timestamptz,
  timestamptz,
  numeric
) from PUBLIC, anon, authenticated;

grant execute on function public.claim_agent_run(text, integer, integer)
  to service_role;
grant execute on function public.claim_agent_run(text, text, text, integer, integer)
  to service_role;
grant execute on function public.heartbeat_agent_run(uuid, text, integer)
  to service_role;
grant execute on function public.mark_agent_run_terminal(
  uuid,
  public.run_status,
  timestamptz,
  text,
  text,
  integer,
  integer,
  numeric,
  integer,
  uuid,
  text
) to service_role;
grant execute on function public.publish_ontology_web_catalog(jsonb)
  to service_role;
grant execute on function public.record_usage_event(
  uuid,
  text,
  uuid,
  timestamptz,
  timestamptz,
  numeric
) to service_role;
