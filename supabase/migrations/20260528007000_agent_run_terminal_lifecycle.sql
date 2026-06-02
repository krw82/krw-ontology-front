-- Centralize terminal agent_run invariants in the database.
-- Every terminal run must have finished_at set, lease_expires_at cleared, and
-- optionally close any still-open tool calls with the same terminal timestamp.

create or replace function public.mark_agent_run_terminal(
  p_run_id uuid,
  p_status public.run_status,
  p_finished_at timestamptz default now(),
  p_error_code text default null,
  p_error_message text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_estimated_cost_usd numeric default null,
  p_latency_ms integer default null,
  p_assistant_message_id uuid default null,
  p_open_tool_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finished_at timestamptz := coalesce(p_finished_at, now());
  v_updated boolean := false;
begin
  if p_run_id is null then
    raise exception 'run_id is required';
  end if;

  if p_status not in (
    'completed'::public.run_status,
    'failed'::public.run_status,
    'cancelled'::public.run_status,
    'expired'::public.run_status
  ) then
    raise exception 'status must be terminal';
  end if;

  update public.agent_runs as r
    set status = p_status,
        assistant_message_id = coalesce(p_assistant_message_id, r.assistant_message_id),
        finished_at = v_finished_at,
        lease_expires_at = null,
        error_code = p_error_code,
        error_message = p_error_message,
        input_tokens = coalesce(p_input_tokens, r.input_tokens),
        output_tokens = coalesce(p_output_tokens, r.output_tokens),
        estimated_cost_usd = coalesce(p_estimated_cost_usd, r.estimated_cost_usd),
        latency_ms = coalesce(p_latency_ms, r.latency_ms)
    where r.id = p_run_id
      and r.status not in ('completed', 'failed', 'cancelled', 'expired')
    returning true into v_updated;

  if coalesce(v_updated, false) and p_open_tool_error_message is not null then
    update public.tool_calls as tc
      set finished_at = v_finished_at,
          error_message = coalesce(
            nullif(tc.error_message, ''),
            p_open_tool_error_message
          )
      where tc.run_id = p_run_id
        and tc.finished_at is null;
  end if;

  return coalesce(v_updated, false);
end;
$$;

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
  v_lease_seconds integer := greatest(coalesce(p_lease_seconds, 300), 30);
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

grant execute on function public.claim_agent_run(text, text, text, integer, integer)
  to service_role;

grant execute on function public.claim_agent_run(text, integer, integer)
  to service_role;
