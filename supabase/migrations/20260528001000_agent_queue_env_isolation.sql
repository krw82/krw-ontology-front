-- Partition agent queue and worker admission metadata by ontology environment.
-- Prod/staging/dev workers must not claim each other's queued runs.

alter table public.agent_runs
  add column if not exists ontology_env text,
  add column if not exists worker_env text,
  add column if not exists object_count integer,
  add column if not exists ontology_root text,
  add column if not exists index_path text,
  add column if not exists manifest_path text,
  add column if not exists manifest_valid boolean,
  add column if not exists agent_index_schema_version text,
  add column if not exists ontology_manifest jsonb;

update public.agent_runs
  set ontology_env = coalesce(ontology_env, 'prod');

alter table public.agent_runs
  alter column ontology_env set default 'prod',
  alter column ontology_env set not null;

alter table public.agent_runs
  drop constraint if exists agent_runs_ontology_env_check,
  drop constraint if exists agent_runs_worker_env_check,
  add constraint agent_runs_ontology_env_check
    check (ontology_env in ('dev', 'staging', 'prod')),
  add constraint agent_runs_worker_env_check
    check (worker_env is null or worker_env in ('dev', 'staging', 'prod'));

create index if not exists idx_agent_runs_queue_claim_env
  on public.agent_runs (ontology_env, queued_at, id)
  where status = 'queued' and cancel_requested_at is null;

create index if not exists idx_agent_runs_worker_active_env
  on public.agent_runs (ontology_env, worker_env, worker_id, heartbeat_at)
  where status = 'running';

alter table public.agent_worker_heartbeats
  add column if not exists worker_env text,
  add column if not exists ontology_env text,
  add column if not exists index_path text,
  add column if not exists manifest_path text,
  add column if not exists manifest_valid boolean,
  add column if not exists agent_index_schema_version text;

update public.agent_worker_heartbeats
  set worker_env = coalesce(worker_env, 'prod'),
      ontology_env = coalesce(ontology_env, 'prod'),
      manifest_valid = coalesce(manifest_valid, false);

alter table public.agent_worker_heartbeats
  alter column worker_env set default 'prod',
  alter column ontology_env set default 'prod',
  alter column manifest_valid set default false,
  alter column worker_env set not null,
  alter column ontology_env set not null,
  alter column manifest_valid set not null;

alter table public.agent_worker_heartbeats
  drop constraint if exists agent_worker_heartbeats_worker_env_check,
  drop constraint if exists agent_worker_heartbeats_ontology_env_check,
  add constraint agent_worker_heartbeats_worker_env_check
    check (worker_env in ('dev', 'staging', 'prod')),
  add constraint agent_worker_heartbeats_ontology_env_check
    check (ontology_env in ('dev', 'staging', 'prod'));

create index if not exists idx_agent_worker_heartbeats_ready_env
  on public.agent_worker_heartbeats (
    ontology_env,
    worker_env,
    status,
    manifest_valid,
    heartbeat_expires_at desc,
    last_seen_at desc
  )
  where ontology_release_id is not null;

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
    update public.agent_runs as r
      set status = 'expired',
          error_code = 'lease_expired',
          error_message = 'Worker lease expired',
          finished_at = now(),
          lease_expires_at = null
      where r.status = 'running'
        and r.ontology_env = v_ontology_env
        and r.lease_expires_at is not null
        and r.lease_expires_at < now()
      returning r.id, r.session_id, r.assistant_message_id, r.request_id
  loop
    update public.tool_calls as tc
      set finished_at = now(),
          error_message = coalesce(
            nullif(tc.error_message, ''),
            'Worker lease expired before tool result was received'
          )
      where tc.run_id = v_expired.id
        and tc.finished_at is null;

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
