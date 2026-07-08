-- Prepare document ingestion for BullMQ delivery while keeping Postgres as the
-- canonical reload-recovery state and enqueue outbox.

alter table public.chat_attachments
  add column if not exists original_object_path text,
  add column if not exists extracted_object_path text,
  add column if not exists chunks_object_path text,
  add column if not exists content_hash text,
  add column if not exists extraction_stage text not null default 'accepted',
  add column if not exists progress_percent integer not null default 0,
  add column if not exists last_event_seq bigint not null default 0,
  add column if not exists error_code text,
  add column if not exists error_message text;

update public.chat_attachments
set original_object_path = original_path
where original_object_path is null
  and original_path is not null;

alter table public.chat_attachments
  drop constraint if exists chat_attachments_status_check,
  drop constraint if exists chat_attachments_storage_kind_check,
  drop constraint if exists chat_attachments_extraction_stage_check,
  drop constraint if exists chat_attachments_progress_percent_check,
  add constraint chat_attachments_status_check
    check (
      extraction_status in (
        'uploaded',
        'queued',
        'processing',
        'completed',
        'failed',
        'cancelled',
        'expired'
      )
    ),
  add constraint chat_attachments_storage_kind_check
    check (storage_kind in ('local_fs', 'object_storage')),
  add constraint chat_attachments_extraction_stage_check
    check (
      extraction_stage in (
        'accepted',
        'extracting',
        'chunking',
        'embedding',
        'indexing',
        'completed',
        'failed'
      )
    ),
  add constraint chat_attachments_progress_percent_check
    check (progress_percent between 0 and 100);

alter table public.document_ingestion_jobs
  add column if not exists stage text not null default 'accepted',
  add column if not exists progress_percent integer not null default 0,
  add column if not exists last_event_seq bigint not null default 0,
  add column if not exists queue_job_id text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists error_code text;

alter table public.document_ingestion_jobs
  alter column max_attempts set default 3;

alter table public.document_ingestion_jobs
  drop constraint if exists document_ingestion_jobs_status_check,
  drop constraint if exists document_ingestion_jobs_stage_check,
  drop constraint if exists document_ingestion_jobs_progress_percent_check,
  add constraint document_ingestion_jobs_status_check
    check (status in ('queued', 'running', 'processing', 'completed', 'failed', 'cancelled')),
  add constraint document_ingestion_jobs_stage_check
    check (
      stage in (
        'accepted',
        'extracting',
        'chunking',
        'embedding',
        'indexing',
        'completed',
        'failed'
      )
    ),
  add constraint document_ingestion_jobs_progress_percent_check
    check (progress_percent between 0 and 100);

create unique index if not exists idx_document_ingestion_jobs_queue_job_id
  on public.document_ingestion_jobs (queue_job_id)
  where queue_job_id is not null;

create table if not exists public.document_job_outbox (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.document_ingestion_jobs(id) on delete cascade,
  queue_name text not null,
  queue_job_id text not null,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  dispatched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_job_outbox_status_check
    check (status in ('pending', 'dispatched', 'failed')),
  constraint document_job_outbox_attempts_check
    check (attempts >= 0),
  constraint document_job_outbox_last_error_length
    check (last_error is null or char_length(last_error) <= 2000)
);

create unique index if not exists idx_document_job_outbox_queue_job_id
  on public.document_job_outbox (queue_name, queue_job_id);

create index if not exists idx_document_job_outbox_pending
  on public.document_job_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

drop trigger if exists trg_document_job_outbox_updated_at on public.document_job_outbox;
create trigger trg_document_job_outbox_updated_at
  before update on public.document_job_outbox
  for each row
  execute function public.set_updated_at();

alter table public.document_job_outbox enable row level security;

revoke all on table public.document_job_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.document_job_outbox to service_role;

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
  if p_storage_kind not in ('local_fs', 'object_storage') then
    raise exception 'unsupported document storage kind: %', p_storage_kind
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
    p_storage_kind,
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

revoke all on function public.create_document_ingestion_job(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  text,
  timestamptz,
  text
) from public, anon, authenticated;
grant execute on function public.create_document_ingestion_job(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  text,
  timestamptz,
  text
) to service_role;
