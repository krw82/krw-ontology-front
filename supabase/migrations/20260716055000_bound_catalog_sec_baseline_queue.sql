-- Catalog-wide SEC reconciliation can return up to one thousand historical
-- filings per CIK. Pulse only retains ninety days, so keep that initial
-- baseline bounded and make queue selection use the persisted job priority
-- rather than joining and sorting every event's JSON metadata.

create index if not exists idx_sec_filing_processing_jobs_ready_priority
  on public.sec_filing_processing_jobs (
    env,
    stage,
    priority desc,
    created_at desc,
    next_attempt_at asc
  )
  where status in ('queued', 'retry');

-- Retain the cross-listed Form 4 conflict guard introduced by the previous
-- migration and only change the initial priority assigned to enrich jobs.
do $$
declare
  v_definition text;
  v_match text := '  v_priority := case when v_event_family = ''insider_trade'' then 65 else 75 end;';
  v_replacement text := E'  v_priority := 75;\n  if coalesce(p_source_metadata ->> ''discoveryBaseline'', ''false'') = ''true'' then\n    v_priority := 55;\n  end if;';
begin
  select pg_get_functiondef(
    'public.record_catalog_sec_filing_discovery(text,text,text,text,text,date,date,timestamptz,text,text,text,jsonb,text,timestamptz)'::regprocedure
  )
  into v_definition;
  if v_definition is null or position(v_match in v_definition) = 0 then
    raise exception 'record_catalog_sec_filing_discovery has an unexpected priority definition';
  end if;
  v_definition := replace(v_definition, v_match, v_replacement);
  execute v_definition;
end;
$$;

-- Existing jobs are left untouched so this migration stays non-blocking. The
-- next discovery pass raises every current event through greatest(...), while
-- the bounded cleanup below removes stale baseline jobs in small transactions.

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

  -- A dead worker must not strand its lease. Recover it before selecting from
  -- the partial ready-job index below.
  update public.sec_filing_processing_jobs job
  set status = 'retry',
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      next_attempt_at = now(),
      last_error = coalesce(job.last_error, 'SEC filing processing lease expired'),
      updated_at = now()
  where job.env = v_env
    and (v_stage is null or job.stage = v_stage)
    and job.status = 'claimed'
    and job.lease_expires_at <= now();

  return query
  with candidates as (
    select job.id
    from public.sec_filing_processing_jobs job
    where job.env = v_env
      and (v_stage is null or job.stage = v_stage)
      and job.status in ('queued', 'retry')
      and job.attempts < job.max_attempts
      and job.next_attempt_at <= now()
    order by
      job.priority desc,
      job.created_at desc,
      job.next_attempt_at asc
    limit v_limit
    for update skip locked
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

-- Delete only old, unprocessed baseline events. This is intentionally bounded
-- so the worker and a one-off operator cleanup can drain a large first-run
-- backlog without a long database transaction. Dependent jobs and coverage
-- rows are deleted by their existing foreign-key cascades.
create or replace function public.prune_catalog_sec_baseline_backfill(
  p_env text,
  p_before_occurred_at timestamptz,
  p_limit integer default 500
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5_000));
  v_deleted bigint := 0;
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid filing env';
  end if;
  if p_before_occurred_at is null then
    raise exception 'p_before_occurred_at is required';
  end if;

  with candidates as (
    select event.id
    from public.sec_filing_events event
    where event.env = v_env
      and not event.feed_eligible
      and event.occurred_at < p_before_occurred_at
      and coalesce(event.source_metadata ->> 'discoveryBaseline', 'false') = 'true'
      and not exists (
        select 1
        from public.user_filing_notifications notification
        where notification.filing_event_id = event.id
      )
    order by event.occurred_at asc, event.id asc
    limit v_limit
    for update skip locked
  ), deleted as (
    delete from public.sec_filing_events event
    using candidates
    where event.id = candidates.id
    returning event.id
  )
  select count(*) into v_deleted from deleted;

  return v_deleted;
end;
$$;

revoke all on function public.prune_catalog_sec_baseline_backfill(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.prune_catalog_sec_baseline_backfill(text, timestamptz, integer) to service_role;

notify pgrst, 'reload schema';
