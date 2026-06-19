-- Ephemeral document attachments for chat questions.
-- Original uploads live only on the application server filesystem and are
-- deleted after conversion; the extracted Markdown is kept for the chat run.

create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.chat_sessions(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  ticker text,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  storage_kind text not null default 'local_fs',
  original_path text,
  extracted_md text,
  extracted_char_count integer,
  extraction_status text not null default 'queued',
  extraction_error text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_attachments_file_size_check
    check (file_size > 0),
  constraint chat_attachments_extracted_char_count_check
    check (extracted_char_count is null or extracted_char_count >= 0),
  constraint chat_attachments_status_check
    check (extraction_status in ('queued', 'processing', 'completed', 'failed', 'expired')),
  constraint chat_attachments_storage_kind_check
    check (storage_kind in ('local_fs'))
);

create index if not exists idx_chat_attachments_user_created
  on public.chat_attachments (user_id, created_at desc);

create index if not exists idx_chat_attachments_message
  on public.chat_attachments (message_id, created_at asc)
  where message_id is not null;

create index if not exists idx_chat_attachments_status_expires
  on public.chat_attachments (extraction_status, expires_at);

drop trigger if exists trg_chat_attachments_updated_at on public.chat_attachments;
create trigger trg_chat_attachments_updated_at
  before update on public.chat_attachments
  for each row
  execute function public.set_updated_at();

alter table public.chat_attachments enable row level security;

revoke all on table public.chat_attachments from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_attachments to service_role;

create table if not exists public.document_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.chat_attachments(id) on delete cascade,
  status text not null default 'queued',
  worker_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_ingestion_jobs_status_check
    check (status in ('queued', 'running', 'completed', 'failed')),
  constraint document_ingestion_jobs_attempts_check
    check (attempts >= 0 and max_attempts >= 1),
  constraint document_ingestion_jobs_error_message_length
    check (error_message is null or char_length(error_message) <= 2000)
);

create index if not exists idx_document_ingestion_jobs_queue
  on public.document_ingestion_jobs (status, queued_at, id);

create index if not exists idx_document_ingestion_jobs_attachment
  on public.document_ingestion_jobs (attachment_id);

drop trigger if exists trg_document_ingestion_jobs_updated_at on public.document_ingestion_jobs;
create trigger trg_document_ingestion_jobs_updated_at
  before update on public.document_ingestion_jobs
  for each row
  execute function public.set_updated_at();

alter table public.document_ingestion_jobs enable row level security;

revoke all on table public.document_ingestion_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.document_ingestion_jobs to service_role;

create or replace function public.claim_document_ingestion_job(
  p_worker_id text,
  p_lease_seconds integer,
  p_global_limit integer
)
returns table(id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with running_count as (
    select count(*)::integer as value
    from public.document_ingestion_jobs
    where status = 'running'
      and lease_expires_at > now()
  ),
  candidate as (
    select j.id
    from public.document_ingestion_jobs as j
    cross join running_count
    where running_count.value < p_global_limit
      and (
        j.status = 'queued'
        or (j.status = 'running' and j.lease_expires_at <= now())
      )
      and j.attempts < j.max_attempts
    order by j.queued_at asc, j.id asc
    limit 1
    for update skip locked
  ),
  claimed as (
    update public.document_ingestion_jobs as j
    set
      status = 'running',
      worker_id = p_worker_id,
      attempts = j.attempts + 1,
      started_at = coalesce(j.started_at, now()),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
    from candidate
    where j.id = candidate.id
    returning j.id, j.attachment_id
  ),
  attachment_update as (
    update public.chat_attachments as a
    set
      extraction_status = 'processing',
      updated_at = now()
    from claimed
    where a.id = claimed.attachment_id
    returning a.id
  )
  select claimed.id
  from claimed;
end;
$$;

revoke all on function public.claim_document_ingestion_job(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_document_ingestion_job(text, integer, integer)
  to service_role;

create or replace function public.notify_document_ingestion_job_queued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'queued' then
    return new;
  end if;

  if tg_op = 'INSERT' or old.status is distinct from new.status then
    perform pg_notify('document_ingestion_job_queued', new.id::text);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_document_ingestion_job_queued
  on public.document_ingestion_jobs;
create trigger trg_notify_document_ingestion_job_queued
  after insert or update of status
  on public.document_ingestion_jobs
  for each row
  execute function public.notify_document_ingestion_job_queued();

revoke all on function public.notify_document_ingestion_job_queued()
  from public, anon, authenticated;
