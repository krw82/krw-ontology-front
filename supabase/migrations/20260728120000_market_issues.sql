-- Separate market-issue domain. Raw social posts are never exposed through
-- client RLS; the web API serves a reviewed public projection instead.

create table if not exists public.market_issue_settings (
  env text primary key check (env in ('dev', 'staging', 'prod')),
  feed_enabled boolean not null default false,
  ingestion_enabled boolean not null default false,
  manual_review_required boolean not null default true,
  max_published_per_day integer not null default 20
    check (max_published_per_day between 1 and 100),
  last_ingestion_at timestamptz,
  last_successful_ingestion_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.market_issue_feed_revisions (
  env text primary key check (env in ('dev', 'staging', 'prod')),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_issue_sources (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  source_type text not null default 'x' check (source_type in ('x')),
  account_handle text not null,
  display_name text not null,
  source_class text not null check (
    source_class in (
      'government',
      'regulator',
      'company_official',
      'exchange',
      'registered_media',
      'journalist',
      'expert'
    )
  ),
  source_tags text[] not null default '{}'::text[],
  active boolean not null default true,
  allow_single_source_publish boolean not null default false,
  last_collected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (env, source_type, account_handle)
);

create table if not exists public.market_source_items (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  source_id uuid not null references public.market_issue_sources(id) on delete cascade,
  external_item_id text not null,
  canonical_url text not null,
  original_text text not null,
  language text,
  normalized_text_hash text not null,
  public_metrics jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  published_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  deleted_at timestamptz,
  status text not null default 'active' check (status in ('active', 'deleted', 'withheld')),
  unique (env, source_id, external_item_id)
);

create index if not exists idx_market_source_items_source_published
  on public.market_source_items (env, source_id, published_at desc);
create index if not exists idx_market_source_items_hash
  on public.market_source_items (env, normalized_text_hash);

create table if not exists public.market_issues (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  event_key text not null,
  state text not null default 'review'
    check (state in ('draft', 'review', 'published', 'hidden', 'archived')),
  summary_status text not null default 'pending'
    check (summary_status in ('pending', 'ready', 'failed')),
  title_ko text not null,
  summary_ko text not null default '',
  impact_path text[] not null default '{}'::text[],
  confirmed_facts text[] not null default '{}'::text[],
  unconfirmed_facts text[] not null default '{}'::text[],
  status_labels text[] not null default '{}'::text[],
  source_summary jsonb not null default '{}'::jsonb,
  source_count integer not null default 0 check (source_count >= 0),
  market_score numeric not null default 0,
  risk_level text not null default 'medium'
    check (risk_level in ('low', 'medium', 'high')),
  requires_manual_review boolean not null default true,
  update_count integer not null default 0 check (update_count >= 0),
  first_observed_at timestamptz not null default now(),
  published_at timestamptz,
  last_published_at timestamptz,
  merged_into_issue_id uuid references public.market_issues(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (env, event_key)
);

create index if not exists idx_market_issues_public_feed
  on public.market_issues (
    env,
    state,
    market_score desc,
    last_published_at desc nulls last,
    updated_at desc
  )
  where state = 'published';
create index if not exists idx_market_issues_review_queue
  on public.market_issues (env, state, risk_level desc, updated_at asc)
  where state in ('draft', 'review');

create table if not exists public.market_issue_items (
  issue_id uuid not null references public.market_issues(id) on delete cascade,
  source_item_id uuid not null references public.market_source_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, source_item_id)
);

create table if not exists public.market_issue_entities (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.market_issues(id) on delete cascade,
  entity_type text not null default 'company'
    check (entity_type in ('company', 'industry', 'theme')),
  ticker text,
  entity_name text not null,
  relationship text not null
    check (relationship in ('direct', 'supply_chain', 'customer', 'competitor', 'industry', 'theme')),
  relationship_reason text not null default '',
  confidence numeric not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_market_issue_entity
  on public.market_issue_entities (
    issue_id,
    entity_type,
    coalesce(ticker, ''),
    entity_name,
    relationship
  );
create index if not exists idx_market_issue_entities_ticker
  on public.market_issue_entities (ticker, issue_id)
  where ticker is not null;

create table if not exists public.market_issue_rank_snapshots (
  id bigint generated always as identity primary key,
  env text not null check (env in ('dev', 'staging', 'prod')),
  issue_id uuid not null references public.market_issues(id) on delete cascade,
  market_score numeric not null,
  captured_at timestamptz not null default now()
);

create index if not exists idx_market_issue_rank_snapshots_issue
  on public.market_issue_rank_snapshots (env, issue_id, captured_at desc);

create table if not exists public.market_issue_ingestion_cursors (
  env text not null check (env in ('dev', 'staging', 'prod')),
  source_id uuid not null references public.market_issue_sources(id) on delete cascade,
  cursor_value text,
  last_successful_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (env, source_id)
);

create table if not exists public.market_issue_user_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  issue_id uuid not null references public.market_issues(id) on delete cascade,
  opened_at timestamptz,
  last_seen_at timestamptz,
  is_saved boolean not null default false,
  is_hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, issue_id)
);

create index if not exists idx_market_issue_user_states_user
  on public.market_issue_user_states (user_id, is_hidden, is_saved, updated_at desc);

create table if not exists public.market_issue_user_company_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (
    ticker = upper(ticker) and char_length(trim(ticker)) between 1 and 16
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

create table if not exists public.market_issue_admin_actions (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('dev', 'staging', 'prod')),
  issue_id uuid references public.market_issues(id) on delete set null,
  source_id uuid references public.market_issue_sources(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (
    action in ('publish', 'hide', 'review', 'edit', 'merge', 'reprocess', 'source_update', 'settings_update')
  ),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_market_issue_admin_actions_issue
  on public.market_issue_admin_actions (issue_id, created_at desc);

create table if not exists public.market_issue_events (
  id bigint generated always as identity primary key,
  env text not null check (env in ('dev', 'staging', 'prod')),
  user_id uuid not null references auth.users(id) on delete cascade,
  issue_id uuid references public.market_issues(id) on delete set null,
  event_name text not null check (
    event_name in (
      'news_tab_viewed',
      'market_issue_opened',
      'market_issue_source_opened',
      'market_issue_research_draft_opened',
      'market_issue_research_submitted',
      'market_issue_saved',
      'market_issue_hidden',
      'market_issue_company_followed'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_market_issue_events_user_created
  on public.market_issue_events (user_id, created_at desc);
create index if not exists idx_market_issue_events_issue_created
  on public.market_issue_events (issue_id, created_at desc);

insert into public.market_issue_settings (env)
values ('dev'), ('staging'), ('prod')
on conflict (env) do nothing;

insert into public.market_issue_feed_revisions (env)
values ('dev'), ('staging'), ('prod')
on conflict (env) do nothing;

create or replace function public.bump_market_issue_feed_revision(p_env text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
begin
  if lower(trim(coalesce(p_env, ''))) not in ('dev', 'staging', 'prod') then
    raise exception 'invalid market issue env';
  end if;

  insert into public.market_issue_feed_revisions as revision (env, revision, updated_at)
  values (lower(trim(p_env)), 1, now())
  on conflict (env) do update
  set revision = revision.revision + 1,
      updated_at = now()
  returning revision.revision into v_revision;

  return v_revision;
end;
$$;

create or replace function public.touch_market_issue_feed_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text;
begin
  if TG_OP = 'DELETE' then
    v_env := old.env;
  else
    v_env := new.env;
  end if;
  if v_env is not null then
    perform public.bump_market_issue_feed_revision(v_env);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists market_issue_feed_revision_trigger on public.market_issues;
create trigger market_issue_feed_revision_trigger
after insert or update or delete on public.market_issues
for each row execute function public.touch_market_issue_feed_revision();

alter table public.market_issue_settings enable row level security;
alter table public.market_issue_feed_revisions enable row level security;
alter table public.market_issue_sources enable row level security;
alter table public.market_source_items enable row level security;
alter table public.market_issues enable row level security;
alter table public.market_issue_items enable row level security;
alter table public.market_issue_entities enable row level security;
alter table public.market_issue_rank_snapshots enable row level security;
alter table public.market_issue_ingestion_cursors enable row level security;
alter table public.market_issue_user_states enable row level security;
alter table public.market_issue_user_company_follows enable row level security;
alter table public.market_issue_admin_actions enable row level security;
alter table public.market_issue_events enable row level security;

drop policy if exists "market issue users read own state" on public.market_issue_user_states;
create policy "market issue users read own state"
  on public.market_issue_user_states for select
  using (user_id = auth.uid());

drop policy if exists "market issue users insert own state" on public.market_issue_user_states;
create policy "market issue users insert own state"
  on public.market_issue_user_states for insert
  with check (user_id = auth.uid());

drop policy if exists "market issue users update own state" on public.market_issue_user_states;
create policy "market issue users update own state"
  on public.market_issue_user_states for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "market issue users delete own state" on public.market_issue_user_states;
create policy "market issue users delete own state"
  on public.market_issue_user_states for delete
  using (user_id = auth.uid());

drop policy if exists "market issue users read own follows" on public.market_issue_user_company_follows;
create policy "market issue users read own follows"
  on public.market_issue_user_company_follows for select
  using (user_id = auth.uid());

drop policy if exists "market issue users insert own follows" on public.market_issue_user_company_follows;
create policy "market issue users insert own follows"
  on public.market_issue_user_company_follows for insert
  with check (user_id = auth.uid());

drop policy if exists "market issue users update own follows" on public.market_issue_user_company_follows;
create policy "market issue users update own follows"
  on public.market_issue_user_company_follows for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "market issue users delete own follows" on public.market_issue_user_company_follows;
create policy "market issue users delete own follows"
  on public.market_issue_user_company_follows for delete
  using (user_id = auth.uid());

revoke all on table
  public.market_issue_settings,
  public.market_issue_feed_revisions,
  public.market_issue_sources,
  public.market_source_items,
  public.market_issues,
  public.market_issue_items,
  public.market_issue_entities,
  public.market_issue_rank_snapshots,
  public.market_issue_ingestion_cursors,
  public.market_issue_admin_actions,
  public.market_issue_events
from anon, authenticated, public;

grant select, insert, update, delete on table
  public.market_issue_settings,
  public.market_issue_feed_revisions,
  public.market_issue_sources,
  public.market_source_items,
  public.market_issues,
  public.market_issue_items,
  public.market_issue_entities,
  public.market_issue_rank_snapshots,
  public.market_issue_ingestion_cursors,
  public.market_issue_user_states,
  public.market_issue_user_company_follows,
  public.market_issue_admin_actions,
  public.market_issue_events
to service_role;

grant select, insert, update, delete on table
  public.market_issue_user_states,
  public.market_issue_user_company_follows
to authenticated;
