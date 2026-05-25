-- Durable queue objects for worker-owned agent execution.

alter table public.agent_runs
  add column if not exists queued_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists retry_count integer not null default 0 check (retry_count >= 0),
  add column if not exists max_retries integer not null default 0 check (max_retries >= 0);

update public.agent_runs
  set queued_at = coalesce(queued_at, started_at, now())
  where queued_at is null;

drop index if exists public.uq_agent_runs_active_session;
drop index if exists public.idx_agent_runs_one_active_per_session;

create unique index if not exists uq_agent_runs_active_session
  on public.agent_runs (session_id)
  where status in ('pending', 'queued', 'running');

create index if not exists idx_agent_runs_queue_claim
  on public.agent_runs (queued_at, id)
  where status = 'queued';

create index if not exists idx_agent_runs_worker_active
  on public.agent_runs (worker_id, heartbeat_at)
  where status = 'running';

create table if not exists public.agent_run_events (
  id bigserial primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_run_events_run_id_id
  on public.agent_run_events (run_id, id);

alter table public.agent_run_events enable row level security;

drop policy if exists "Users can read own agent run events" on public.agent_run_events;
create policy "Users can read own agent run events"
  on public.agent_run_events
  for select
  using (
    exists (
      select 1
      from public.agent_runs r
      join public.chat_sessions s on s.id = r.session_id
      where r.id = agent_run_events.run_id
        and s.user_id = auth.uid()
        and s.deleted_at is null
    )
  );

revoke all on public.agent_run_events from public, anon, authenticated;
grant select on public.agent_run_events to authenticated;
grant select, insert, update, delete on public.agent_run_events to service_role;

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
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;

  update public.agent_runs as r
    set status = 'expired',
        error_code = 'lease_expired',
        error_message = 'Worker lease expired',
        finished_at = now()
    where r.status = 'running'
      and r.lease_expires_at is not null
      and r.lease_expires_at < now();

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
  v_lease_seconds integer := greatest(coalesce(p_lease_seconds, 300), 30);
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

grant execute on function public.claim_agent_run(text, integer, integer) to service_role;
grant execute on function public.heartbeat_agent_run(uuid, text, integer) to service_role;
