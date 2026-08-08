-- Preserve source-media extraction separately from the public market issue.
-- These records are service-role-only and are consumed by the internal Feed MCP.

create table if not exists public.market_source_media (
  id uuid primary key default gen_random_uuid(),
  env text not null,
  source_item_id uuid not null references public.market_source_items(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0 and ordinal <= 32),
  x_media_key text,
  media_type text not null default 'unknown',
  media_url text,
  source_url_hash text,
  content_hash text,
  mime_type text,
  width integer,
  height integer,
  alt_text text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'ready', 'failed', 'skipped')),
  extraction_model text,
  extraction_prompt_version text,
  extraction_payload jsonb not null default '{}'::jsonb,
  extraction_confidence numeric,
  extraction_error text,
  extraction_attempt_count integer not null default 0,
  extraction_started_at timestamptz,
  extraction_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_item_id, ordinal)
);

create index if not exists market_source_media_source_item_idx
  on public.market_source_media (source_item_id, ordinal);
create index if not exists market_source_media_pending_idx
  on public.market_source_media (env, extraction_status, created_at);
create index if not exists market_source_media_content_hash_idx
  on public.market_source_media (env, content_hash)
  where content_hash is not null;

create table if not exists public.market_issue_research_packets (
  id uuid primary key default gen_random_uuid(),
  env text not null,
  issue_id uuid not null references public.market_issues(id) on delete cascade,
  version integer not null check (version > 0),
  source_context_hash text not null,
  status text not null default 'ready'
    check (status in ('ready', 'partial', 'failed', 'superseded')),
  composer_model text,
  composer_prompt_version text,
  payload jsonb not null default '{}'::jsonb,
  source_material_count integer not null default 0,
  image_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, version),
  unique (issue_id, source_context_hash)
);

create index if not exists market_issue_research_packets_issue_idx
  on public.market_issue_research_packets (issue_id, created_at desc);

create table if not exists public.market_issue_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  env text not null,
  issue_id uuid not null references public.market_issues(id) on delete cascade,
  source_context_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'retry', 'succeeded', 'blocked', 'failed', 'superseded')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_by text,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, source_context_hash)
);

create index if not exists market_issue_enrichment_jobs_claim_idx
  on public.market_issue_enrichment_jobs (env, status, available_at, created_at);

alter table public.market_issues
  add column if not exists active_research_packet_id uuid,
  add column if not exists research_packet_status text,
  add column if not exists research_packet_updated_at timestamptz,
  add column if not exists research_source_context_hash text;

alter table public.market_issues
  drop constraint if exists market_issues_active_research_packet_id_fkey;
alter table public.market_issues
  add constraint market_issues_active_research_packet_id_fkey
  foreign key (active_research_packet_id)
  references public.market_issue_research_packets(id)
  on delete set null;

alter table public.market_issues
  drop constraint if exists market_issues_research_packet_status_check;
alter table public.market_issues
  add constraint market_issues_research_packet_status_check
  check (
    research_packet_status is null
    or research_packet_status in ('pending', 'running', 'ready', 'partial', 'failed', 'blocked')
  );

create or replace function public.claim_market_issue_enrichment_job(
  p_env text,
  p_worker_id text,
  p_lease_seconds integer default 180
)
returns setof public.market_issue_enrichment_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.market_issue_enrichment_jobs;
begin
  with candidate as (
    select id
    from public.market_issue_enrichment_jobs
    where env = p_env
      and available_at <= now()
      and (
        status in ('pending', 'retry')
        or (status = 'running' and lease_expires_at < now())
      )
    order by available_at asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.market_issue_enrichment_jobs as job
  set status = 'running',
      claimed_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))),
      attempt_count = job.attempt_count + 1,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.* into claimed;

  if not found then
    return;
  end if;

  return next claimed;
end;
$$;

alter table public.market_source_media enable row level security;
alter table public.market_issue_research_packets enable row level security;
alter table public.market_issue_enrichment_jobs enable row level security;

revoke all on table
  public.market_source_media,
  public.market_issue_research_packets,
  public.market_issue_enrichment_jobs
from anon, authenticated, public;

grant select, insert, update, delete on table
  public.market_source_media,
  public.market_issue_research_packets,
  public.market_issue_enrichment_jobs
to service_role;

revoke all on function public.claim_market_issue_enrichment_job(text, text, integer)
from public, anon, authenticated;
grant execute on function public.claim_market_issue_enrichment_job(text, text, integer)
to service_role;
