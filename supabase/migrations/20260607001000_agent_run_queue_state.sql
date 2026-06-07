create or replace function public.get_agent_run_queue_state(
  p_run_id uuid,
  p_global_limit integer
)
returns table (
  status public.run_status,
  queued_ahead integer,
  running_count integer,
  concurrency_limit integer,
  queued_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_global_limit integer := greatest(coalesce(p_global_limit, 1), 1);
begin
  select r.id, r.status, r.ontology_env, r.queued_at
    into v_run
    from public.agent_runs as r
    where r.id = p_run_id;

  if not found then
    return;
  end if;

  return query
  select
    v_run.status::public.run_status as status,
    case
      when v_run.status = 'queued'::public.run_status then (
        select count(*)::integer
        from public.agent_runs as r
        where r.status = 'queued'
          and r.ontology_env = v_run.ontology_env
          and r.cancel_requested_at is null
          and (
            r.queued_at < v_run.queued_at
            or (r.queued_at = v_run.queued_at and r.id < v_run.id)
          )
      )
      else 0
    end as queued_ahead,
    (
      select count(*)::integer
      from public.agent_runs as r
      where r.status = 'running'
        and r.ontology_env = v_run.ontology_env
        and r.lease_expires_at is not null
        and r.lease_expires_at > now()
    ) as running_count,
    v_global_limit as concurrency_limit,
    v_run.queued_at as queued_at;
end;
$$;

revoke all on function public.get_agent_run_queue_state(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_agent_run_queue_state(uuid, integer)
  to service_role;
