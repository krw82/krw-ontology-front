-- Pulse V3 moves catalog filing work from the request path into an event
-- maintained read model.  User state remains private and is composed at read
-- time; no per-user filing fan-out is performed here.

-- This is a one-shot cutover. The request-time candidate and status RPCs are
-- intentionally removed rather than kept as a fallback for a previous web
-- image; every supported image reads the V3 model below.
drop function if exists public.get_catalog_pulse_filing_candidates_v2(
  text, timestamptz, text[], integer, integer, integer, integer
);
drop function if exists public.get_catalog_pulse_filing_candidates_v3(
  text, timestamptz, text[], integer, integer, integer, integer
);
drop function if exists public.get_catalog_pulse_feed_status_v1(
  text, timestamptz, timestamptz
);

create table if not exists public.pulse_global_filing_candidates (
  env text not null check (env in ('dev', 'staging', 'prod')),
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  ticker text not null,
  covered_tickers text[] not null default '{}'::text[],
  alert_priority text not null check (alert_priority in ('urgent', 'normal', 'digest')),
  priority_rank smallint,
  occurred_at timestamptz not null,
  available_at timestamptz not null,
  expires_at timestamptz,
  payload jsonb not null,
  candidate_updated_at timestamptz not null default now(),
  primary key (env, filing_event_id)
);

create index if not exists idx_pulse_global_filing_candidates_ranked
  on public.pulse_global_filing_candidates (
    env,
    alert_priority,
    priority_rank asc nulls last,
    occurred_at desc,
    filing_event_id desc
  );

create index if not exists idx_pulse_global_filing_candidates_available
  on public.pulse_global_filing_candidates (env, available_at desc, occurred_at desc)
  where expires_at is null;

create table if not exists public.pulse_global_candidate_tickers (
  env text not null check (env in ('dev', 'staging', 'prod')),
  filing_event_id uuid not null,
  ticker text not null,
  primary key (env, filing_event_id, ticker),
  foreign key (env, filing_event_id)
    references public.pulse_global_filing_candidates(env, filing_event_id)
    on delete cascade
);

create index if not exists idx_pulse_global_candidate_tickers_lookup
  on public.pulse_global_candidate_tickers (env, ticker, filing_event_id);

create table if not exists public.pulse_global_feed_revisions (
  env text primary key check (env in ('dev', 'staging', 'prod')),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

insert into public.pulse_global_feed_revisions (env)
values ('dev'), ('staging'), ('prod')
on conflict (env) do nothing;

create table if not exists public.user_pulse_feed_revisions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

alter table public.user_pulse_feed_revisions enable row level security;

drop policy if exists "users can read own pulse feed revision" on public.user_pulse_feed_revisions;
create policy "users can read own pulse feed revision"
  on public.user_pulse_feed_revisions for select
  using (user_id = auth.uid());

create or replace function public.bump_pulse_global_feed_revision(p_env text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
begin
  if lower(trim(coalesce(p_env, ''))) not in ('dev', 'staging', 'prod') then
    raise exception 'invalid pulse env';
  end if;

  insert into public.pulse_global_feed_revisions as revision (env, revision, updated_at)
  values (lower(trim(p_env)), 1, now())
  on conflict (env) do update
  set revision = revision.revision + 1,
      updated_at = now()
  returning revision.revision into v_revision;

  return v_revision;
end;
$$;

create or replace function public.bump_user_pulse_feed_revision(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
begin
  if p_user_id is null then
    return 0;
  end if;

  insert into public.user_pulse_feed_revisions as revision (user_id, revision, updated_at)
  values (p_user_id, 1, now())
  on conflict (user_id) do update
  set revision = revision.revision + 1,
      updated_at = now()
  returning revision.revision into v_revision;

  return v_revision;
end;
$$;

create or replace function public.sync_pulse_global_filing_candidate(
  p_filing_event_id uuid,
  p_env text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.sec_filing_events%rowtype;
  v_brief public.sec_filing_briefs%rowtype;
  v_form4 public.sec_form4_event_summaries%rowtype;
  v_covered_tickers text[];
  v_payload jsonb;
  v_changed boolean := false;
  v_deleted integer := 0;
begin
  select * into v_event
  from public.sec_filing_events
  where id = p_filing_event_id
    and (p_env is null or env = lower(trim(p_env)));

  if not found then
    delete from public.pulse_global_filing_candidates
    where filing_event_id = p_filing_event_id
      and (p_env is null or env = lower(trim(p_env)));
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      perform public.bump_pulse_global_feed_revision(coalesce(lower(trim(p_env)), 'prod'));
    end if;
    return false;
  end if;

  select array_agg(company.ticker order by company.ticker)
  into v_covered_tickers
  from public.ontology_catalog_releases release
  join public.ontology_companies company
    on company.env = release.env
   and company.release_id = release.release_id
  where release.env = v_event.env
    and release.active
    and company.sec_cik = v_event.cik;

  if not v_event.feed_eligible
    or v_event.processing_status <> 'ready'
    or v_event.feed_available_at is null
    or coalesce(cardinality(v_covered_tickers), 0) = 0 then
    delete from public.pulse_global_filing_candidates
    where env = v_event.env and filing_event_id = v_event.id;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      perform public.bump_pulse_global_feed_revision(v_event.env);
    end if;
    return false;
  end if;

  select * into v_brief
  from public.sec_filing_briefs
  where filing_event_id = v_event.id
    and locale = 'ko-KR';

  select * into v_form4
  from public.sec_form4_event_summaries
  where filing_event_id = v_event.id;

  v_payload := jsonb_build_object(
    -- Keep this projection intentionally smaller than sec_filing_events. The
    -- Pulse card links by filing_event_id from the outer row; raw SEC URLs,
    -- accession metadata, and source_metadata belong to the filing detail
    -- screen and must not be copied into every Redis/cache candidate.
    'ticker', v_event.ticker,
    'covered_tickers', v_covered_tickers,
    'form_type', v_event.form_type,
    'is_amendment', v_event.is_amendment,
    'first_seen_at', v_event.first_seen_at,
    'occurred_at', v_event.occurred_at,
    'feed_available_at', v_event.feed_available_at,
    'feed_expires_at', v_event.feed_expires_at,
    'alert_priority', v_event.alert_priority,
    'primary_event_tag', v_event.primary_event_tag,
    'sec_items', v_event.sec_items,
    'form4_reported_purchase_value', v_form4.reported_purchase_value,
    'form4_reported_sale_value', v_form4.reported_sale_value,
    'form4_tenb5_one_status', v_form4.tenb5_one_status,
    'form4_has_reported_open_market_trade', v_form4.has_reported_open_market_trade,
    'filing_brief_headline_ko', v_brief.headline_ko,
    'filing_brief_summary_sentences', v_brief.summary_sentences,
    'filing_brief_facts', v_brief.facts,
    'filing_brief_question_suggestions', v_brief.question_suggestions,
    'filing_brief_generated_at', v_brief.generated_at
  );

  insert into public.pulse_global_filing_candidates as candidate (
    env, filing_event_id, ticker, covered_tickers, alert_priority,
    priority_rank, occurred_at, available_at, expires_at, payload,
    candidate_updated_at
  ) values (
    v_event.env, v_event.id, v_event.ticker, v_covered_tickers,
    v_event.alert_priority, v_event.feed_priority_rank, v_event.occurred_at,
    v_event.feed_available_at, v_event.feed_expires_at, v_payload, now()
  )
  on conflict (env, filing_event_id) do update
  set ticker = excluded.ticker,
      covered_tickers = excluded.covered_tickers,
      alert_priority = excluded.alert_priority,
      priority_rank = excluded.priority_rank,
      occurred_at = excluded.occurred_at,
      available_at = excluded.available_at,
      expires_at = excluded.expires_at,
      payload = excluded.payload,
      candidate_updated_at = excluded.candidate_updated_at
  where (candidate.ticker, candidate.covered_tickers, candidate.alert_priority,
         candidate.priority_rank, candidate.occurred_at, candidate.available_at,
         candidate.expires_at, candidate.payload)
    is distinct from
        (excluded.ticker, excluded.covered_tickers, excluded.alert_priority,
         excluded.priority_rank, excluded.occurred_at, excluded.available_at,
         excluded.expires_at, excluded.payload)
  returning true into v_changed;

  if coalesce(v_changed, false) then
    delete from public.pulse_global_candidate_tickers
    where env = v_event.env and filing_event_id = v_event.id;

    insert into public.pulse_global_candidate_tickers (env, filing_event_id, ticker)
    select v_event.env, v_event.id, ticker
    from unnest(v_covered_tickers) as ticker
    on conflict do nothing;

    perform public.bump_pulse_global_feed_revision(v_event.env);
  end if;

  return coalesce(v_changed, false);
end;
$$;

create or replace function public.rebuild_pulse_global_filing_candidates(
  p_env text,
  p_snapshot_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_event_id uuid;
  v_count integer := 0;
begin
  if v_env not in ('dev', 'staging', 'prod') then
    raise exception 'invalid pulse env';
  end if;

  for v_event_id in
    select event.id
    from public.sec_filing_events event
    where event.env = v_env
      and (
        (event.feed_eligible
          and event.processing_status = 'ready'
          and event.feed_available_at is not null
          and event.feed_available_at <= p_snapshot_at
          and (event.feed_expires_at is null or event.feed_expires_at > p_snapshot_at)
          and event.occurred_at >= p_snapshot_at - interval '14 days')
        or exists (
          select 1 from public.pulse_global_filing_candidates candidate
          where candidate.env = v_env and candidate.filing_event_id = event.id
        )
      )
  loop
    if public.sync_pulse_global_filing_candidate(v_event_id, v_env) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.pulse_global_filing_candidate_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.pulse_global_filing_candidates
    where env = old.env and filing_event_id = old.id;
    if found then
      perform public.bump_pulse_global_feed_revision(old.env);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
    and (new.env, new.ticker, new.cik, new.feed_eligible, new.processing_status,
         new.feed_available_at, new.feed_expires_at, new.occurred_at,
         new.feed_priority_rank, new.alert_priority, new.primary_event_tag,
         new.sec_items, new.event_tags, new.form_type, new.is_amendment,
         new.filing_date, new.report_date, new.accepted_at, new.first_seen_at,
         new.filing_detail_url, new.primary_document_url, new.source_metadata)
      is not distinct from
        (old.env, old.ticker, old.cik, old.feed_eligible, old.processing_status,
         old.feed_available_at, old.feed_expires_at, old.occurred_at,
         old.feed_priority_rank, old.alert_priority, old.primary_event_tag,
         old.sec_items, old.event_tags, old.form_type, old.is_amendment,
         old.filing_date, old.report_date, old.accepted_at, old.first_seen_at,
         old.filing_detail_url, old.primary_document_url, old.source_metadata) then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.env is distinct from old.env then
    delete from public.pulse_global_filing_candidates
    where env = old.env and filing_event_id = old.id;
    if found then
      perform public.bump_pulse_global_feed_revision(old.env);
    end if;
  end if;

  perform public.sync_pulse_global_filing_candidate(new.id, new.env);
  return new;
end;
$$;

drop trigger if exists trg_pulse_global_filing_candidate_event on public.sec_filing_events;
create trigger trg_pulse_global_filing_candidate_event
after insert or update or delete on public.sec_filing_events
for each row execute function public.pulse_global_filing_candidate_event_trigger();

create or replace function public.pulse_global_filing_candidate_brief_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_env text;
begin
  if tg_op = 'DELETE' then
    v_event_id := old.filing_event_id;
  else
    v_event_id := new.filing_event_id;
  end if;
  select env into v_env from public.sec_filing_events where id = v_event_id;
  if v_env is not null then
    perform public.sync_pulse_global_filing_candidate(v_event_id, v_env);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pulse_global_filing_candidate_brief on public.sec_filing_briefs;
create trigger trg_pulse_global_filing_candidate_brief
after insert or update or delete on public.sec_filing_briefs
for each row execute function public.pulse_global_filing_candidate_brief_trigger();

create or replace function public.pulse_global_filing_candidate_form4_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_env text;
begin
  v_event_id := case when tg_op = 'DELETE' then old.filing_event_id else new.filing_event_id end;
  select env into v_env from public.sec_filing_events where id = v_event_id;
  if v_env is not null then
    perform public.sync_pulse_global_filing_candidate(v_event_id, v_env);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pulse_global_filing_candidate_form4 on public.sec_form4_event_summaries;
create trigger trg_pulse_global_filing_candidate_form4
after insert or update or delete on public.sec_form4_event_summaries
for each row execute function public.pulse_global_filing_candidate_form4_trigger();

create or replace function public.get_pulse_global_filing_candidates_v1(
  p_env text,
  p_snapshot_at timestamptz default now(),
  p_preferred_tickers text[] default '{}'::text[],
  p_urgent_limit integer default 24,
  p_priority_limit integer default 32,
  p_preferred_limit integer default 40,
  p_discovery_limit integer default 24
)
returns table (
  filing_event_id uuid,
  payload jsonb,
  candidate_bucket text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with bounds as (
    select
      lower(trim(p_env)) as env,
      coalesce(p_snapshot_at, now()) as snapshot_at,
      greatest(0, least(coalesce(p_urgent_limit, 24), 50)) as urgent_limit,
      greatest(0, least(coalesce(p_priority_limit, 32), 60)) as priority_limit,
      greatest(0, least(coalesce(p_preferred_limit, 40), 60)) as preferred_limit,
      greatest(0, least(coalesce(p_discovery_limit, 24), 50)) as discovery_limit,
      array(
        select distinct upper(trim(ticker))
        from unnest(coalesce(p_preferred_tickers, '{}'::text[])) as ticker
        where char_length(trim(ticker)) between 1 and 16
        order by upper(trim(ticker))
        limit 100
      ) as preferred_tickers
  ), eligible as (
    select candidate.*
    from public.pulse_global_filing_candidates candidate
    join bounds on bounds.env = candidate.env
    where bounds.env in ('dev', 'staging', 'prod')
      and candidate.available_at <= bounds.snapshot_at
      and (candidate.expires_at is null or candidate.expires_at > bounds.snapshot_at)
  ), urgent as (
    select eligible.filing_event_id, eligible.payload, 'urgent'::text as bucket, 0 as bucket_rank,
      eligible.priority_rank, eligible.occurred_at
    from eligible cross join bounds
    where eligible.alert_priority = 'urgent'
      and eligible.occurred_at >= bounds.snapshot_at - interval '72 hours'
    order by eligible.priority_rank asc nulls last, eligible.occurred_at desc, eligible.filing_event_id desc
    limit (select urgent_limit from bounds)
  ), priority as (
    select eligible.filing_event_id, eligible.payload, 'priority'::text as bucket, 1 as bucket_rank,
      eligible.priority_rank, eligible.occurred_at
    from eligible cross join bounds
    where eligible.alert_priority = 'normal'
      and eligible.occurred_at >= bounds.snapshot_at - interval '7 days'
    order by eligible.priority_rank asc nulls last, eligible.occurred_at desc, eligible.filing_event_id desc
    limit (select priority_limit from bounds)
  ), preferred as (
    select distinct on (eligible.filing_event_id)
      eligible.filing_event_id, eligible.payload, 'preferred'::text as bucket, 2 as bucket_rank,
      eligible.priority_rank, eligible.occurred_at
    from eligible
    join public.pulse_global_candidate_tickers tickers
      on tickers.env = eligible.env and tickers.filing_event_id = eligible.filing_event_id
    cross join bounds
    where cardinality(bounds.preferred_tickers) > 0
      and tickers.ticker = any(bounds.preferred_tickers)
      and eligible.occurred_at >= bounds.snapshot_at - interval '14 days'
    order by eligible.filing_event_id, eligible.priority_rank asc nulls last, eligible.occurred_at desc
  ), preferred_limited as (
    select * from preferred
    order by priority_rank asc nulls last, occurred_at desc, filing_event_id desc
    limit (select preferred_limit from bounds)
  ), discovery as (
    select eligible.filing_event_id, eligible.payload, 'discovery'::text as bucket, 3 as bucket_rank,
      eligible.priority_rank, eligible.occurred_at
    from eligible cross join bounds
    where eligible.occurred_at >= bounds.snapshot_at - interval '7 days'
    order by eligible.priority_rank asc nulls last, eligible.occurred_at desc, eligible.filing_event_id desc
    limit (select discovery_limit from bounds)
  ), combined as (
    select * from urgent
    union all select * from priority
    union all select * from preferred_limited
    union all select * from discovery
  ), deduplicated as (
    select distinct on (filing_event_id) *
    from combined
    order by filing_event_id, bucket_rank, priority_rank asc nulls last, occurred_at desc
  )
  select filing_event_id, payload, bucket
  from deduplicated
  order by bucket_rank, priority_rank asc nulls last, occurred_at desc, filing_event_id desc;
$$;

create or replace function public.get_pulse_feed_revisions_v1(
  p_env text,
  p_user_id uuid,
  p_now timestamptz default now()
)
returns table (
  global_revision bigint,
  user_revision bigint,
  time_bucket bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    coalesce(global_state.revision, 0)::bigint,
    coalesce(user_state.revision, 0)::bigint,
    -- A five-minute temporal boundary covers eligibility expiry and scheduled
    -- review time without making an unchanged browser refresh rebuild Pulse.
    floor(extract(epoch from coalesce(p_now, now())) / 300)::bigint
  from (select 1) as singleton
  left join public.pulse_global_feed_revisions global_state
    on global_state.env = lower(trim(p_env))
  left join public.user_pulse_feed_revisions user_state
    on user_state.user_id = p_user_id;
$$;

create or replace function public.pulse_user_feed_revision_from_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    perform public.bump_user_pulse_feed_revision(v_user_id);
    return old;
  else
    v_user_id := new.user_id;
  end if;
  if v_user_id is not null then
    perform public.bump_user_pulse_feed_revision(v_user_id);
  end if;
  return new;
end;
$$;

create or replace function public.pulse_user_feed_revision_from_item_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    perform public.bump_user_pulse_feed_revision(v_user_id);
    return old;
  else
    v_user_id := new.user_id;
  end if;
  if tg_op = 'INSERT' then
    if new.dismissed_at is not null
      or new.snoozed_until is not null
      or new.saved_at is not null
      or new.reviewed_at is not null then
      perform public.bump_user_pulse_feed_revision(v_user_id);
    end if;
  elsif (new.dismissed_at, new.snoozed_until, new.saved_at, new.reviewed_at)
      is distinct from
        (old.dismissed_at, old.snoozed_until, old.saved_at, old.reviewed_at) then
    perform public.bump_user_pulse_feed_revision(v_user_id);
  end if;
  return new;
end;
$$;

create or replace function public.pulse_user_feed_revision_from_agent_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  select user_id into v_user_id
  from public.chat_sessions
  where id = new.session_id
    and scope_type = 'company'
    and deleted_at is null;
  if v_user_id is not null then
    perform public.bump_user_pulse_feed_revision(v_user_id);
  end if;
  return new;
end;
$$;

create or replace function public.pulse_user_feed_revision_from_chat_session()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.scope_type = 'company' then
      perform public.bump_user_pulse_feed_revision(old.user_id);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
    and (new.user_id, new.scope_type, new.default_tickers, new.title,
         new.last_message_preview, new.last_message_at, new.latest_run_status,
         new.deleted_at)
      is not distinct from
        (old.user_id, old.scope_type, old.default_tickers, old.title,
         old.last_message_preview, old.last_message_at, old.latest_run_status,
         old.deleted_at) then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.scope_type = 'company'
    and old.user_id is distinct from new.user_id then
    perform public.bump_user_pulse_feed_revision(old.user_id);
  end if;
  if new.scope_type = 'company' then
    perform public.bump_user_pulse_feed_revision(new.user_id);
  end if;
  return new;
end;
$$;

create or replace function public.pulse_global_feed_revision_from_shared_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Editorial learning is shared across environments and can appear in any
  -- user's feed. It is still never stored in the personalized Redis cache.
  perform public.bump_pulse_global_feed_revision('dev');
  perform public.bump_pulse_global_feed_revision('staging');
  perform public.bump_pulse_global_feed_revision('prod');
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pulse_feed_revision_preferences on public.user_pulse_preferences;
create trigger trg_pulse_feed_revision_preferences
after insert or update or delete on public.user_pulse_preferences
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_company_marks on public.user_company_marks;
create trigger trg_pulse_feed_revision_company_marks
after insert or update or delete on public.user_company_marks
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_monitoring_rules on public.user_company_monitoring_rules;
create trigger trg_pulse_feed_revision_monitoring_rules
after insert or update or delete on public.user_company_monitoring_rules
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_questions on public.user_company_questions;
create trigger trg_pulse_feed_revision_questions
after insert or update or delete on public.user_company_questions
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_notes on public.user_research_notes;
create trigger trg_pulse_feed_revision_notes
after insert or update or delete on public.user_research_notes
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_notebooks on public.user_company_notebooks;
create trigger trg_pulse_feed_revision_notebooks
after insert or update or delete on public.user_company_notebooks
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_judgment_revisions on public.user_filing_judgment_revisions;
create trigger trg_pulse_feed_revision_judgment_revisions
after insert or update or delete on public.user_filing_judgment_revisions
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_item_states on public.user_pulse_item_states;
create trigger trg_pulse_feed_revision_item_states
after insert or update or delete on public.user_pulse_item_states
for each row execute function public.pulse_user_feed_revision_from_item_state();

drop trigger if exists trg_pulse_feed_revision_agent_runs on public.agent_runs;
create trigger trg_pulse_feed_revision_agent_runs
after insert or update of status on public.agent_runs
for each row execute function public.pulse_user_feed_revision_from_agent_run();

drop trigger if exists trg_pulse_feed_revision_chat_sessions on public.chat_sessions;
create trigger trg_pulse_feed_revision_chat_sessions
after insert or update or delete on public.chat_sessions
for each row execute function public.pulse_user_feed_revision_from_chat_session();

drop trigger if exists trg_pulse_feed_revision_billing_subscriptions on public.billing_toss_subscriptions;
create trigger trg_pulse_feed_revision_billing_subscriptions
after insert or update or delete on public.billing_toss_subscriptions
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_entitlements on public.user_entitlements;
create trigger trg_pulse_feed_revision_entitlements
after insert or update or delete on public.user_entitlements
for each row execute function public.pulse_user_feed_revision_from_row();

-- Some older production databases recorded the editorial migration before the
-- table was actually provisioned. The following repair migration recreates
-- that table; guard these triggers so the read-model cutover itself cannot be
-- blocked by that historical schema drift.
do $$
begin
  if to_regclass('public.pulse_editorial_entries') is not null then
    execute 'drop trigger if exists trg_pulse_global_feed_revision_editorial_entries on public.pulse_editorial_entries';
    execute 'create trigger trg_pulse_global_feed_revision_editorial_entries after insert or update or delete on public.pulse_editorial_entries for each row execute function public.pulse_global_feed_revision_from_shared_row()';
  end if;

  if to_regclass('public.pulse_editorial_assets') is not null then
    execute 'drop trigger if exists trg_pulse_global_feed_revision_editorial_assets on public.pulse_editorial_assets';
    execute 'create trigger trg_pulse_global_feed_revision_editorial_assets after insert or update or delete on public.pulse_editorial_assets for each row execute function public.pulse_global_feed_revision_from_shared_row()';
  end if;
end;
$$;

revoke all on function public.bump_pulse_global_feed_revision(text) from public, anon, authenticated;
revoke all on function public.bump_user_pulse_feed_revision(uuid) from public, anon, authenticated;
revoke all on function public.sync_pulse_global_filing_candidate(uuid, text) from public, anon, authenticated;
revoke all on function public.rebuild_pulse_global_filing_candidates(text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_pulse_global_filing_candidates_v1(text, timestamptz, text[], integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.get_pulse_feed_revisions_v1(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.pulse_global_filing_candidate_event_trigger() from public, anon, authenticated;
revoke all on function public.pulse_global_filing_candidate_brief_trigger() from public, anon, authenticated;
revoke all on function public.pulse_global_filing_candidate_form4_trigger() from public, anon, authenticated;
revoke all on function public.pulse_user_feed_revision_from_row() from public, anon, authenticated;
revoke all on function public.pulse_user_feed_revision_from_item_state() from public, anon, authenticated;
revoke all on function public.pulse_user_feed_revision_from_agent_run() from public, anon, authenticated;
revoke all on function public.pulse_user_feed_revision_from_chat_session() from public, anon, authenticated;
revoke all on function public.pulse_global_feed_revision_from_shared_row() from public, anon, authenticated;

grant execute on function public.bump_pulse_global_feed_revision(text) to service_role;
grant execute on function public.bump_user_pulse_feed_revision(uuid) to service_role;
grant execute on function public.sync_pulse_global_filing_candidate(uuid, text) to service_role;
grant execute on function public.rebuild_pulse_global_filing_candidates(text, timestamptz) to service_role;
grant execute on function public.get_pulse_global_filing_candidates_v1(text, timestamptz, text[], integer, integer, integer, integer) to service_role;
grant execute on function public.get_pulse_feed_revisions_v1(text, uuid, timestamptz) to service_role;

grant select, insert, update, delete on table public.pulse_global_filing_candidates to service_role;
grant select, insert, update, delete on table public.pulse_global_candidate_tickers to service_role;
grant select, insert, update, delete on table public.pulse_global_feed_revisions to service_role;
grant select, insert, update, delete on table public.user_pulse_feed_revisions to service_role;

select public.rebuild_pulse_global_filing_candidates('dev');
select public.rebuild_pulse_global_filing_candidates('staging');
select public.rebuild_pulse_global_filing_candidates('prod');

notify pgrst, 'reload schema';
