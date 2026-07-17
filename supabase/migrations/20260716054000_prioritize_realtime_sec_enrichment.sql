-- Historical submissions backfill is necessary for catalog coverage, but it
-- must never delay a newly filed current-feed event. The prior age bonus made
-- older baseline jobs outrank fresh events before occurred_at could break the
-- tie. Keep the persisted priority and Form 4 claim-time boost, then place
-- non-baseline discoveries ahead of baseline work deterministically.

create or replace function public.claim_sec_filing_processing_jobs(
  p_env text,
  p_worker_id text,
  p_stage text default null,
  p_limit integer default 10,
  p_lease_seconds integer default 180
)
returns table (
  id uuid,
  filing_event_id uuid,
  stage text,
  claim_token uuid,
  attempts integer,
  progress_json jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_worker_id text := trim(coalesce(p_worker_id, ''));
  v_stage text := nullif(trim(coalesce(p_stage, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 180), 900));
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;
  if v_worker_id = '' then
    raise exception 'p_worker_id is required';
  end if;
  if v_stage is not null and v_stage not in ('enrich', 'notification_fanout') then
    raise exception 'invalid filing processing stage';
  end if;

  return query
  with candidates as (
    select job.id
    from public.sec_filing_processing_jobs job
    join public.sec_filing_events event
      on event.id = job.filing_event_id
    where job.env = v_env
      and event.env = v_env
      and (v_stage is null or job.stage = v_stage)
      and job.attempts < job.max_attempts
      and (
        (job.status in ('queued', 'retry') and job.next_attempt_at <= now())
        or (job.status = 'claimed' and job.lease_expires_at <= now())
      )
    order by
      case when coalesce(event.source_metadata ->> 'discoveryBaseline', 'false') = 'true' then 1 else 0 end asc,
      (
        job.priority
        + case when event.form_type in ('4', '4/A') then 10 else 0 end
      ) desc,
      event.occurred_at desc,
      job.next_attempt_at asc,
      job.created_at asc
    limit v_limit
    for update of job skip locked
  ), claimed as (
    update public.sec_filing_processing_jobs job
    set status = 'claimed',
        attempts = job.attempts + 1,
        worker_id = v_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.id, job.filing_event_id, job.stage, job.claim_token,
      job.attempts, job.progress_json
  )
  select * from claimed;
end;
$$;
