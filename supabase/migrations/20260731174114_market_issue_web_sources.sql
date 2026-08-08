begin;

create extension if not exists pgcrypto;
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Sources are no longer limited to an X account. Existing X rows retain their
-- account handle and acquire a stable generic source key.
alter table public.market_issue_sources
  add column if not exists source_key text,
  add column if not exists adapter_type text,
  add column if not exists channel_type text,
  add column if not exists discovery_url text,
  add column if not exists canonical_host text,
  add column if not exists poll_interval_seconds integer not null default 900,
  add column if not exists priority integer not null default 50,
  add column if not exists max_items_per_poll integer not null default 25,
  add column if not exists requires_browser boolean not null default false,
  add column if not exists adapter_config jsonb not null default '{}'::jsonb;

alter table public.market_issue_sources
  alter column account_handle drop not null;

update public.market_issue_sources
set source_key = coalesce(nullif(source_key, ''), nullif(account_handle, ''), id::text),
    adapter_type = coalesce(nullif(adapter_type, ''), case when source_type = 'x' then 'x_api' else 'rss' end),
    channel_type = coalesce(nullif(channel_type, ''), case when source_type = 'x' then 'social' else 'newsroom' end),
    canonical_host = coalesce(nullif(canonical_host, ''), case when source_type = 'x' then 'x.com' else null end)
where source_key is null
   or source_key = ''
   or adapter_type is null
   or adapter_type = ''
   or channel_type is null
   or channel_type = '';

alter table public.market_issue_sources
  alter column source_key set not null,
  alter column adapter_type set not null,
  alter column channel_type set not null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.market_issue_sources'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source_type%'
  loop
    execute format('alter table public.market_issue_sources drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table public.market_issue_sources
  add constraint market_issue_sources_source_type_check
  check (source_type in ('x', 'web', 'sec'));

alter table public.market_issue_sources
  add constraint market_issue_sources_poll_interval_check
  check (poll_interval_seconds between 60 and 86400),
  add constraint market_issue_sources_priority_check
  check (priority between 1 and 100),
  add constraint market_issue_sources_max_items_check
  check (max_items_per_poll between 1 and 100);

create unique index if not exists market_issue_sources_env_type_source_key_key
  on public.market_issue_sources (env, source_type, source_key);

create index if not exists market_issue_sources_web_poll_idx
  on public.market_issue_sources (env, active, priority desc, updated_at desc)
  where source_type in ('web', 'sec');

alter table public.market_source_items
  add column if not exists canonical_url_hash text,
  add column if not exists related_url_hashes text[] not null default '{}'::text[],
  add column if not exists title text,
  add column if not exists content_kind text,
  add column if not exists discovered_at timestamptz,
  add column if not exists fetched_at timestamptz,
  add column if not exists extraction_method text,
  add column if not exists extraction_confidence numeric(4,3),
  add column if not exists published_at_is_inferred boolean not null default false,
  add column if not exists signal_level text,
  add column if not exists signal_reason text,
  add column if not exists event_type_hint text;

update public.market_source_items
set canonical_url_hash = encode(digest(lower(trim(canonical_url)), 'sha256'), 'hex')
where canonical_url is not null
  and canonical_url_hash is null;

create index if not exists market_source_items_canonical_url_hash_idx
  on public.market_source_items (canonical_url_hash)
  where canonical_url_hash is not null;

create index if not exists market_source_items_related_url_hashes_idx
  on public.market_source_items using gin (related_url_hashes);

create index if not exists market_source_items_source_published_idx
  on public.market_source_items (source_id, published_at desc nulls last);

alter table public.market_issue_items
  add column if not exists relation_type text not null default 'primary',
  add column if not exists correlation_method text,
  add column if not exists correlation_confidence numeric(4,3),
  add column if not exists evidence_locator jsonb not null default '{}'::jsonb,
  add column if not exists evidence_rank integer not null default 100,
  add column if not exists is_primary boolean not null default false,
  add column if not exists attached_at timestamptz not null default now();

alter table public.market_issue_items
  add constraint market_issue_items_relation_type_check
  check (relation_type in ('primary', 'corroborating', 'related', 'duplicate'));

create index if not exists market_issue_items_issue_evidence_idx
  on public.market_issue_items (issue_id, is_primary desc, evidence_rank asc, attached_at asc);

create table if not exists public.market_source_fetch_states (
  source_id uuid primary key references public.market_issue_sources(id) on delete cascade,
  etag text,
  last_modified text,
  latest_published_at timestamptz,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  next_poll_at timestamptz not null default now(),
  failure_count integer not null default 0 check (failure_count >= 0),
  last_status_code integer,
  last_error text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists market_source_fetch_states_due_idx
  on public.market_source_fetch_states (next_poll_at asc);

create table if not exists public.market_source_candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.market_issue_sources(id) on delete cascade,
  candidate_url text not null,
  candidate_url_hash text not null,
  title text,
  published_at timestamptz,
  published_at_is_inferred boolean not null default false,
  discovered_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'processing', 'fetched', 'ignored', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  last_error text,
  raw_candidate jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, candidate_url_hash)
);

create index if not exists market_source_candidates_pending_idx
  on public.market_source_candidates (source_id, status, discovered_at desc);

create table if not exists public.market_source_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.market_issue_sources(id) on delete cascade,
  candidate_id uuid references public.market_source_candidates(id) on delete set null,
  phase text not null check (phase in ('discovery', 'detail')),
  worker_id text,
  request_url text not null,
  status text not null check (status in ('started', 'not_modified', 'succeeded', 'skipped', 'failed')),
  http_status integer,
  extraction_method text,
  response_bytes integer,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists market_source_fetch_runs_source_created_idx
  on public.market_source_fetch_runs (source_id, created_at desc);

create table if not exists public.market_worker_dead_letters (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('dev', 'staging', 'prod')),
  queue_kind text not null check (queue_kind in ('poll', 'detail', 'correlate')),
  queue_message_id bigint,
  payload jsonb not null,
  error_code text,
  error_message text,
  failed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);

create index if not exists market_worker_dead_letters_open_idx
  on public.market_worker_dead_letters (environment, queue_kind, failed_at desc)
  where resolved_at is null;

create table if not exists public.market_issue_source_entities (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references public.market_issues(id) on delete cascade,
  source_item_id uuid references public.market_source_items(id) on delete cascade,
  entity_type text not null check (entity_type in ('ticker', 'company', 'regulator', 'person', 'product', 'topic')),
  canonical_value text not null,
  display_value text,
  confidence numeric(4,3),
  source text not null default 'adapter',
  created_at timestamptz not null default now(),
  unique (issue_id, source_item_id, entity_type, canonical_value)
);

create index if not exists market_issue_source_entities_lookup_idx
  on public.market_issue_source_entities (entity_type, canonical_value);

alter table public.market_issue_settings
  add column if not exists worker_webhook_url text,
  add column if not exists worker_webhook_secret_name text;

alter table public.market_source_fetch_states enable row level security;
alter table public.market_source_candidates enable row level security;
alter table public.market_source_fetch_runs enable row level security;
alter table public.market_worker_dead_letters enable row level security;
alter table public.market_issue_source_entities enable row level security;

grant all privileges on table public.market_source_fetch_states to service_role;
grant all privileges on table public.market_source_candidates to service_role;
grant all privileges on table public.market_source_fetch_runs to service_role;
grant all privileges on table public.market_worker_dead_letters to service_role;
grant all privileges on table public.market_issue_source_entities to service_role;

create or replace function public.market_issue_queue_name(
  p_environment text,
  p_queue_kind text
)
returns text
language plpgsql
immutable
as $$
begin
  if p_environment not in ('dev', 'staging', 'prod') then
    raise exception 'invalid market issue environment: %', p_environment;
  end if;

  if p_queue_kind not in ('poll', 'detail', 'correlate') then
    raise exception 'invalid market issue queue kind: %', p_queue_kind;
  end if;

  return format('market_source_%s_%s', p_queue_kind, p_environment);
end;
$$;

do $$
declare
  queue_name text;
begin
  foreach queue_name in array array[
    'market_source_poll_dev', 'market_source_detail_dev', 'market_source_correlate_dev',
    'market_source_poll_staging', 'market_source_detail_staging', 'market_source_correlate_staging',
    'market_source_poll_prod', 'market_source_detail_prod', 'market_source_correlate_prod'
  ]
  loop
    perform pgmq.create(queue_name);
  end loop;
end;
$$;

create or replace function public.enqueue_market_issue_queue_message(
  p_environment text,
  p_queue_kind text,
  p_message jsonb,
  p_delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return pgmq.send(
    public.market_issue_queue_name(p_environment, p_queue_kind),
    p_message,
    greatest(coalesce(p_delay_seconds, 0), 0)
  );
end;
$$;

create or replace function public.claim_market_issue_queue_messages(
  p_environment text,
  p_queue_kind text,
  p_visibility_seconds integer default 300,
  p_quantity integer default 10
)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select queue_message.msg_id,
         queue_message.read_ct,
         queue_message.enqueued_at,
         queue_message.vt,
         queue_message.message
  from pgmq.read(
    public.market_issue_queue_name(p_environment, p_queue_kind),
    greatest(coalesce(p_visibility_seconds, 300), 30),
    greatest(least(coalesce(p_quantity, 10), 100), 1)
  ) as queue_message;
end;
$$;

create or replace function public.ack_market_issue_queue_message(
  p_environment text,
  p_queue_kind text,
  p_message_id bigint
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select pgmq.archive(public.market_issue_queue_name(p_environment, p_queue_kind), p_message_id);
$$;

create or replace function public.archive_market_issue_queue_message(
  p_environment text,
  p_queue_kind text,
  p_message_id bigint
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select pgmq.archive(public.market_issue_queue_name(p_environment, p_queue_kind), p_message_id);
$$;

create or replace function public.enqueue_due_market_issue_web_sources(
  p_environment text,
  p_limit integer default 20
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_row record;
  claimed_source_id uuid;
  queued_count integer := 0;
begin
  for source_row in
    select s.id, s.poll_interval_seconds
    from public.market_issue_sources s
    left join public.market_source_fetch_states fs on fs.source_id = s.id
    where s.env = p_environment
      and s.active = true
      and s.source_type in ('web', 'sec')
      and coalesce(fs.next_poll_at, now()) <= now()
    order by s.priority desc, coalesce(fs.next_poll_at, now()) asc
    limit greatest(least(coalesce(p_limit, 20), 100), 1)
  loop
    claimed_source_id := null;

    insert into public.market_source_fetch_states (
      source_id,
      last_attempt_at,
      next_poll_at,
      updated_at
    )
    values (
      source_row.id,
      now(),
      now() + make_interval(secs => source_row.poll_interval_seconds),
      now()
    )
    on conflict (source_id) do update
      set last_attempt_at = excluded.last_attempt_at,
          next_poll_at = excluded.next_poll_at,
          updated_at = excluded.updated_at
      where public.market_source_fetch_states.next_poll_at <= now()
    returning source_id into claimed_source_id;

    if claimed_source_id is not null then
      perform public.enqueue_market_issue_queue_message(
        p_environment,
        'poll',
        jsonb_build_object('job_type', 'poll', 'source_id', claimed_source_id)
      );
      queued_count := queued_count + 1;
    end if;
  end loop;

  return queued_count;
end;
$$;

create or replace function public.dispatch_market_issue_web_sources(
  p_environment text default 'prod'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  queued_count integer;
  settings_row record;
  webhook_secret text;
  timestamp_text text;
  signature text;
begin
  queued_count := public.enqueue_due_market_issue_web_sources(p_environment, 20);

  select worker_webhook_url, worker_webhook_secret_name
  into settings_row
  from public.market_issue_settings
  where env = p_environment
  limit 1;

  if queued_count = 0
     or settings_row.worker_webhook_url is null
     or settings_row.worker_webhook_secret_name is null then
    return queued_count;
  end if;

  select decrypted_secret
  into webhook_secret
  from vault.decrypted_secrets
  where name = settings_row.worker_webhook_secret_name
  limit 1;

  if webhook_secret is null then
    return queued_count;
  end if;

  timestamp_text := floor(extract(epoch from clock_timestamp()))::bigint::text;
  signature := encode(
    hmac(timestamp_text || '.' || p_environment || '.20', webhook_secret, 'sha256'),
    'hex'
  );

  perform net.http_post(
    url := settings_row.worker_webhook_url,
    body := jsonb_build_object('environment', p_environment, 'max_jobs', 20),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-krw-environment', p_environment,
      'x-krw-timestamp', timestamp_text,
      'x-krw-max-jobs', '20',
      'x-krw-signature', signature
    ),
    timeout_milliseconds := 10000
  );

  return queued_count;
end;
$$;

revoke all on function public.enqueue_market_issue_queue_message(text, text, jsonb, integer) from public;
revoke all on function public.claim_market_issue_queue_messages(text, text, integer, integer) from public;
revoke all on function public.ack_market_issue_queue_message(text, text, bigint) from public;
revoke all on function public.archive_market_issue_queue_message(text, text, bigint) from public;
revoke all on function public.enqueue_due_market_issue_web_sources(text, integer) from public;
revoke all on function public.dispatch_market_issue_web_sources(text) from public;

grant execute on function public.enqueue_market_issue_queue_message(text, text, jsonb, integer) to service_role;
grant execute on function public.claim_market_issue_queue_messages(text, text, integer, integer) to service_role;
grant execute on function public.ack_market_issue_queue_message(text, text, bigint) to service_role;
grant execute on function public.archive_market_issue_queue_message(text, text, bigint) to service_role;
grant execute on function public.enqueue_due_market_issue_web_sources(text, integer) to service_role;
grant execute on function public.dispatch_market_issue_web_sources(text) to service_role;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'market-issue-web-source-dispatch-prod'
  ) then
    perform cron.schedule(
      'market-issue-web-source-dispatch-prod',
      '* * * * *',
      'select public.dispatch_market_issue_web_sources(''prod'');'
    );
  end if;
end;
$$;

commit;
