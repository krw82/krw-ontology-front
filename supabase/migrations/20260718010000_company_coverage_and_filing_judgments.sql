-- Personal company coverage and source-grounded filing decision history.
--
-- This is a deliberate contract cutover: coverage_status is authoritative,
-- legacy watchlist booleans/read aliases are removed, and all decision writes
-- cross one transactional RPC boundary.

alter table public.user_company_marks
  add column if not exists coverage_status text;

update public.user_company_marks
set coverage_status = case
  when is_holding then 'holding'
  when is_watchlisted then 'watching'
  else 'exploring'
end
where coverage_status is null;

alter table public.user_company_marks
  alter column coverage_status set default 'exploring',
  alter column coverage_status set not null,
  drop constraint if exists user_company_marks_coverage_status_check;

alter table public.user_company_marks
  add constraint user_company_marks_coverage_status_check
    check (coverage_status in ('exploring', 'watching', 'holding', 'closed'));

drop index if exists public.idx_user_company_marks_user_holding;

alter table public.user_company_marks
  drop column if exists is_watchlisted,
  drop column if exists is_holding;

-- A thesis is a structured piece of user memory, not only a free-form note.
alter table public.user_company_theses
  add column if not exists monitored_variables text[] not null default '{}'::text[],
  add column if not exists counter_evidence text not null default '',
  add column if not exists decision_change_condition text not null default '';

alter table public.user_company_theses
  drop constraint if exists user_company_theses_monitored_variables_count_check,
  drop constraint if exists user_company_theses_counter_evidence_length_check,
  drop constraint if exists user_company_theses_decision_change_condition_length_check;

alter table public.user_company_theses
  add constraint user_company_theses_monitored_variables_count_check
    check (cardinality(monitored_variables) <= 3),
  add constraint user_company_theses_counter_evidence_length_check
    check (char_length(counter_evidence) <= 8000),
  add constraint user_company_theses_decision_change_condition_length_check
    check (char_length(decision_change_condition) <= 4000);

create index if not exists idx_user_company_marks_user_coverage
  on public.user_company_marks (user_id, coverage_status, updated_at desc);

create table if not exists public.user_company_coverage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  previous_status text,
  coverage_status text not null,
  changed boolean not null,
  source text not null default 'api',
  idempotency_key text not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint user_company_coverage_events_mark_fk
    foreign key (user_id, ticker)
    references public.user_company_marks(user_id, ticker) on delete cascade,
  constraint user_company_coverage_events_ticker_check
    check (ticker = upper(ticker) and char_length(trim(ticker)) between 1 and 16),
  constraint user_company_coverage_events_previous_status_check
    check (previous_status is null or previous_status in ('exploring', 'watching', 'holding', 'closed')),
  constraint user_company_coverage_events_status_check
    check (coverage_status in ('exploring', 'watching', 'holding', 'closed')),
  constraint user_company_coverage_events_source_length
    check (char_length(trim(source)) between 1 and 80),
  constraint user_company_coverage_events_idempotency_length
    check (char_length(trim(idempotency_key)) between 8 and 200),
  constraint user_company_coverage_events_response_object_check
    check (jsonb_typeof(response_payload) = 'object'),
  constraint user_company_coverage_events_request_object_check
    check (jsonb_typeof(request_payload) = 'object'),
  unique (user_id, idempotency_key)
);

create index if not exists idx_user_company_coverage_events_timeline
  on public.user_company_coverage_events (user_id, ticker, created_at desc, id desc);

create table if not exists public.user_filing_judgments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  ticker text not null,
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_filing_judgments_ticker_check
    check (ticker = upper(ticker) and char_length(trim(ticker)) between 1 and 16),
  unique (user_id, filing_event_id),
  unique (id, user_id)
);

create table if not exists public.user_filing_judgment_revisions (
  id uuid primary key default gen_random_uuid(),
  judgment_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  ticker text not null,
  revision_number integer not null,
  impact text not null,
  next_action text not null,
  summary text not null,
  rationale text not null default '',
  is_current boolean not null default true,
  idempotency_key text not null,
  request_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint user_filing_judgment_revisions_judgment_fk
    foreign key (judgment_id, user_id)
    references public.user_filing_judgments(id, user_id) on delete cascade,
  constraint user_filing_judgment_revisions_ticker_check
    check (ticker = upper(ticker) and char_length(trim(ticker)) between 1 and 16),
  constraint user_filing_judgment_revisions_number_check check (revision_number > 0),
  constraint user_filing_judgment_revisions_impact_check
    check (impact in ('positive', 'neutral', 'negative', 'unclear')),
  constraint user_filing_judgment_revisions_next_action_check
    check (next_action in ('complete', 'update_thesis', 'create_question', 'review_later')),
  constraint user_filing_judgment_revisions_summary_length
    check (char_length(trim(summary)) between 1 and 1200),
  constraint user_filing_judgment_revisions_rationale_length
    check (char_length(rationale) <= 8000),
  constraint user_filing_judgment_revisions_idempotency_length
    check (char_length(trim(idempotency_key)) between 8 and 200),
  constraint user_filing_judgment_revisions_request_object_check
    check (jsonb_typeof(request_payload) = 'object'),
  unique (judgment_id, revision_number),
  unique (user_id, idempotency_key),
  unique (id, user_id)
);

create unique index if not exists idx_user_filing_judgment_revisions_one_current
  on public.user_filing_judgment_revisions (judgment_id)
  where is_current;

alter table public.user_filing_judgments
  drop constraint if exists user_filing_judgments_current_revision_fk;

alter table public.user_filing_judgments
  add constraint user_filing_judgments_current_revision_fk
    foreign key (current_revision_id, user_id)
    references public.user_filing_judgment_revisions(id, user_id)
    deferrable initially deferred;

create table if not exists public.user_filing_judgment_thesis_links (
  revision_id uuid not null,
  judgment_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  ticker text not null,
  thesis_id uuid not null references public.user_company_theses(id) on delete cascade,
  impact text not null,
  position smallint not null default 0,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (revision_id, thesis_id),
  constraint user_filing_judgment_thesis_links_revision_fk
    foreign key (revision_id, user_id)
    references public.user_filing_judgment_revisions(id, user_id) on delete cascade,
  constraint user_filing_judgment_thesis_links_judgment_fk
    foreign key (judgment_id, user_id)
    references public.user_filing_judgments(id, user_id) on delete cascade,
  constraint user_filing_judgment_thesis_links_impact_check
    check (impact in ('positive', 'neutral', 'negative', 'unclear')),
  constraint user_filing_judgment_thesis_links_position_check
    check (position between 0 and 19)
);

create index if not exists idx_user_filing_judgment_thesis_links_current
  on public.user_filing_judgment_thesis_links (user_id, filing_event_id, position)
  where is_current;

create table if not exists public.user_company_monitoring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  rule_type text not null,
  operator text not null,
  value text,
  next_review_at timestamptz,
  dedupe_key text not null,
  enabled boolean not null default true,
  created_by_judgment_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_company_monitoring_rules_ticker_check
    check (ticker = upper(ticker) and char_length(trim(ticker)) between 1 and 16),
  constraint user_company_monitoring_rules_type_check
    check (rule_type in ('filing_form', 'filing_item', 'keyword', 'scheduled_review')),
  constraint user_company_monitoring_rules_shape_check
    check (
      (rule_type = 'scheduled_review'
        and operator = 'on_or_after'
        and value is null
        and next_review_at is not null)
      or
      (rule_type in ('filing_form', 'filing_item', 'keyword')
        and operator in ('matches', 'contains')
        and value is not null
        and char_length(trim(value)) between 1 and 500
        and next_review_at is null)
    ),
  constraint user_company_monitoring_rules_dedupe_length
    check (char_length(dedupe_key) between 3 and 900),
  unique (user_id, ticker, dedupe_key),
  unique (id, user_id)
);

create table if not exists public.user_filing_judgment_monitoring_rules (
  revision_id uuid not null,
  rule_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (revision_id, rule_id),
  constraint user_filing_judgment_monitoring_rules_revision_fk
    foreign key (revision_id, user_id)
    references public.user_filing_judgment_revisions(id, user_id) on delete cascade,
  constraint user_filing_judgment_monitoring_rules_rule_fk
    foreign key (rule_id, user_id)
    references public.user_company_monitoring_rules(id, user_id) on delete cascade,
  constraint user_filing_judgment_monitoring_rules_position_check
    check (position between 0 and 19)
);

-- SEC source confirmation is product state, not an analytics side effect.
-- It may exist for a global discovery filing; activation below only accepts a
-- source open that forms one coherent loop with active coverage and judgment.
create table if not exists public.user_filing_source_opens (
  user_id uuid not null references auth.users(id) on delete cascade,
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  ticker text not null,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  primary key (user_id, filing_event_id),
  constraint user_filing_source_opens_ticker_check
    check (ticker = upper(ticker) and char_length(trim(ticker)) between 1 and 16)
);

create index if not exists idx_user_filing_source_opens_timeline
  on public.user_filing_source_opens (user_id, ticker, last_opened_at desc);

create table if not exists public.user_retention_milestones (
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone text not null,
  achieved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, milestone),
  constraint user_retention_milestones_name_check
    check (milestone in ('coverage_activated')),
  constraint user_retention_milestones_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.user_decision_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  timezone text not null,
  feed_session_id uuid not null,
  snapshot_at timestamptz not null,
  judgment_count integer not null default 0,
  observation_count integer not null default 0,
  thesis_update_count integer not null default 0,
  open_question_count integer not null default 0,
  next_check_count integer not null default 0,
  outcome text not null,
  closed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_decision_sessions_timezone_length
    check (char_length(trim(timezone)) between 1 and 80),
  constraint user_decision_sessions_counts_check
    check (
      judgment_count between 0 and 10000
      and observation_count between 0 and 10000
      and thesis_update_count between 0 and 10000
      and open_question_count between 0 and 10000
      and next_check_count between 0 and 10000
    ),
  constraint user_decision_sessions_outcome_check
    check (outcome in ('completed', 'deferred')),
  unique (user_id, local_date)
);

drop trigger if exists trg_user_decision_sessions_updated_at on public.user_decision_sessions;
create trigger trg_user_decision_sessions_updated_at
  before update on public.user_decision_sessions
  for each row execute function public.set_updated_at();

alter table public.user_company_monitoring_rules
  add constraint user_company_monitoring_rules_origin_revision_fk
    foreign key (created_by_judgment_revision_id)
    references public.user_filing_judgment_revisions(id) on delete set null;

create index if not exists idx_user_filing_judgments_user_updated
  on public.user_filing_judgments (user_id, updated_at desc, id desc);
create index if not exists idx_user_filing_judgment_revisions_timeline
  on public.user_filing_judgment_revisions (user_id, ticker, created_at desc, id desc);
create index if not exists idx_user_company_monitoring_rules_active
  on public.user_company_monitoring_rules (user_id, ticker, next_review_at, updated_at desc)
  where enabled;

drop trigger if exists trg_user_filing_judgments_updated_at on public.user_filing_judgments;
create trigger trg_user_filing_judgments_updated_at
  before update on public.user_filing_judgments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_company_monitoring_rules_updated_at on public.user_company_monitoring_rules;
create trigger trg_user_company_monitoring_rules_updated_at
  before update on public.user_company_monitoring_rules
  for each row execute function public.set_updated_at();

create or replace function public.reconcile_user_company_coverage_limit(
  p_user_id uuid,
  p_active_limit integer,
  p_preferred_ticker text default null
)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preferred_ticker text := upper(trim(coalesce(p_preferred_ticker, '')));
  v_mark public.user_company_marks%rowtype;
  v_previous_status text;
  v_event_id uuid;
  v_closed_tickers text[] := '{}'::text[];
begin
  if p_user_id is null or p_active_limit is null or p_active_limit < 0 then
    raise exception 'invalid coverage reconciliation' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 734251));

  for v_mark in
    select mark.*
    from public.user_company_marks mark
    where mark.user_id = p_user_id
      and mark.coverage_status in ('exploring', 'watching', 'holding')
    order by
      case when mark.ticker = v_preferred_ticker then 0 else 1 end,
      case mark.coverage_status
        when 'holding' then 0
        when 'watching' then 1
        else 2
      end,
      mark.priority desc,
      coalesce(mark.last_activity_at, mark.updated_at) desc,
      mark.ticker
    offset p_active_limit
  loop
    v_previous_status := v_mark.coverage_status;
    update public.user_company_marks mark
    set coverage_status = 'closed', last_activity_at = now(), updated_at = now()
    where mark.user_id = p_user_id and mark.ticker = v_mark.ticker
    returning * into v_mark;

    update public.user_company_monitoring_rules rule
    set enabled = false, updated_at = now()
    where rule.user_id = p_user_id
      and rule.ticker = v_mark.ticker
      and rule.enabled;

    v_event_id := gen_random_uuid();
    insert into public.user_company_coverage_events (
      id, user_id, ticker, previous_status, coverage_status, changed, source,
      idempotency_key, request_payload, response_payload
    ) values (
      v_event_id, p_user_id, v_mark.ticker, v_previous_status, 'closed', true,
      'plan_reconciliation', 'plan-reconcile:' || v_event_id::text,
      jsonb_build_object(
        'ticker', v_mark.ticker,
        'coverage_status', 'closed',
        'source', 'plan_reconciliation',
        'active_limit', p_active_limit
      ),
      jsonb_build_object(
        'mark', to_jsonb(v_mark),
        'event_id', v_event_id,
        'previous_status', v_previous_status,
        'coverage_status', 'closed',
        'changed', true,
        'idempotent_replay', false,
        'reconciled', true
      )
    );
    v_closed_tickers := array_append(v_closed_tickers, v_mark.ticker);
  end loop;
  return v_closed_tickers;
end;
$$;

create or replace function public.reconcile_coverage_on_entitlement_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if tg_op = 'DELETE' then
    perform public.reconcile_user_company_coverage_limit(v_user_id, 3, null);
    return old;
  end if;
  if new.plan_key = 'free'
     or new.status not in ('active', 'grace')
     or (new.status = 'active' and new.current_period_end <= now())
     or (
       new.status = 'grace'
       and (new.grace_until is null or new.grace_until <= now())
     ) then
    perform public.reconcile_user_company_coverage_limit(v_user_id, 3, null);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reconcile_coverage_on_entitlement_change
  on public.user_entitlements;
create trigger trg_reconcile_coverage_on_entitlement_change
  after insert or update of plan_key, status, current_period_end, grace_until
  on public.user_entitlements
  for each row execute function public.reconcile_coverage_on_entitlement_change();

drop trigger if exists trg_reconcile_coverage_on_entitlement_delete
  on public.user_entitlements;
create trigger trg_reconcile_coverage_on_entitlement_delete
  after delete on public.user_entitlements
  for each row execute function public.reconcile_coverage_on_entitlement_change();

-- Timestamps expire without producing a row-change event. The always-on
-- billing worker calls this bounded sweep every cycle, including intentional
-- deployments where the external payment provider is disabled.
create or replace function public.sweep_expired_company_coverage_limits(
  p_now timestamptz default now(),
  p_limit integer default 250
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user record;
  v_closed text[];
  v_reconciled_users integer := 0;
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid coverage expiry sweep' using errcode = '22023';
  end if;

  for v_user in
    select entitlement.user_id
    from public.user_entitlements entitlement
    where (
      entitlement.plan_key = 'free'
      or entitlement.status not in ('active', 'grace')
      or (
        (
          (
            entitlement.status = 'active'
            and entitlement.current_period_end <= p_now
          )
          or (
            entitlement.status = 'grace'
            and (
              entitlement.grace_until is null
              or entitlement.grace_until <= p_now
            )
          )
        )
        -- A due subscription outside the current renewal batch still owns its
        -- paid/grace resolution. Never archive it merely because this cycle's
        -- bounded provider batch has not reached it yet.
        and not exists (
          select 1
          from public.billing_toss_subscriptions subscription
          where subscription.user_id = entitlement.user_id
            and subscription.status in (
              'active', 'past_due', 'grace', 'pending_cancel'
            )
        )
      )
    )
      and (
        select count(*)
        from public.user_company_marks mark
        where mark.user_id = entitlement.user_id
          and mark.coverage_status in ('exploring', 'watching', 'holding')
      ) > 3
    order by entitlement.user_id
    limit p_limit
  loop
    v_closed := public.reconcile_user_company_coverage_limit(
      v_user.user_id,
      3,
      null
    );
    if cardinality(v_closed) > 0 then
      v_reconciled_users := v_reconciled_users + 1;
    end if;
  end loop;
  return v_reconciled_users;
end;
$$;

-- Existing users without a currently usable paid entitlement enter the same
-- deterministic three-company archive policy during the contract cutover.
do $$
declare v_user record;
begin
  for v_user in
    select distinct mark.user_id
    from public.user_company_marks mark
    where mark.coverage_status in ('exploring', 'watching', 'holding')
      and not exists (
        select 1
        from public.user_entitlements entitlement
        where entitlement.user_id = mark.user_id
          and entitlement.plan_key in ('standard', 'pro', 'beta', 'internal')
          and (
            (entitlement.status = 'active' and entitlement.current_period_end > now())
            or
            (entitlement.status = 'grace' and entitlement.grace_until > now())
          )
      )
    group by mark.user_id
    having count(*) > 3
  loop
    perform public.reconcile_user_company_coverage_limit(v_user.user_id, 3, null);
  end loop;
end;
$$;

create or replace function public.set_user_company_coverage_status(
  p_user_id uuid,
  p_ticker text,
  p_coverage_status text,
  p_idempotency_key text,
  p_source text default 'api',
  p_priority integer default null,
  p_interest_reason text default null,
  p_tags text[] default null,
  p_active_limit integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticker text := upper(trim(coalesce(p_ticker, '')));
  v_status text := lower(trim(coalesce(p_coverage_status, '')));
  v_key text := trim(coalesce(p_idempotency_key, ''));
  v_source text := trim(coalesce(p_source, 'api'));
  v_previous_status text;
  v_active_count integer;
  v_event public.user_company_coverage_events%rowtype;
  v_event_id uuid;
  v_mark public.user_company_marks%rowtype;
  v_request_payload jsonb;
begin
  if p_user_id is null then raise exception 'p_user_id is required' using errcode = '22023'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_ticker) not between 1 and 16 then raise exception 'invalid ticker' using errcode = '22023'; end if;
  if v_status not in ('exploring', 'watching', 'holding', 'closed') then raise exception 'invalid coverage status' using errcode = '22023'; end if;
  if char_length(v_key) not between 8 and 200 then raise exception 'invalid idempotency key' using errcode = '22023'; end if;
  if char_length(v_source) not between 1 and 80 then raise exception 'invalid source' using errcode = '22023'; end if;
  if p_active_limit is not null and p_active_limit < 0 then raise exception 'invalid active limit' using errcode = '22023'; end if;

  v_request_payload := jsonb_build_object(
    'ticker', v_ticker,
    'coverage_status', v_status,
    'source', v_source,
    'priority', p_priority,
    'interest_reason', p_interest_reason,
    'tags', to_jsonb(p_tags)
  );

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 734251));

  if p_active_limit is not null
     and v_status in ('exploring', 'watching', 'holding') then
    perform public.reconcile_user_company_coverage_limit(
      p_user_id,
      p_active_limit,
      v_ticker
    );
  end if;

  select event.* into v_event
  from public.user_company_coverage_events event
  where event.user_id = p_user_id and event.idempotency_key = v_key;
  if found then
    if v_event.request_payload <> v_request_payload then
      raise exception 'idempotency_key_conflict' using errcode = '22023';
    end if;
    if p_active_limit is not null and v_status = 'closed' then
      perform public.reconcile_user_company_coverage_limit(
        p_user_id,
        p_active_limit,
        null
      );
    end if;
    select mark.* into strict v_mark
    from public.user_company_marks mark
    where mark.user_id = p_user_id and mark.ticker = v_ticker;
    return jsonb_set(
      jsonb_set(v_event.response_payload, '{mark}', to_jsonb(v_mark), true),
      '{idempotent_replay}',
      'true'::jsonb,
      true
    );
  end if;

  select mark.coverage_status into v_previous_status
  from public.user_company_marks mark
  where mark.user_id = p_user_id and mark.ticker = v_ticker
  for update;

  if v_status in ('exploring', 'watching', 'holding')
    and (v_previous_status is null or v_previous_status = 'closed')
    and p_active_limit is not null then
    select count(*) into v_active_count
    from public.user_company_marks mark
    where mark.user_id = p_user_id
      and mark.coverage_status in ('exploring', 'watching', 'holding');
    if v_active_count >= p_active_limit then
      raise exception 'coverage_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  insert into public.user_company_marks as mark (
    user_id, ticker, coverage_status, priority, interest_reason, tags,
    last_activity_at, updated_at
  ) values (
    p_user_id, v_ticker, v_status, coalesce(p_priority, 0), p_interest_reason,
    coalesce(p_tags, '{}'::text[]), now(), now()
  )
  on conflict (user_id, ticker) do update
  set coverage_status = excluded.coverage_status,
      priority = coalesce(p_priority, mark.priority),
      interest_reason = case when p_interest_reason is null then mark.interest_reason else p_interest_reason end,
      tags = coalesce(p_tags, mark.tags),
      last_activity_at = now(),
      updated_at = now();

  select mark.* into strict v_mark
  from public.user_company_marks mark
  where mark.user_id = p_user_id and mark.ticker = v_ticker;

  -- Closing coverage preserves personal history but stops every future signal.
  -- Reopening is an explicit coverage transition; rules are never resurrected
  -- implicitly by a note or a stale judgment retry.
  if v_status = 'closed' then
    update public.user_company_monitoring_rules rule
    set enabled = false, updated_at = now()
    where rule.user_id = p_user_id
      and rule.ticker = v_ticker
      and rule.enabled;
    if p_active_limit is not null then
      perform public.reconcile_user_company_coverage_limit(
        p_user_id,
        p_active_limit,
        null
      );
      select mark.* into strict v_mark
      from public.user_company_marks mark
      where mark.user_id = p_user_id and mark.ticker = v_ticker;
    end if;
  end if;

  v_event_id := gen_random_uuid();
  insert into public.user_company_coverage_events (
    id, user_id, ticker, previous_status, coverage_status, changed, source,
    idempotency_key, request_payload, response_payload
  ) values (
    v_event_id, p_user_id, v_ticker, v_previous_status, v_status,
    v_previous_status is distinct from v_status, v_source, v_key,
    v_request_payload,
    jsonb_build_object(
      'mark', to_jsonb(v_mark),
      'event_id', v_event_id,
      'previous_status', v_previous_status,
      'coverage_status', v_status,
      'changed', v_previous_status is distinct from v_status,
      'idempotent_replay', false
    )
  ) returning * into v_event;

  return v_event.response_payload;
end;
$$;

create or replace function public.save_user_filing_judgment_revision(
  p_user_id uuid,
  p_filing_event_id uuid,
  p_ticker text,
  p_impact text,
  p_next_action text,
  p_summary text,
  p_rationale text,
  p_thesis_links jsonb,
  p_monitoring_rules jsonb,
  p_idempotency_key text,
  p_expected_revision_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticker text;
  v_event_ticker text;
  v_event_cik text;
  v_event_env text;
  v_judgment public.user_filing_judgments%rowtype;
  v_revision public.user_filing_judgment_revisions%rowtype;
  v_existing public.user_filing_judgment_revisions%rowtype;
  v_link jsonb;
  v_rule jsonb;
  v_thesis public.user_company_theses%rowtype;
  v_rule_row public.user_company_monitoring_rules%rowtype;
  v_rule_type text;
  v_operator text;
  v_value text;
  v_next_review_at timestamptz;
  v_dedupe_key text;
  v_position integer := 0;
  v_current_revision_number integer := 0;
  v_rule_existed boolean;
  v_created_rule_ids jsonb := '[]'::jsonb;
  v_existing_created_rule_ids jsonb := '[]'::jsonb;
  v_request_payload jsonb;
begin
  if p_user_id is null or p_filing_event_id is null then raise exception 'user and filing are required' using errcode = '22023'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_impact not in ('positive', 'neutral', 'negative', 'unclear') then raise exception 'invalid impact' using errcode = '22023'; end if;
  if p_next_action not in ('complete', 'update_thesis', 'create_question', 'review_later') then raise exception 'invalid next action' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_summary, ''))) not between 1 and 1200 then raise exception 'invalid summary' using errcode = '22023'; end if;
  if char_length(coalesce(p_rationale, '')) > 8000 then raise exception 'invalid rationale' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then raise exception 'invalid idempotency key' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_thesis_links, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_thesis_links, '[]'::jsonb)) > 20 then raise exception 'invalid thesis links' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_monitoring_rules, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_monitoring_rules, '[]'::jsonb)) > 20 then raise exception 'invalid monitoring rules' using errcode = '22023'; end if;

  select upper(event.ticker), event.cik, event.env
    into v_event_ticker, v_event_cik, v_event_env
  from public.sec_filing_events event
  where event.id = p_filing_event_id;
  if v_event_ticker is null then raise exception 'filing_event_not_found' using errcode = 'P0002'; end if;

  v_ticker := upper(trim(coalesce(p_ticker, '')));
  if char_length(v_ticker) not between 1 and 16 then
    raise exception 'invalid_filing_context_ticker' using errcode = '22023';
  end if;
  if v_ticker <> v_event_ticker and not exists (
    select 1
    from public.ontology_companies company
    where company.env = v_event_env
      and company.sec_cik = v_event_cik
      and company.ticker = v_ticker
  ) then
    raise exception 'invalid_filing_context_ticker' using errcode = '22023';
  end if;

  v_request_payload := jsonb_build_object(
    'filing_event_id', p_filing_event_id,
    'ticker', v_ticker,
    'impact', p_impact,
    'next_action', p_next_action,
    'summary', trim(p_summary),
    'rationale', coalesce(p_rationale, ''),
    'thesis_links', coalesce(p_thesis_links, '[]'::jsonb),
    'monitoring_rules', coalesce(p_monitoring_rules, '[]'::jsonb),
    'expected_revision_number', p_expected_revision_number
  );

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_filing_event_id::text, 734252));

  -- The ticker is the user's immutable share-class context for this SEC event.
  -- Revisions may change the judgment, never silently move its parent between
  -- GOOG/GOOGL (or another issuer's share classes).
  select judgment.* into v_judgment
  from public.user_filing_judgments judgment
  where judgment.user_id = p_user_id
    and judgment.filing_event_id = p_filing_event_id
  for update;
  if found and v_judgment.ticker <> v_ticker then
    raise exception 'filing_context_ticker_conflict' using errcode = '22023';
  end if;

  -- Replays win over optimistic concurrency so a network retry remains safe.
  select revision.* into v_existing
  from public.user_filing_judgment_revisions revision
  where revision.user_id = p_user_id
    and revision.idempotency_key = trim(p_idempotency_key);
  if found then
    if v_existing.request_payload <> v_request_payload then
      raise exception 'idempotency_key_conflict' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(rule.id order by rule.created_at, rule.id), '[]'::jsonb)
      into v_existing_created_rule_ids
    from public.user_company_monitoring_rules rule
    where rule.user_id = p_user_id
      and rule.created_by_judgment_revision_id = v_existing.id;
    return jsonb_build_object(
      'judgment_id', v_existing.judgment_id,
      'revision_id', v_existing.id,
      'revision_number', v_existing.revision_number,
      'created_rule_ids', v_existing_created_rule_ids,
      'idempotent_replay', true
    );
  end if;

  if (
    p_next_action <> 'complete'
    or jsonb_array_length(coalesce(p_monitoring_rules, '[]'::jsonb)) > 0
  ) and not exists (
    select 1
    from public.user_company_marks mark
    where mark.user_id = p_user_id
      and mark.ticker = v_ticker
      and mark.coverage_status in ('exploring', 'watching', 'holding')
  ) then
    raise exception 'coverage_reactivation_required' using errcode = 'P0001';
  end if;

  select coalesce(max(revision.revision_number), 0) into v_current_revision_number
  from public.user_filing_judgment_revisions revision
  where revision.user_id = p_user_id
    and revision.filing_event_id = p_filing_event_id;
  if p_expected_revision_number is not null
    and p_expected_revision_number <> v_current_revision_number then
    raise exception 'judgment_revision_conflict' using errcode = '40001';
  end if;

  insert into public.user_filing_judgments as judgment (user_id, filing_event_id, ticker)
  values (p_user_id, p_filing_event_id, v_ticker)
  on conflict (user_id, filing_event_id) do update
    set ticker = judgment.ticker
  returning * into v_judgment;

  update public.user_filing_judgment_revisions
  set is_current = false
  where judgment_id = v_judgment.id and is_current;
  update public.user_filing_judgment_thesis_links
  set is_current = false
  where judgment_id = v_judgment.id and is_current;

  insert into public.user_filing_judgment_revisions (
    judgment_id, user_id, filing_event_id, ticker, revision_number,
    impact, next_action, summary, rationale, is_current, idempotency_key,
    request_payload
  ) values (
    v_judgment.id, p_user_id, p_filing_event_id, v_ticker,
    coalesce((select max(revision_number) + 1 from public.user_filing_judgment_revisions where judgment_id = v_judgment.id), 1),
    p_impact, p_next_action, trim(p_summary), coalesce(p_rationale, ''), true,
    trim(p_idempotency_key), v_request_payload
  ) returning * into v_revision;

  v_position := 0;
  for v_link in select value from jsonb_array_elements(coalesce(p_thesis_links, '[]'::jsonb)) loop
    select thesis.* into v_thesis
    from public.user_company_theses thesis
    where thesis.id = (v_link ->> 'thesis_id')::uuid
      and thesis.user_id = p_user_id
      and thesis.ticker = v_ticker;
    if not found then raise exception 'invalid thesis link' using errcode = '22023'; end if;
    if coalesce(v_link ->> 'impact', p_impact) not in ('positive', 'neutral', 'negative', 'unclear') then raise exception 'invalid thesis link impact' using errcode = '22023'; end if;
    insert into public.user_filing_judgment_thesis_links (
      revision_id, judgment_id, user_id, filing_event_id, ticker, thesis_id,
      impact, position, is_current
    ) values (
      v_revision.id, v_judgment.id, p_user_id, p_filing_event_id, v_ticker,
      v_thesis.id, coalesce(v_link ->> 'impact', p_impact), v_position, true
    );
    v_position := v_position + 1;
  end loop;

  v_position := 0;
  for v_rule in select value from jsonb_array_elements(coalesce(p_monitoring_rules, '[]'::jsonb)) loop
    v_rule_type := trim(coalesce(v_rule ->> 'rule_type', ''));
    v_operator := trim(coalesce(v_rule ->> 'operator', ''));
    v_value := nullif(trim(coalesce(v_rule ->> 'value', '')), '');
    v_next_review_at := case when nullif(v_rule ->> 'next_review_at', '') is null then null else (v_rule ->> 'next_review_at')::timestamptz end;
    if v_rule_type = 'scheduled_review' then
      if v_operator <> 'on_or_after' or v_value is not null or v_next_review_at is null then raise exception 'invalid scheduled review rule' using errcode = '22023'; end if;
      v_dedupe_key := v_rule_type || '|' || v_operator || '|' || v_next_review_at::text;
    elsif v_rule_type in ('filing_form', 'filing_item', 'keyword') then
      if v_operator not in ('matches', 'contains') or v_value is null or char_length(v_value) > 500 or v_next_review_at is not null then raise exception 'invalid monitoring rule' using errcode = '22023'; end if;
      v_dedupe_key := v_rule_type || '|' || v_operator || '|' || lower(v_value);
    else
      raise exception 'invalid monitoring rule type' using errcode = '22023';
    end if;

    select exists (
      select 1
      from public.user_company_monitoring_rules existing_rule
      where existing_rule.user_id = p_user_id
        and existing_rule.ticker = v_ticker
        and existing_rule.dedupe_key = v_dedupe_key
    ) into v_rule_existed;

    insert into public.user_company_monitoring_rules as rule (
      user_id, ticker, rule_type, operator, value, next_review_at, dedupe_key,
      enabled, created_by_judgment_revision_id
    ) values (
      p_user_id, v_ticker, v_rule_type, v_operator, v_value, v_next_review_at,
      v_dedupe_key, true, v_revision.id
    )
    on conflict (user_id, ticker, dedupe_key) do update
    set enabled = true,
        value = excluded.value,
        next_review_at = excluded.next_review_at,
        updated_at = now()
    returning * into v_rule_row;

    insert into public.user_filing_judgment_monitoring_rules (
      revision_id, rule_id, user_id, position
    ) values (v_revision.id, v_rule_row.id, p_user_id, v_position)
    on conflict do nothing;
    if not v_rule_existed then
      v_created_rule_ids := v_created_rule_ids || jsonb_build_array(v_rule_row.id);
    end if;
    v_position := v_position + 1;
  end loop;

  -- A full-replacement revision must not leave superseded rules active. Keep a
  -- shared rule enabled only while at least one current judgment still links it.
  update public.user_company_monitoring_rules rule
  set enabled = false, updated_at = now()
  where rule.user_id = p_user_id
    and rule.ticker = v_ticker
    and rule.created_by_judgment_revision_id is not null
    and exists (
      select 1
      from public.user_filing_judgment_monitoring_rules old_link
      join public.user_filing_judgment_revisions old_revision
        on old_revision.id = old_link.revision_id
       and old_revision.user_id = old_link.user_id
      where old_link.rule_id = rule.id
        and old_revision.judgment_id = v_judgment.id
        and old_revision.id <> v_revision.id
    )
    and not exists (
      select 1
      from public.user_filing_judgment_monitoring_rules current_link
      join public.user_filing_judgment_revisions current_revision
        on current_revision.id = current_link.revision_id
       and current_revision.user_id = current_link.user_id
      where current_link.rule_id = rule.id
        and current_revision.is_current
    );

  update public.user_filing_judgments
  set current_revision_id = v_revision.id, updated_at = now()
  where id = v_judgment.id and user_id = p_user_id;

  insert into public.user_pulse_item_states as state (
    user_id, item_key, source_type, source_id, kind,
    first_seen_at, last_seen_at, reviewed_at
  ) values (
    p_user_id, 'filing:' || p_filing_event_id::text, 'filing',
    p_filing_event_id::text, 'filing', now(), now(), now()
  )
  on conflict (user_id, item_key) do update
  set reviewed_at = coalesce(state.reviewed_at, excluded.reviewed_at),
      last_seen_at = greatest(state.last_seen_at, excluded.last_seen_at),
      updated_at = now();

  return jsonb_build_object(
    'judgment_id', v_judgment.id,
    'revision_id', v_revision.id,
    'revision_number', v_revision.revision_number,
    'created_rule_ids', v_created_rule_ids,
    'idempotent_replay', false
  );
end;
$$;

-- Drop the legacy read alias after reviewed_at has already been backfilled.
alter table public.user_pulse_item_states drop column if exists read_at;

-- Make the only production Pulse filing candidate RPC self-contained before
-- retiring its legacy dependencies.
create or replace function public.get_catalog_pulse_filing_candidates_v3(
  p_env text,
  p_snapshot_at timestamptz,
  p_preferred_tickers text[] default '{}'::text[],
  p_urgent_limit integer default 80,
  p_priority_limit integer default 100,
  p_preferred_limit integer default 80,
  p_discovery_limit integer default 40
)
returns table (
  filing_event_id uuid, ticker text, covered_tickers text[], cik text,
  accession_number text, form_type text, is_amendment boolean,
  filing_date date, report_date date, accepted_at timestamptz,
  first_seen_at timestamptz, occurred_at timestamptz,
  feed_available_at timestamptz, feed_expires_at timestamptz,
  feed_lane smallint, feed_priority_rank smallint, alert_priority text,
  primary_event_tag text, sec_items text[], event_tags text[],
  filing_detail_url text, primary_document_url text, source_metadata jsonb,
  processing_status text, form4_reported_purchase_value numeric,
  form4_reported_sale_value numeric, form4_tenb5_one_status text,
  form4_has_reported_open_market_trade boolean, candidate_bucket text,
  filing_brief_headline_ko text, filing_brief_summary_sentences jsonb,
  filing_brief_facts jsonb, filing_brief_question_suggestions jsonb,
  filing_brief_source_document_url text, filing_brief_generated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
#variable_conflict use_column
declare
  v_env text := lower(trim(coalesce(p_env, '')));
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, now());
  v_urgent_limit integer := greatest(0, least(coalesce(p_urgent_limit, 80), 100));
  v_priority_limit integer := greatest(0, least(coalesce(p_priority_limit, 100), 120));
  v_preferred_limit integer := greatest(0, least(coalesce(p_preferred_limit, 80), 100));
  v_discovery_limit integer := greatest(0, least(coalesce(p_discovery_limit, 40), 80));
  v_preferred_tickers text[] := array(
    select normalized.ticker from (
      select distinct upper(trim(raw_ticker)) as ticker
      from unnest(coalesce(p_preferred_tickers, '{}'::text[])) raw_ticker
      where char_length(trim(raw_ticker)) between 1 and 16
      order by upper(trim(raw_ticker)) limit 100
    ) normalized
  );
begin
  if v_env not in ('dev', 'staging', 'prod') then raise exception 'invalid filing env'; end if;
  return query
  with active_catalog_companies as (
    select company.sec_cik, array_agg(company.ticker order by company.ticker) as covered_tickers
    from public.ontology_catalog_releases release
    join public.ontology_companies company
      on company.env = release.env and company.release_id = release.release_id
    where release.env = v_env and release.active and company.sec_cik is not null
    group by company.sec_cik
  ), eligible as (
    select event.id as filing_event_id, event.ticker,
      active_catalog_companies.covered_tickers, event.cik,
      event.accession_number, event.form_type, event.is_amendment,
      event.filing_date, event.report_date, event.accepted_at,
      event.first_seen_at, event.occurred_at, event.feed_available_at,
      event.feed_expires_at, event.feed_lane, event.feed_priority_rank,
      event.alert_priority, event.primary_event_tag, event.sec_items,
      event.event_tags, event.filing_detail_url, event.primary_document_url,
      event.source_metadata, event.processing_status,
      summary.reported_purchase_value as form4_reported_purchase_value,
      summary.reported_sale_value as form4_reported_sale_value,
      summary.tenb5_one_status as form4_tenb5_one_status,
      summary.has_reported_open_market_trade as form4_has_reported_open_market_trade
    from public.sec_filing_events event
    join active_catalog_companies on active_catalog_companies.sec_cik = event.cik
    left join public.sec_form4_event_summaries summary on summary.filing_event_id = event.id
    where event.env = v_env and event.feed_eligible
      and event.processing_status = 'ready'
      and event.feed_available_at <= v_snapshot_at
      and (event.feed_expires_at is null or event.feed_expires_at > v_snapshot_at)
      and event.occurred_at >= v_snapshot_at - interval '14 days'
  ), urgent_candidates as (
    select eligible.*, 'urgent'::text as candidate_bucket, 0 as candidate_bucket_rank
    from eligible where alert_priority = 'urgent' and occurred_at >= v_snapshot_at - interval '72 hours'
    order by feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc limit v_urgent_limit
  ), priority_candidates as (
    select eligible.*, 'priority'::text as candidate_bucket, 1 as candidate_bucket_rank
    from eligible where alert_priority = 'normal' and occurred_at >= v_snapshot_at - interval '7 days'
    order by feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc limit v_priority_limit
  ), preferred_candidates as (
    select eligible.*, 'preferred'::text as candidate_bucket, 2 as candidate_bucket_rank
    from eligible where cardinality(v_preferred_tickers) > 0
      and eligible.covered_tickers && v_preferred_tickers
      and occurred_at >= v_snapshot_at - interval '14 days'
    order by feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc limit v_preferred_limit
  ), discovery_candidates as (
    select eligible.*, 'discovery'::text as candidate_bucket, 3 as candidate_bucket_rank
    from eligible where occurred_at >= v_snapshot_at - interval '7 days'
    order by feed_priority_rank asc nulls last, occurred_at desc, filing_event_id desc limit v_discovery_limit
  ), deduplicated as (
    select distinct on (filing_event_id) * from (
      select * from urgent_candidates union all select * from priority_candidates
      union all select * from preferred_candidates union all select * from discovery_candidates
    ) candidates
    order by filing_event_id, candidate_bucket_rank,
      feed_priority_rank asc nulls last, occurred_at desc
  )
  select candidate.filing_event_id, candidate.ticker, candidate.covered_tickers,
    candidate.cik, candidate.accession_number, candidate.form_type,
    candidate.is_amendment, candidate.filing_date, candidate.report_date,
    candidate.accepted_at, candidate.first_seen_at, candidate.occurred_at,
    candidate.feed_available_at, candidate.feed_expires_at, candidate.feed_lane,
    candidate.feed_priority_rank, candidate.alert_priority,
    candidate.primary_event_tag, candidate.sec_items, candidate.event_tags,
    candidate.filing_detail_url, candidate.primary_document_url,
    candidate.source_metadata, candidate.processing_status,
    candidate.form4_reported_purchase_value, candidate.form4_reported_sale_value,
    candidate.form4_tenb5_one_status, candidate.form4_has_reported_open_market_trade,
    candidate.candidate_bucket, brief.headline_ko, brief.summary_sentences,
    brief.facts, brief.question_suggestions, brief.source_document_url,
    brief.generated_at
  from deduplicated candidate
  left join public.sec_filing_briefs brief
    on brief.filing_event_id = candidate.filing_event_id and brief.locale = 'ko-KR'
  order by candidate.candidate_bucket_rank,
    candidate.feed_priority_rank asc nulls last, candidate.occurred_at desc,
    candidate.filing_event_id desc
  limit v_urgent_limit + v_priority_limit + v_preferred_limit + v_discovery_limit;
end;
$$;

create or replace function public.try_record_coverage_activation(
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coverage_count integer;
  v_judgment_count integer;
  v_monitoring_rule_count integer;
  v_completed_loop_count integer;
  v_row_count integer := 0;
  v_inserted boolean := false;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_coverage_count
  from public.user_company_marks mark
  where mark.user_id = p_user_id
    and mark.coverage_status in ('exploring', 'watching', 'holding');

  select count(distinct judgment.id) into v_judgment_count
  from public.user_filing_judgments judgment
  join public.sec_filing_events event
    on event.id = judgment.filing_event_id
  join public.ontology_catalog_releases release
    on release.env = event.env
   and release.active
  join public.ontology_companies company
    on company.env = release.env
   and company.release_id = release.release_id
   and company.sec_cik = event.cik
  join public.user_company_marks mark
    on mark.user_id = judgment.user_id
   and mark.ticker = company.ticker
   and mark.coverage_status in ('exploring', 'watching', 'holding')
  where judgment.user_id = p_user_id
    and judgment.current_revision_id is not null;

  select count(distinct rule.id) into v_monitoring_rule_count
  from public.user_company_monitoring_rules rule
  join public.ontology_catalog_releases release
    on release.active
  join public.ontology_companies rule_company
    on rule_company.env = release.env
   and rule_company.release_id = release.release_id
   and rule_company.ticker = rule.ticker
  join public.ontology_companies covered_company
    on covered_company.env = rule_company.env
   and covered_company.release_id = rule_company.release_id
   and covered_company.sec_cik = rule_company.sec_cik
  join public.user_company_marks mark
    on mark.user_id = rule.user_id
   and mark.ticker = covered_company.ticker
   and mark.coverage_status in ('exploring', 'watching', 'holding')
  where rule.user_id = p_user_id and rule.enabled;

  select count(distinct judgment.id) into v_completed_loop_count
  from public.user_filing_judgments judgment
  join public.sec_filing_events event
    on event.id = judgment.filing_event_id
  join public.ontology_catalog_releases release
    on release.env = event.env
   and release.active
  join public.ontology_companies company
    on company.env = release.env
   and company.release_id = release.release_id
   and company.sec_cik = event.cik
  join public.user_company_marks mark
    on mark.user_id = judgment.user_id
   and mark.ticker = company.ticker
   and mark.coverage_status in ('exploring', 'watching', 'holding')
  join public.user_filing_source_opens source_open
    on source_open.user_id = judgment.user_id
   and source_open.filing_event_id = judgment.filing_event_id
  join public.user_filing_judgment_monitoring_rules judgment_rule
    on judgment_rule.user_id = judgment.user_id
   and judgment_rule.revision_id = judgment.current_revision_id
  join public.user_company_monitoring_rules rule
    on rule.id = judgment_rule.rule_id
   and rule.user_id = judgment.user_id
   and rule.ticker = judgment.ticker
   and rule.enabled
  where judgment.user_id = p_user_id
    and judgment.current_revision_id is not null;

  if v_coverage_count < 3
    or v_judgment_count < 1
    or v_monitoring_rule_count < 1
    or v_completed_loop_count < 1 then
    return false;
  end if;

  insert into public.user_retention_milestones (
    user_id, milestone, metadata
  ) values (
    p_user_id,
    'coverage_activated',
    jsonb_build_object(
      'coverage_count', v_coverage_count,
      'judgment_count', v_judgment_count,
      'monitoring_rule_count', v_monitoring_rule_count,
      'completed_loop_count', v_completed_loop_count
    )
  )
  on conflict (user_id, milestone) do nothing;
  get diagnostics v_row_count = row_count;
  v_inserted := v_row_count = 1;

  if v_inserted then
    insert into public.analytics_events (
      user_id, event_name, properties
    ) values (
      p_user_id,
      'coverage_activated',
      jsonb_build_object(
        'source', 'system',
        'source_type', 'coverage',
        'status', 'completed',
        'coverage_count', v_coverage_count,
        'judgment_count', v_judgment_count,
        'monitoring_rule_count', v_monitoring_rule_count,
        'completed_loop_count', v_completed_loop_count
      )
    );
  end if;

  return v_inserted;
end;
$$;

create or replace function public.close_user_decision_session(
  p_user_id uuid,
  p_feed_session_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text := trim(coalesce(p_timezone, ''));
  v_snapshot_at timestamptz := now();
  v_local_date date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_session_item_count integer;
  v_unresolved_session_count integer;
  v_judgment_count integer;
  v_observation_count integer;
  v_thesis_update_count integer;
  v_open_question_count integer;
  v_next_check_count integer;
  v_outcome text;
  v_session public.user_decision_sessions%rowtype;
begin
  if p_user_id is null or p_feed_session_id is null then
    raise exception 'user and feed session are required' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'invalid timezone' using errcode = '22023';
  end if;
  select count(*)::integer,
         count(*) filter (
           where state.reviewed_at is null
             and state.dismissed_at is null
         )::integer
    into v_session_item_count, v_unresolved_session_count
  from public.user_pulse_item_states state
  where state.user_id = p_user_id
    and state.last_impression_session_id = p_feed_session_id
    and state.last_impression_at >= v_snapshot_at - interval '24 hours'
    and state.last_impression_at <= v_snapshot_at + interval '5 minutes';
  if v_session_item_count = 0 then
    raise exception 'unknown_or_expired_feed_session' using errcode = '22023';
  end if;

  v_local_date := (v_snapshot_at at time zone v_timezone)::date;
  v_day_start := v_local_date::timestamp at time zone v_timezone;
  v_day_end := (v_local_date + 1)::timestamp at time zone v_timezone;

  select
    count(distinct revision.judgment_id)::integer,
    count(distinct revision.judgment_id) filter (
      where revision.next_action = 'review_later'
    )::integer,
    count(distinct revision.judgment_id) filter (
      where revision.next_action = 'update_thesis'
    )::integer
    into v_judgment_count, v_observation_count, v_thesis_update_count
  from public.user_filing_judgment_revisions revision
  join public.user_filing_judgments judgment
    on judgment.id = revision.judgment_id
   and judgment.user_id = revision.user_id
   and judgment.current_revision_id = revision.id
  where revision.user_id = p_user_id
    and revision.created_at >= v_day_start
    and revision.created_at < v_day_end;

  select count(*)::integer into v_open_question_count
  from public.user_company_questions question
  where question.user_id = p_user_id
    and question.status = 'open';

  select count(*)::integer into v_next_check_count
  from public.user_company_monitoring_rules rule
  where rule.user_id = p_user_id
    and rule.enabled;

  v_outcome := case when v_unresolved_session_count = 0 then 'completed' else 'deferred' end;
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_local_date::text, 734253)
  );

  select session.* into v_session
  from public.user_decision_sessions session
  where session.user_id = p_user_id and session.local_date = v_local_date;
  if found then
    return jsonb_build_object(
      'id', v_session.id,
      'local_date', v_session.local_date,
      'closed_at', v_session.closed_at,
      'judgment_count', v_session.judgment_count,
      'observation_count', v_session.observation_count,
      'thesis_update_count', v_session.thesis_update_count,
      'open_question_count', v_session.open_question_count,
      'next_check_count', v_session.next_check_count,
      'outcome', v_session.outcome,
      'idempotent_replay', true
    );
  end if;

  insert into public.user_decision_sessions (
    user_id, local_date, timezone, feed_session_id, snapshot_at,
    judgment_count, observation_count, thesis_update_count,
    open_question_count, next_check_count, outcome
  ) values (
    p_user_id, v_local_date, v_timezone, p_feed_session_id, v_snapshot_at,
    v_judgment_count, v_observation_count, v_thesis_update_count,
    v_open_question_count, v_next_check_count, v_outcome
  ) returning * into v_session;

  insert into public.analytics_events (
    user_id, event_name, properties
  ) values (
    p_user_id,
    'decision_session_closed',
    jsonb_build_object(
      'decision_session_id', p_feed_session_id,
      'source', 'pulse',
      'source_type', 'decision_session',
      'status', 'closed',
      'outcome', v_outcome,
      'judgment_count', v_judgment_count,
      'observation_count', v_observation_count,
      'thesis_update_count', v_thesis_update_count,
      'open_question_count', v_open_question_count
    )
  );

  return jsonb_build_object(
    'id', v_session.id,
    'local_date', v_session.local_date,
    'closed_at', v_session.closed_at,
    'judgment_count', v_session.judgment_count,
    'observation_count', v_session.observation_count,
    'thesis_update_count', v_session.thesis_update_count,
    'open_question_count', v_session.open_question_count,
    'next_check_count', v_session.next_check_count,
    'outcome', v_session.outcome,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.record_pulse_item_impressions(
  p_user_id uuid,
  p_items jsonb,
  p_feed_session_id uuid,
  p_seen_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_count integer := 0;
begin
  if p_user_id is null or p_feed_session_id is null then
    raise exception 'user and feed session are required' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'invalid impression items' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item ->> 'kind', '') not in (
      'filing', 'analysis', 'checkup', 'question', 'resurface', 'learning'
    ) or char_length(coalesce(v_item ->> 'item_key', '')) not between 3 and 1000
      or char_length(coalesce(v_item ->> 'source_id', '')) not between 1 and 1000
      or (v_item ->> 'source_type') <> (v_item ->> 'kind') then
      raise exception 'invalid impression item' using errcode = '22023';
    end if;
    perform public.record_pulse_item_impression(
      p_user_id,
      v_item ->> 'item_key',
      v_item ->> 'source_type',
      v_item ->> 'source_id',
      v_item ->> 'kind',
      p_feed_session_id,
      coalesce(p_seen_at, now())
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.resolve_scheduled_monitoring_pulse_item(
  p_user_id uuid,
  p_rule_id uuid,
  p_item_key text,
  p_action text,
  p_resolved_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule public.user_company_monitoring_rules%rowtype;
  v_state public.user_pulse_item_states%rowtype;
begin
  if p_user_id is null or p_rule_id is null then
    raise exception 'user and rule are required' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_action not in ('review', 'dismiss')
     or p_item_key <> ('resurface:monitoring:' || p_rule_id::text) then
    raise exception 'invalid scheduled resolution' using errcode = '22023';
  end if;

  select rule.* into v_rule
  from public.user_company_monitoring_rules rule
  where rule.id = p_rule_id
    and rule.user_id = p_user_id
    and rule.rule_type = 'scheduled_review'
  for update;
  if not found then
    raise exception 'scheduled_monitoring_rule_not_found' using errcode = 'P0002';
  end if;

  update public.user_company_monitoring_rules
  set enabled = false, updated_at = coalesce(p_resolved_at, now())
  where id = p_rule_id and user_id = p_user_id;

  insert into public.user_pulse_item_states as state (
    user_id, item_key, source_type, source_id, kind,
    first_seen_at, last_seen_at, reviewed_at, dismissed_at
  ) values (
    p_user_id, p_item_key, 'resurface', 'monitoring:' || p_rule_id::text,
    'resurface', coalesce(p_resolved_at, now()), coalesce(p_resolved_at, now()),
    case when p_action = 'review' then coalesce(p_resolved_at, now()) else null end,
    case when p_action = 'dismiss' then coalesce(p_resolved_at, now()) else null end
  )
  on conflict (user_id, item_key) do update
  set last_seen_at = excluded.last_seen_at,
      reviewed_at = case
        when p_action = 'review' then excluded.reviewed_at
        else state.reviewed_at
      end,
      dismissed_at = case
        when p_action = 'dismiss' then excluded.dismissed_at
        else state.dismissed_at
      end,
      updated_at = coalesce(p_resolved_at, now())
  returning * into v_state;

  return jsonb_build_object(
    'reviewed_at', v_state.reviewed_at,
    'saved_at', v_state.saved_at,
    'snoozed_until', v_state.snoozed_until,
    'dismissed_at', v_state.dismissed_at
  );
end;
$$;

do $$
declare legacy record;
begin
  for legacy in
    select oid::regprocedure as signature
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'get_catalog_global_filing_feed',
        'get_catalog_pulse_filing_candidates',
        'get_catalog_pulse_filing_candidates_v2'
      )
  loop
    execute format('drop function if exists %s', legacy.signature);
  end loop;
end;
$$;

alter table public.user_company_coverage_events enable row level security;
alter table public.user_filing_judgments enable row level security;
alter table public.user_filing_judgment_revisions enable row level security;
alter table public.user_filing_judgment_thesis_links enable row level security;
alter table public.user_company_monitoring_rules enable row level security;
alter table public.user_filing_judgment_monitoring_rules enable row level security;
alter table public.user_filing_source_opens enable row level security;
alter table public.user_retention_milestones enable row level security;
alter table public.user_decision_sessions enable row level security;

drop policy if exists "user_company_marks_insert_own" on public.user_company_marks;
drop policy if exists "user_company_marks_update_own" on public.user_company_marks;
drop policy if exists "user_company_marks_delete_own" on public.user_company_marks;
revoke insert, update, delete on table public.user_company_marks from authenticated;
revoke insert, update, delete on table public.user_company_questions from authenticated;
revoke insert, update, delete on table public.user_company_cards from authenticated;
revoke insert, update, delete on table public.user_company_notebooks from authenticated;
revoke insert, update, delete on table public.user_company_notebook_refresh_jobs from authenticated;
revoke insert, update, delete on table public.user_company_theses from authenticated;
revoke insert, update, delete on table public.user_thesis_checks from authenticated;
revoke insert, update, delete on table public.user_research_notes from authenticated;
revoke insert, update, delete on table public.user_pulse_item_states from authenticated;

revoke all on table public.user_company_coverage_events from public, anon, authenticated;
revoke all on table public.user_filing_judgments from public, anon, authenticated;
revoke all on table public.user_filing_judgment_revisions from public, anon, authenticated;
revoke all on table public.user_filing_judgment_thesis_links from public, anon, authenticated;
revoke all on table public.user_company_monitoring_rules from public, anon, authenticated;
revoke all on table public.user_filing_judgment_monitoring_rules from public, anon, authenticated;
revoke all on table public.user_filing_source_opens from public, anon, authenticated;
revoke all on table public.user_retention_milestones from public, anon, authenticated;
revoke all on table public.user_decision_sessions from public, anon, authenticated;

grant select on table public.user_company_coverage_events to authenticated;
grant select on table public.user_filing_judgments to authenticated;
grant select on table public.user_filing_judgment_revisions to authenticated;
grant select on table public.user_filing_judgment_thesis_links to authenticated;
grant select on table public.user_company_monitoring_rules to authenticated;
grant select on table public.user_filing_judgment_monitoring_rules to authenticated;
grant select on table public.user_filing_source_opens to authenticated;
grant select on table public.user_retention_milestones to authenticated;
grant select on table public.user_decision_sessions to authenticated;
grant select, insert, update, delete on table public.user_company_coverage_events to service_role;
grant select, insert, update, delete on table public.user_filing_judgments to service_role;
grant select, insert, update, delete on table public.user_filing_judgment_revisions to service_role;
grant select, insert, update, delete on table public.user_filing_judgment_thesis_links to service_role;
grant select, insert, update, delete on table public.user_company_monitoring_rules to service_role;
grant select, insert, update, delete on table public.user_filing_judgment_monitoring_rules to service_role;
grant select, insert, update, delete on table public.user_filing_source_opens to service_role;
grant select, insert, update, delete on table public.user_retention_milestones to service_role;
grant select, insert, update, delete on table public.user_decision_sessions to service_role;

create policy "user_company_coverage_events_select_own" on public.user_company_coverage_events
  for select to authenticated using (user_id = auth.uid());
create policy "user_filing_judgments_select_own" on public.user_filing_judgments
  for select to authenticated using (user_id = auth.uid());
create policy "user_filing_judgment_revisions_select_own" on public.user_filing_judgment_revisions
  for select to authenticated using (user_id = auth.uid());
create policy "user_filing_judgment_thesis_links_select_own" on public.user_filing_judgment_thesis_links
  for select to authenticated using (user_id = auth.uid());
create policy "user_company_monitoring_rules_select_own" on public.user_company_monitoring_rules
  for select to authenticated using (user_id = auth.uid());
create policy "user_filing_judgment_monitoring_rules_select_own" on public.user_filing_judgment_monitoring_rules
  for select to authenticated using (user_id = auth.uid());
create policy "user_filing_source_opens_select_own" on public.user_filing_source_opens
  for select to authenticated using (user_id = auth.uid());
create policy "user_retention_milestones_select_own" on public.user_retention_milestones
  for select to authenticated using (user_id = auth.uid());
create policy "user_decision_sessions_select_own" on public.user_decision_sessions
  for select to authenticated using (user_id = auth.uid());

revoke all on function public.set_user_company_coverage_status(uuid, text, text, text, text, integer, text, text[], integer)
  from public, anon, authenticated;
grant execute on function public.set_user_company_coverage_status(uuid, text, text, text, text, integer, text, text[], integer)
  to service_role;
revoke all on function public.reconcile_user_company_coverage_limit(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_user_company_coverage_limit(uuid, integer, text)
  to service_role;
revoke all on function public.reconcile_coverage_on_entitlement_change()
  from public, anon, authenticated;
revoke all on function public.sweep_expired_company_coverage_limits(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.sweep_expired_company_coverage_limits(timestamptz, integer)
  to service_role;
revoke all on function public.save_user_filing_judgment_revision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, integer)
  from public, anon, authenticated;
grant execute on function public.save_user_filing_judgment_revision(uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, integer)
  to service_role;
revoke all on function public.try_record_coverage_activation(uuid)
  from public, anon, authenticated;
grant execute on function public.try_record_coverage_activation(uuid)
  to service_role;
revoke all on function public.close_user_decision_session(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.close_user_decision_session(uuid, uuid, text)
  to service_role;
revoke all on function public.record_pulse_item_impressions(uuid, jsonb, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_pulse_item_impressions(uuid, jsonb, uuid, timestamptz)
  to service_role;
revoke all on function public.resolve_scheduled_monitoring_pulse_item(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_scheduled_monitoring_pulse_item(uuid, uuid, text, text, timestamptz)
  to service_role;
revoke all on function public.get_catalog_pulse_filing_candidates_v3(text, timestamptz, text[], integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_catalog_pulse_filing_candidates_v3(text, timestamptz, text[], integer, integer, integer, integer)
  to service_role;

notify pgrst, 'reload schema';
