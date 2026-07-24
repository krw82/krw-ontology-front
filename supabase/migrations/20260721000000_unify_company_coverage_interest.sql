-- A company is either in a user's research coverage or it is not. "holding"
-- was only a UI/ranking distinction; normalize it into the single active
-- coverage state so notifications, monitoring, and Pulse all use one signal.

update public.user_company_marks
set coverage_level = 'interest',
    updated_at = now()
where coverage_level = 'holding';

update public.user_company_coverage_events
set previous_coverage_level = case
      when previous_coverage_level = 'holding' then 'interest'
      else previous_coverage_level
    end,
    coverage_level = case
      when coverage_level = 'holding' then 'interest'
      else coverage_level
    end;

-- Preserve the event log while removing a state transition that no longer
-- exists. A historical holding-to-interest transition is now an unchanged
-- active-coverage event.
update public.user_company_coverage_events
set event_type = case
  when coverage_level is null then 'cleared'
  when previous_coverage_level is null then 'selected'
  when previous_coverage_level is distinct from coverage_level then 'level_changed'
  else 'unchanged'
end;

-- Idempotent mutation replays must return the canonical value, not a stale
-- holding label from before the schema change.
update public.user_company_coverage_events
set request_payload = replace(request_payload::text, '"holding"', '"interest"')::jsonb,
    response_payload = replace(response_payload::text, '"holding"', '"interest"')::jsonb
where request_payload::text like '%"holding"%'
   or response_payload::text like '%"holding"%';

alter table public.user_company_marks
  drop constraint if exists user_company_marks_coverage_level_check;

alter table public.user_company_marks
  add constraint user_company_marks_coverage_level_check
    check (coverage_level is null or coverage_level = 'interest');

alter table public.user_company_coverage_events
  drop constraint if exists user_company_coverage_events_previous_coverage_level_check,
  drop constraint if exists user_company_coverage_events_coverage_level_check;

alter table public.user_company_coverage_events
  add constraint user_company_coverage_events_previous_coverage_level_check
    check (previous_coverage_level is null or previous_coverage_level = 'interest'),
  add constraint user_company_coverage_events_coverage_level_check
    check (coverage_level is null or coverage_level = 'interest');

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
  v_previous_coverage_level text;
  v_event_id uuid;
  v_cleared_tickers text[] := '{}'::text[];
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
    where mark.user_id = p_user_id and mark.coverage_level is not null
    order by
      case when mark.ticker = v_preferred_ticker then 0 else 1 end,
      mark.priority desc,
      coalesce(mark.last_activity_at, mark.updated_at) desc,
      mark.ticker
    offset p_active_limit
  loop
    v_previous_coverage_level := v_mark.coverage_level;
    update public.user_company_marks mark
    set coverage_level = null,
        coverage_cleared_at = now(),
        last_activity_at = now(),
        updated_at = now()
    where mark.user_id = p_user_id and mark.ticker = v_mark.ticker
    returning * into v_mark;

    update public.user_company_monitoring_rules rule
    set enabled = false, updated_at = now()
    where rule.user_id = p_user_id and rule.ticker = v_mark.ticker and rule.enabled;

    v_event_id := gen_random_uuid();
    insert into public.user_company_coverage_events (
      id, user_id, ticker, previous_coverage_level, coverage_level, event_type,
      changed, source, idempotency_key, request_payload, response_payload
    ) values (
      v_event_id, p_user_id, v_mark.ticker, v_previous_coverage_level, null,
      'plan_reconciliation', true, 'plan_reconciliation',
      'plan-reconcile:' || v_event_id::text,
      jsonb_build_object(
        'ticker', v_mark.ticker,
        'coverage_level', null,
        'source', 'plan_reconciliation',
        'active_limit', p_active_limit
      ),
      jsonb_build_object(
        'mark', to_jsonb(v_mark),
        'event_id', v_event_id,
        'previous_coverage_level', v_previous_coverage_level,
        'coverage_level', null,
        'changed', true,
        'idempotent_replay', false,
        'reconciled', true
      )
    );
    v_cleared_tickers := array_append(v_cleared_tickers, v_mark.ticker);
  end loop;
  return v_cleared_tickers;
end;
$$;

create or replace function public.set_user_company_coverage_level(
  p_user_id uuid,
  p_ticker text,
  p_coverage_level text,
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
  v_coverage_level text := nullif(lower(trim(coalesce(p_coverage_level, ''))), '');
  v_key text := trim(coalesce(p_idempotency_key, ''));
  v_source text := trim(coalesce(p_source, 'api'));
  v_previous_coverage_level text;
  v_active_count integer;
  v_event public.user_company_coverage_events%rowtype;
  v_event_id uuid;
  v_mark public.user_company_marks%rowtype;
  v_request_payload jsonb;
  v_event_type text;
begin
  if p_user_id is null then raise exception 'p_user_id is required' using errcode = '22023'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_ticker) not between 1 and 16 then raise exception 'invalid ticker' using errcode = '22023'; end if;
  if v_coverage_level is not null and v_coverage_level <> 'interest' then raise exception 'invalid coverage level' using errcode = '22023'; end if;
  if char_length(v_key) not between 8 and 200 then raise exception 'invalid idempotency key' using errcode = '22023'; end if;
  if char_length(v_source) not between 1 and 80 then raise exception 'invalid source' using errcode = '22023'; end if;
  if p_active_limit is not null and p_active_limit < 0 then raise exception 'invalid active limit' using errcode = '22023'; end if;

  v_request_payload := jsonb_build_object(
    'ticker', v_ticker,
    'coverage_level', v_coverage_level,
    'source', v_source,
    'priority', p_priority,
    'interest_reason', p_interest_reason,
    'tags', to_jsonb(p_tags)
  );
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 734251));

  select event.* into v_event
  from public.user_company_coverage_events event
  where event.user_id = p_user_id and event.idempotency_key = v_key;
  if found then
    if v_event.request_payload <> v_request_payload then
      raise exception 'idempotency_key_conflict' using errcode = '22023';
    end if;
    select mark.* into strict v_mark
    from public.user_company_marks mark
    where mark.user_id = p_user_id and mark.ticker = v_ticker;
    return jsonb_set(v_event.response_payload, '{mark}', to_jsonb(v_mark), true);
  end if;

  select mark.coverage_level into v_previous_coverage_level
  from public.user_company_marks mark
  where mark.user_id = p_user_id and mark.ticker = v_ticker
  for update;

  if v_coverage_level is not null and v_previous_coverage_level is null and p_active_limit is not null then
    select count(*) into v_active_count
    from public.user_company_marks mark
    where mark.user_id = p_user_id and mark.coverage_level is not null;
    if v_active_count >= p_active_limit then
      raise exception 'coverage_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  insert into public.user_company_marks as mark (
    user_id, ticker, coverage_level, coverage_cleared_at, priority,
    interest_reason, tags, last_activity_at, updated_at
  ) values (
    p_user_id, v_ticker, v_coverage_level,
    case when v_coverage_level is null then now() else null end,
    coalesce(p_priority, 0), p_interest_reason, coalesce(p_tags, '{}'::text[]),
    now(), now()
  ) on conflict (user_id, ticker) do update set
    coverage_level = excluded.coverage_level,
    coverage_cleared_at = case when excluded.coverage_level is null then now() else null end,
    priority = coalesce(p_priority, mark.priority),
    interest_reason = case when p_interest_reason is null then mark.interest_reason else p_interest_reason end,
    tags = coalesce(p_tags, mark.tags),
    last_activity_at = now(),
    updated_at = now();

  select mark.* into strict v_mark
  from public.user_company_marks mark
  where mark.user_id = p_user_id and mark.ticker = v_ticker;

  if v_coverage_level is null then
    update public.user_company_monitoring_rules rule
    set enabled = false, updated_at = now()
    where rule.user_id = p_user_id and rule.ticker = v_ticker and rule.enabled;
  end if;

  v_event_type := case
    when v_coverage_level is null then 'cleared'
    when v_previous_coverage_level is null then 'selected'
    else 'unchanged'
  end;
  v_event_id := gen_random_uuid();
  insert into public.user_company_coverage_events (
    id, user_id, ticker, previous_coverage_level, coverage_level, event_type,
    changed, source, idempotency_key, request_payload, response_payload
  ) values (
    v_event_id, p_user_id, v_ticker, v_previous_coverage_level,
    v_coverage_level, v_event_type,
    v_previous_coverage_level is distinct from v_coverage_level,
    v_source, v_key, v_request_payload,
    jsonb_build_object(
      'mark', to_jsonb(v_mark),
      'event_id', v_event_id,
      'previous_coverage_level', v_previous_coverage_level,
      'coverage_level', v_coverage_level,
      'changed', v_previous_coverage_level is distinct from v_coverage_level,
      'idempotent_replay', false
    )
  ) returning * into v_event;
  return v_event.response_payload;
end;
$$;
