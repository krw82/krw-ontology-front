-- Make document ingestion ownership explicit and make source cleanup durable.
--
-- Postgres remains the canonical state: workers may only advance a job while
-- they hold its current claim token and an unexpired lease.  A successful
-- conversion commits the attachment, ingestion job, and cleanup intent in the
-- same transaction.  Filesystem deletion is deliberately handled afterwards
-- by a retryable cleanup job because it cannot participate in a SQL
-- transaction.

alter table public.document_ingestion_jobs
  add column if not exists claim_token uuid,
  add column if not exists claim_version bigint not null default 0;

alter table public.document_ingestion_jobs
  drop constraint if exists document_ingestion_jobs_claim_version_check,
  add constraint document_ingestion_jobs_claim_version_check
    check (claim_version >= 0);

create index if not exists idx_document_ingestion_jobs_reclaimable
  on public.document_ingestion_jobs (status, lease_expires_at, queued_at, id)
  where status in ('queued', 'running', 'processing', 'failed');

-- Do not silently discard legacy history to add the invariant. Operators must
-- resolve an existing conflict explicitly before this migration can proceed.
do $$
begin
  if exists (
    select 1
    from public.document_ingestion_jobs as j
    where j.status in ('queued', 'running', 'processing', 'completed')
    group by j.attachment_id
    having count(*) > 1
  ) then
    raise exception
      'document ingestion preflight failed: an attachment has multiple active/completed jobs; resolve duplicate rows before applying claim-token migration'
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists idx_document_ingestion_jobs_one_active_or_completed_attachment
  on public.document_ingestion_jobs (attachment_id)
  where status in ('queued', 'running', 'processing', 'completed');

create table if not exists public.document_source_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.chat_attachments(id) on delete cascade,
  ingestion_job_id uuid not null references public.document_ingestion_jobs(id) on delete cascade,
  storage_kind text not null,
  source_path text not null,
  status text not null default 'pending',
  worker_id text,
  claim_token uuid,
  claim_version bigint not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 12,
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_source_cleanup_jobs_storage_kind_check
    check (storage_kind in ('local_fs', 'object_storage')),
  constraint document_source_cleanup_jobs_status_check
    check (status in ('pending', 'processing', 'failed', 'completed', 'unsupported')),
  constraint document_source_cleanup_jobs_claim_version_check
    check (claim_version >= 0),
  constraint document_source_cleanup_jobs_attempts_check
    check (attempts >= 0 and max_attempts >= 1),
  constraint document_source_cleanup_jobs_source_path_check
    check (length(trim(source_path)) > 0),
  constraint document_source_cleanup_jobs_last_error_length
    check (last_error is null or char_length(last_error) <= 2000)
);

create unique index if not exists idx_document_source_cleanup_jobs_ingestion_job
  on public.document_source_cleanup_jobs (ingestion_job_id);

create index if not exists idx_document_source_cleanup_jobs_reclaimable
  on public.document_source_cleanup_jobs (status, next_attempt_at, lease_expires_at, created_at)
  where status in ('pending', 'processing', 'failed');

drop trigger if exists trg_document_source_cleanup_jobs_updated_at
  on public.document_source_cleanup_jobs;
create trigger trg_document_source_cleanup_jobs_updated_at
  before update on public.document_source_cleanup_jobs
  for each row
  execute function public.set_updated_at();

alter table public.document_source_cleanup_jobs enable row level security;

revoke all on table public.document_source_cleanup_jobs
  from public, anon, authenticated;
grant select, insert, update, delete on table public.document_source_cleanup_jobs
  to service_role;

-- Create or promote one durable source-cleanup intent per ingestion job. A
-- completed or unsupported cleanup is deliberately never reopened.
create or replace function public.enqueue_document_source_cleanup_intent(
  p_attachment_id uuid,
  p_ingestion_job_id uuid,
  p_next_attempt_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.document_source_cleanup_jobs as cleanup (
      attachment_id,
      ingestion_job_id,
      storage_kind,
      source_path,
      next_attempt_at
    )
    select
      a.id,
      p_ingestion_job_id,
      a.storage_kind,
      a.original_path,
      coalesce(p_next_attempt_at, now())
    from public.chat_attachments as a
    where a.id = p_attachment_id
      and a.original_path is not null
    on conflict (ingestion_job_id) do update
      set storage_kind = excluded.storage_kind,
          source_path = excluded.source_path,
          status = 'pending',
          next_attempt_at = least(
            cleanup.next_attempt_at,
            excluded.next_attempt_at
          ),
          last_error = null,
          updated_at = now()
      where cleanup.status in ('pending', 'failed');
end;
$$;

-- Terminal failures retain their original source until attachment expiry;
-- completed conversions are ready for cleanup immediately.
create or replace function public.enqueue_document_source_cleanup_on_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attachment public.chat_attachments%rowtype;
  v_next_attempt_at timestamptz;
begin
  if new.status not in ('completed', 'failed', 'cancelled')
    or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  select *
    into v_attachment
    from public.chat_attachments
    where id = new.attachment_id;

  if not found or v_attachment.original_path is null then
    return new;
  end if;

  if new.status = 'completed' then
    if v_attachment.extraction_status <> 'completed' then
      return new;
    end if;
    v_next_attempt_at := now();
  elsif v_attachment.extraction_status in ('failed', 'cancelled', 'expired') then
    v_next_attempt_at := v_attachment.expires_at;
  else
    return new;
  end if;

  perform public.enqueue_document_source_cleanup_intent(
    v_attachment.id,
    new.id,
    v_next_attempt_at
  );

  return new;
end;
$$;

-- Direct cancellation/expiry paths can update the attachment before the job.
create or replace function public.enqueue_document_source_cleanup_on_attachment_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_next_attempt_at timestamptz;
begin
  if new.extraction_status not in ('failed', 'cancelled', 'expired')
    or (tg_op = 'UPDATE' and old.extraction_status = new.extraction_status)
    or new.original_path is null then
    return new;
  end if;

  select j.id
    into v_job_id
    from public.document_ingestion_jobs as j
    where j.attachment_id = new.id
      and j.status in ('queued', 'running', 'processing', 'failed', 'cancelled', 'completed')
    order by
      case when j.status = 'completed' then 0 else 1 end,
      j.created_at desc,
      j.id desc
    limit 1;

  if v_job_id is null then
    return new;
  end if;

  v_next_attempt_at := case
    when new.extraction_status = 'expired' then now()
    else new.expires_at
  end;

  perform public.enqueue_document_source_cleanup_intent(
    new.id,
    v_job_id,
    v_next_attempt_at
  );

  return new;
end;
$$;

drop trigger if exists trg_enqueue_document_source_cleanup_on_completion
  on public.document_ingestion_jobs;
drop trigger if exists trg_enqueue_document_source_cleanup_on_terminal
  on public.document_ingestion_jobs;
create trigger trg_enqueue_document_source_cleanup_on_terminal
  after insert or update of status
  on public.document_ingestion_jobs
  for each row
  execute function public.enqueue_document_source_cleanup_on_terminal();

drop trigger if exists trg_enqueue_document_source_cleanup_on_attachment_terminal
  on public.chat_attachments;
create trigger trg_enqueue_document_source_cleanup_on_attachment_terminal
  after update of extraction_status
  on public.chat_attachments
  for each row
  execute function public.enqueue_document_source_cleanup_on_attachment_terminal();

-- Backfill terminal legacy jobs and attachment-only terminal states. Completed
-- records are ready immediately; failures/cancellations/expired attachments
-- retain their source until expires_at.
insert into public.document_source_cleanup_jobs (
  attachment_id,
  ingestion_job_id,
  storage_kind,
  source_path,
  next_attempt_at
)
select
  a.id,
  j.id,
  a.storage_kind,
  a.original_path,
  case
    when j.status = 'completed' and a.extraction_status = 'completed' then now()
    else a.expires_at
  end
from public.document_ingestion_jobs as j
join public.chat_attachments as a on a.id = j.attachment_id
where a.original_path is not null
  and (
    (j.status = 'completed' and a.extraction_status = 'completed')
    or a.extraction_status in ('failed', 'cancelled', 'expired')
    or j.status in ('failed', 'cancelled')
  )
on conflict (ingestion_job_id) do nothing;

-- New ingestion creation is intentionally local-filesystem-only until an
-- object-store deletion adapter exists. Make legacy object-storage cleanup
-- terminal and visible instead of repeatedly claiming work that cannot finish.
update public.document_source_cleanup_jobs
set status = 'unsupported',
    lease_expires_at = null,
    next_attempt_at = now(),
    last_error = coalesce(
      last_error,
      'Object-storage document cleanup is not configured for this deployment.'
    ),
    updated_at = now()
where storage_kind = 'object_storage'
  and status <> 'completed';

-- Periodically expire any unfinished attachment whose retention window has
-- elapsed. This cancels a still-active ingestion claim before cleanup, so a
-- late worker cannot complete over the expired attachment state.
create or replace function public.reconcile_expired_document_attachment_cleanup(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attachment_id uuid;
  v_attachment public.chat_attachments%rowtype;
  v_job public.document_ingestion_jobs%rowtype;
  v_job_id uuid;
  v_has_job boolean;
  v_next_seq bigint;
  v_processed integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
begin
  for v_attachment_id in
    select a.id
    from public.chat_attachments as a
    where a.original_path is not null
      and a.expires_at <= now()
      and (
        a.extraction_status in (
          'uploaded', 'queued', 'processing', 'failed', 'cancelled'
        )
        or (
          a.extraction_status = 'expired'
          and not exists (
            select 1
            from public.document_source_cleanup_jobs as c
            where c.attachment_id = a.id
          )
        )
      )
    order by a.expires_at asc, a.id asc
    limit v_limit
  loop
    select j.*
      into v_job
      from public.document_ingestion_jobs as j
      where j.attachment_id = v_attachment_id
      order by
        case
          when j.status in ('queued', 'running', 'processing') then 0
          when j.status = 'completed' then 1
          else 2
        end,
        j.created_at desc,
        j.id desc
      limit 1
      for update;
    v_has_job := found;

    -- Ingestion completion takes the job lock before the attachment lock. Keep
    -- the same order here so expiry reconciliation cannot deadlock with it.
    select a.*
      into v_attachment
      from public.chat_attachments as a
      where a.id = v_attachment_id
      for update;

    if not found
      or v_attachment.original_path is null
      or v_attachment.expires_at > now()
      or v_attachment.extraction_status = 'completed' then
      continue;
    end if;

    if v_has_job then
      v_job_id := v_job.id;
      v_next_seq := greatest(
        coalesce(v_attachment.last_event_seq, 0),
        coalesce(v_job.last_event_seq, 0)
      ) + 1;

      if v_job.status <> 'completed' then
        update public.document_ingestion_jobs
          set status = case
                when v_job.status in ('failed', 'cancelled') then v_job.status
                else 'cancelled'
              end,
              stage = 'failed',
              last_event_seq = v_next_seq,
              cancelled_at = coalesce(v_job.cancelled_at, now()),
              completed_at = coalesce(v_job.completed_at, now()),
              lease_expires_at = null,
              error_code = coalesce(v_job.error_code, 'document_attachment_expired'),
              error_message = coalesce(v_job.error_message, 'Document attachment expired before ingestion completed.'),
              updated_at = now()
          where id = v_job.id;
      end if;
    else
      insert into public.document_ingestion_jobs (
        attachment_id,
        status,
        stage,
        progress_percent,
        last_event_seq,
        completed_at,
        cancelled_at,
        error_code,
        error_message
      )
      values (
        v_attachment.id,
        'cancelled',
        'failed',
        v_attachment.progress_percent,
        coalesce(v_attachment.last_event_seq, 0) + 1,
        now(),
        now(),
        'document_attachment_expired',
        'Document attachment expired before an ingestion job was available.'
      )
      returning id, last_event_seq into v_job_id, v_next_seq;
    end if;

    update public.chat_attachments
      set extraction_status = 'expired',
          extraction_stage = 'failed',
          last_event_seq = v_next_seq,
          error_code = 'document_attachment_expired',
          error_message = '첨부 문서 보관 기간이 만료되었습니다.',
          extraction_error = '첨부 문서 보관 기간이 만료되었습니다.',
          updated_at = now()
      where id = v_attachment.id;

    perform public.enqueue_document_source_cleanup_intent(
      v_attachment.id,
      v_job_id,
      now()
    );
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

create or replace function public.claim_document_ingestion_job_v2(
  p_worker_id text,
  p_lease_seconds integer,
  p_global_limit integer
)
returns table (id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs%rowtype;
  v_active_count integer;
  v_claim_token uuid;
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 1800);
  v_global_limit integer := greatest(coalesce(p_global_limit, 1), 1);
  v_next_seq bigint;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;

  -- A small advisory lock makes the global concurrency count authoritative
  -- even when several workers claim different queued rows concurrently.
  perform pg_advisory_xact_lock(hashtext('public.claim_document_ingestion_job_v2'));

  select count(*)
    into v_active_count
    from public.document_ingestion_jobs as j
    where j.status in ('running', 'processing')
      and j.lease_expires_at is not null
      and j.lease_expires_at > now();

  if v_active_count >= v_global_limit then
    return;
  end if;

  select j.*
    into v_job
    from public.document_ingestion_jobs as j
    where j.attempts < j.max_attempts
      and exists (
        select 1
        from public.chat_attachments as a
        where a.id = j.attachment_id
          and a.expires_at > now()
      )
      and (
        j.status in ('queued', 'failed')
        or (
          j.status in ('running', 'processing')
          and (j.lease_expires_at is null or j.lease_expires_at <= now())
        )
      )
    order by j.queued_at asc, j.id asc
    limit 1
    for update skip locked;

  if not found then
    return;
  end if;

  v_claim_token := gen_random_uuid();
  v_next_seq := coalesce(v_job.last_event_seq, 0) + 1;

  update public.document_ingestion_jobs
    set status = 'processing',
        stage = 'accepted',
        progress_percent = 5,
        worker_id = p_worker_id,
        attempts = v_job.attempts + 1,
        started_at = coalesce(v_job.started_at, now()),
        completed_at = null,
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        claim_token = v_claim_token,
        claim_version = coalesce(v_job.claim_version, 0) + 1,
        last_event_seq = v_next_seq,
        error_code = null,
        error_message = null,
        updated_at = now()
    where id = v_job.id;

  update public.chat_attachments
    set extraction_status = 'processing',
        extraction_stage = 'accepted',
        progress_percent = 5,
        last_event_seq = v_next_seq,
        extraction_error = null,
        error_code = null,
        error_message = null,
        updated_at = now()
    where id = v_job.attachment_id;

  if not found then
    raise exception 'document attachment % is missing', v_job.attachment_id;
  end if;

  return query select v_job.id, v_claim_token;
end;
$$;

create or replace function public.claim_document_ingestion_job_by_id_v2(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer,
  p_global_limit integer
)
returns table (
  id uuid,
  claim_token uuid,
  lease_expires_at timestamptz,
  claim_state text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs%rowtype;
  v_active_count integer;
  v_claim_token uuid;
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 1800);
  v_global_limit integer := greatest(coalesce(p_global_limit, 1), 1);
  v_next_seq bigint;
  v_attachment_usable boolean;
begin
  if p_job_id is null then
    raise exception 'job_id is required';
  end if;
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.claim_document_ingestion_job_v2'));

  select j.*
    into v_job
    from public.document_ingestion_jobs as j
    where j.id = p_job_id
    for update;

  if not found
    or v_job.status in ('completed', 'cancelled')
    or v_job.attempts >= v_job.max_attempts then
    return;
  end if;

  select exists (
    select 1
    from public.chat_attachments as a
    where a.id = v_job.attachment_id
      and a.expires_at > now()
  ) into v_attachment_usable;

  if not v_attachment_usable then
    return;
  end if;

  if v_job.status in ('running', 'processing')
    and v_job.lease_expires_at is not null
    and v_job.lease_expires_at > now() then
    return query select
      v_job.id,
      null::uuid,
      v_job.lease_expires_at,
      'active_lease'::text;
    return;
  end if;

  select count(*)
    into v_active_count
    from public.document_ingestion_jobs as j
    where j.status in ('running', 'processing')
      and j.lease_expires_at is not null
      and j.lease_expires_at > now();

  if v_active_count >= v_global_limit then
    return query select
      v_job.id,
      null::uuid,
      now() + interval '1 second',
      'concurrency_limited'::text;
    return;
  end if;

  v_claim_token := gen_random_uuid();
  v_next_seq := coalesce(v_job.last_event_seq, 0) + 1;

  update public.document_ingestion_jobs
    set status = 'processing',
        stage = 'accepted',
        progress_percent = 5,
        worker_id = p_worker_id,
        attempts = v_job.attempts + 1,
        started_at = coalesce(v_job.started_at, now()),
        completed_at = null,
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        claim_token = v_claim_token,
        claim_version = coalesce(v_job.claim_version, 0) + 1,
        last_event_seq = v_next_seq,
        error_code = null,
        error_message = null,
        updated_at = now()
    where id = v_job.id;

  update public.chat_attachments
    set extraction_status = 'processing',
        extraction_stage = 'accepted',
        progress_percent = 5,
        last_event_seq = v_next_seq,
        extraction_error = null,
        error_code = null,
        error_message = null,
        updated_at = now()
    where id = v_job.attachment_id;

  if not found then
    raise exception 'document attachment % is missing', v_job.attachment_id;
  end if;

  return query select
    v_job.id,
    v_claim_token,
    now() + make_interval(secs => v_lease_seconds),
    'claimed'::text;
end;
$$;

create or replace function public.renew_document_ingestion_job_lease(
  p_job_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 1800);
  v_updated integer;
begin
  update public.document_ingestion_jobs as j
    set lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        updated_at = now()
    where j.id = p_job_id
      and j.claim_token = p_claim_token
      and j.status = 'processing'
      and j.lease_expires_at is not null
      and j.lease_expires_at > now();

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.advance_document_ingestion_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_stage text,
  p_progress_percent integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs%rowtype;
  v_next_seq bigint;
begin
  if p_stage not in ('accepted', 'extracting', 'chunking', 'embedding', 'indexing') then
    raise exception 'invalid non-terminal document ingestion stage: %', p_stage
      using errcode = '22023';
  end if;
  if p_progress_percent is null or p_progress_percent < 0 or p_progress_percent > 99 then
    raise exception 'progress_percent must be between 0 and 99'
      using errcode = '22023';
  end if;

  select j.*
    into v_job
    from public.document_ingestion_jobs as j
    where j.id = p_job_id
    for update;

  if not found
    or v_job.status <> 'processing'
    or v_job.claim_token is distinct from p_claim_token
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at <= now() then
    return false;
  end if;

  v_next_seq := coalesce(v_job.last_event_seq, 0) + 1;

  update public.chat_attachments
    set extraction_status = 'processing',
        extraction_stage = p_stage,
        progress_percent = p_progress_percent,
        last_event_seq = v_next_seq,
        updated_at = now()
    where id = v_job.attachment_id;

  if not found then
    return false;
  end if;

  update public.document_ingestion_jobs
    set status = 'processing',
        stage = p_stage,
        progress_percent = p_progress_percent,
        last_event_seq = v_next_seq,
        updated_at = now()
    where id = v_job.id;

  return true;
end;
$$;

create or replace function public.complete_document_ingestion_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_extracted_md text,
  p_source_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs%rowtype;
  v_attachment public.chat_attachments%rowtype;
  v_next_seq bigint;
  v_completed_at timestamptz := now();
begin
  if p_extracted_md is null then
    raise exception 'extracted markdown is required' using errcode = '22023';
  end if;
  if p_source_path is null or length(trim(p_source_path)) = 0 then
    raise exception 'source path is required' using errcode = '22023';
  end if;

  select j.*
    into v_job
    from public.document_ingestion_jobs as j
    where j.id = p_job_id
    for update;

  if not found
    or v_job.status <> 'processing'
    or v_job.claim_token is distinct from p_claim_token
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at <= now() then
    return false;
  end if;

  select a.*
    into v_attachment
    from public.chat_attachments as a
    where a.id = v_job.attachment_id
    for update;

  if not found
    or v_attachment.extraction_status = 'completed'
    or v_attachment.expires_at <= now()
    or v_attachment.original_path is distinct from p_source_path then
    return false;
  end if;

  v_next_seq := coalesce(v_job.last_event_seq, 0) + 1;

  update public.chat_attachments
    set extracted_md = p_extracted_md,
        extracted_char_count = char_length(p_extracted_md),
        extraction_status = 'completed',
        extraction_stage = 'completed',
        progress_percent = 100,
        last_event_seq = v_next_seq,
        extraction_error = null,
        error_code = null,
        error_message = null,
        updated_at = v_completed_at
    where id = v_attachment.id;

  update public.document_ingestion_jobs
    set status = 'completed',
        stage = 'completed',
        progress_percent = 100,
        last_event_seq = v_next_seq,
        completed_at = v_completed_at,
        lease_expires_at = null,
        error_code = null,
        error_message = null,
        updated_at = v_completed_at
    where id = v_job.id;

  perform public.enqueue_document_source_cleanup_intent(
    v_attachment.id,
    v_job.id,
    now()
  );

  return true;
end;
$$;

create or replace function public.fail_document_ingestion_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs%rowtype;
  v_attachment public.chat_attachments%rowtype;
  v_next_seq bigint;
  v_finished_at timestamptz := now();
  v_error_code text := left(coalesce(nullif(trim(p_error_code), ''), 'document_ingestion_failed'), 120);
  v_error_message text := left(coalesce(nullif(trim(p_error_message), ''), '문서 변환에 실패했습니다.'), 2000);
begin
  select j.*
    into v_job
    from public.document_ingestion_jobs as j
    where j.id = p_job_id
    for update;

  if not found
    or v_job.status <> 'processing'
    or v_job.claim_token is distinct from p_claim_token
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at <= now() then
    return false;
  end if;

  v_next_seq := coalesce(v_job.last_event_seq, 0) + 1;

  update public.chat_attachments
    set extraction_status = 'failed',
        extraction_stage = 'failed',
        last_event_seq = v_next_seq,
        error_code = v_error_code,
        error_message = v_error_message,
        extraction_error = v_error_message,
        updated_at = v_finished_at
    where id = v_job.attachment_id
    returning * into v_attachment;

  if not found then
    return false;
  end if;

  update public.document_ingestion_jobs
    set status = 'failed',
        stage = 'failed',
        last_event_seq = v_next_seq,
        completed_at = v_finished_at,
        lease_expires_at = null,
        error_code = v_error_code,
        error_message = v_error_message,
        updated_at = v_finished_at
    where id = v_job.id;

  perform public.enqueue_document_source_cleanup_intent(
    v_job.attachment_id,
    v_job.id,
    v_attachment.expires_at
  );

  return true;
end;
$$;

create or replace function public.claim_document_source_cleanup_job(
  p_worker_id text,
  p_lease_seconds integer
)
returns table (
  id uuid,
  attachment_id uuid,
  storage_kind text,
  source_path text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleanup public.document_source_cleanup_jobs%rowtype;
  v_claim_token uuid;
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 1800);
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;

  select c.*
    into v_cleanup
    from public.document_source_cleanup_jobs as c
    where (
      (
        c.status in ('pending', 'failed')
        and c.next_attempt_at <= now()
      )
      or (
        c.status = 'processing'
        and (c.lease_expires_at is null or c.lease_expires_at <= now())
      )
    )
      and c.attempts < c.max_attempts
    order by c.next_attempt_at asc, c.created_at asc, c.id asc
    limit 1
    for update skip locked;

  if not found then
    return;
  end if;

  v_claim_token := gen_random_uuid();

  update public.document_source_cleanup_jobs
    set status = 'processing',
        worker_id = p_worker_id,
        claim_token = v_claim_token,
        claim_version = coalesce(v_cleanup.claim_version, 0) + 1,
        attempts = v_cleanup.attempts + 1,
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        last_error = null,
        updated_at = now()
    where id = v_cleanup.id;

  return query select
    v_cleanup.id,
    v_cleanup.attachment_id,
    v_cleanup.storage_kind,
    v_cleanup.source_path,
    v_claim_token;
end;
$$;

create or replace function public.complete_document_source_cleanup_job(
  p_cleanup_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleanup public.document_source_cleanup_jobs%rowtype;
  v_completed_at timestamptz := now();
begin
  select c.*
    into v_cleanup
    from public.document_source_cleanup_jobs as c
    where c.id = p_cleanup_job_id
    for update;

  if not found
    or v_cleanup.status <> 'processing'
    or v_cleanup.claim_token is distinct from p_claim_token
    or v_cleanup.lease_expires_at is null
    or v_cleanup.lease_expires_at <= now() then
    return false;
  end if;

  update public.chat_attachments
    set original_path = case
          when original_path = v_cleanup.source_path then null
          else original_path
        end,
        original_object_path = case
          when original_object_path = v_cleanup.source_path then null
          else original_object_path
        end,
        updated_at = v_completed_at
    where id = v_cleanup.attachment_id;

  update public.document_source_cleanup_jobs
    set status = 'completed',
        lease_expires_at = null,
        completed_at = v_completed_at,
        last_error = null,
        updated_at = v_completed_at
    where id = v_cleanup.id;

  return true;
end;
$$;

create or replace function public.fail_document_source_cleanup_job(
  p_cleanup_job_id uuid,
  p_claim_token uuid,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleanup public.document_source_cleanup_jobs%rowtype;
  v_delay_seconds integer;
  v_error_message text := left(coalesce(nullif(trim(p_error_message), ''), '문서 원본 삭제에 실패했습니다.'), 2000);
begin
  select c.*
    into v_cleanup
    from public.document_source_cleanup_jobs as c
    where c.id = p_cleanup_job_id
    for update;

  if not found
    or v_cleanup.status <> 'processing'
    or v_cleanup.claim_token is distinct from p_claim_token
    or v_cleanup.lease_expires_at is null
    or v_cleanup.lease_expires_at <= now() then
    return false;
  end if;

  v_delay_seconds := least(
    300,
    power(2, least(v_cleanup.attempts, 8))::integer
  );

  update public.document_source_cleanup_jobs
    set status = case
          when v_cleanup.storage_kind = 'local_fs' then 'failed'
          else 'unsupported'
        end,
        lease_expires_at = null,
        next_attempt_at = case
          when v_cleanup.storage_kind <> 'local_fs' then now()
          when v_cleanup.attempts >= v_cleanup.max_attempts then now()
          else now() + make_interval(secs => v_delay_seconds)
        end,
        last_error = v_error_message,
        updated_at = now()
    where id = v_cleanup.id;

  return true;
end;
$$;

-- Override the original creation RPC with the currently supported storage
-- boundary. There is no object-store deletion adapter in this deployment, so
-- accepting object_storage here would create an uncleanable source object.
create or replace function public.create_document_ingestion_job(
  p_attachment_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_ticker text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_storage_kind text,
  p_original_path text,
  p_original_object_path text,
  p_content_hash text,
  p_expires_at timestamptz,
  p_queue_name text default 'document-ingestion'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attachment public.chat_attachments%rowtype;
  v_job public.document_ingestion_jobs%rowtype;
  v_queue_job_id text;
  v_payload jsonb;
begin
  if p_storage_kind is distinct from 'local_fs' then
    raise exception 'document ingestion currently supports only local_fs storage'
      using errcode = '22023';
  end if;

  insert into public.chat_attachments (
    id,
    user_id,
    session_id,
    ticker,
    file_name,
    mime_type,
    file_size,
    storage_kind,
    original_path,
    original_object_path,
    content_hash,
    extraction_status,
    extraction_stage,
    progress_percent,
    last_event_seq,
    expires_at
  )
  values (
    p_attachment_id,
    p_user_id,
    p_session_id,
    p_ticker,
    p_file_name,
    p_mime_type,
    p_file_size,
    'local_fs',
    p_original_path,
    coalesce(p_original_object_path, p_original_path),
    p_content_hash,
    'queued',
    'accepted',
    0,
    0,
    p_expires_at
  )
  returning * into v_attachment;

  insert into public.document_ingestion_jobs (
    attachment_id,
    status,
    stage,
    progress_percent,
    last_event_seq
  )
  values (
    v_attachment.id,
    'queued',
    'accepted',
    0,
    0
  )
  returning * into v_job;

  v_queue_job_id := 'document-ingestion:' || v_job.id::text;

  update public.document_ingestion_jobs
  set queue_job_id = v_queue_job_id
  where id = v_job.id
  returning * into v_job;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'jobId', v_job.id,
    'attachmentId', v_attachment.id,
    'userId', v_attachment.user_id,
    'storageKind', v_attachment.storage_kind,
    'originalPath', v_attachment.original_path,
    'originalObjectPath', v_attachment.original_object_path,
    'contentHash', v_attachment.content_hash
  );

  insert into public.document_job_outbox (
    job_id,
    queue_name,
    queue_job_id,
    payload_json
  )
  values (
    v_job.id,
    p_queue_name,
    v_queue_job_id,
    v_payload
  )
  on conflict (queue_name, queue_job_id)
  do update set
    payload_json = excluded.payload_json,
    status = case
      when public.document_job_outbox.status = 'dispatched' then 'dispatched'
      else 'pending'
    end,
    last_error = null;

  return jsonb_build_object(
    'attachment', to_jsonb(v_attachment),
    'job', to_jsonb(v_job),
    'queue_name', p_queue_name,
    'queue_job_id', v_queue_job_id
  );
end;
$$;

revoke all on function public.enqueue_document_source_cleanup_intent(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.enqueue_document_source_cleanup_on_terminal()
  from public, anon, authenticated;
revoke all on function public.enqueue_document_source_cleanup_on_attachment_terminal()
  from public, anon, authenticated;
revoke all on function public.reconcile_expired_document_attachment_cleanup(integer)
  from public, anon, authenticated;
revoke all on function public.create_document_ingestion_job(
  uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.claim_document_ingestion_job_v2(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_document_ingestion_job_by_id_v2(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.renew_document_ingestion_job_lease(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.advance_document_ingestion_job(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_document_ingestion_job(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_document_ingestion_job(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_document_source_cleanup_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_document_source_cleanup_job(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_document_source_cleanup_job(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_document_ingestion_job_v2(text, integer, integer)
  to service_role;
grant execute on function public.claim_document_ingestion_job_by_id_v2(uuid, text, integer, integer)
  to service_role;
grant execute on function public.renew_document_ingestion_job_lease(uuid, uuid, integer)
  to service_role;
grant execute on function public.advance_document_ingestion_job(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.complete_document_ingestion_job(uuid, uuid, text, text)
  to service_role;
grant execute on function public.fail_document_ingestion_job(uuid, uuid, text, text)
  to service_role;
grant execute on function public.reconcile_expired_document_attachment_cleanup(integer)
  to service_role;
grant execute on function public.claim_document_source_cleanup_job(text, integer)
  to service_role;
grant execute on function public.complete_document_source_cleanup_job(uuid, uuid)
  to service_role;
grant execute on function public.fail_document_source_cleanup_job(uuid, uuid, text)
  to service_role;
grant execute on function public.create_document_ingestion_job(
  uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, timestamptz, text
) to service_role;
