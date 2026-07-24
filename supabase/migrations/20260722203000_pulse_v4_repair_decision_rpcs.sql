-- Pulse V4 removes server-side exposure fields. These two decision RPCs were
-- intentionally retained, so rewrite only their obsolete item-state clauses
-- while preserving every validation, lock, and judgment/monitoring mutation.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.save_user_filing_judgment_revision(uuid,uuid,text,text,text,text,text,jsonb,jsonb,text,integer)'::regprocedure
  ) into v_definition;

  if position('first_seen_at, last_seen_at, reviewed_at' in v_definition) = 0
     or position('last_seen_at = greatest(state.last_seen_at, excluded.last_seen_at)' in v_definition) = 0 then
    raise exception 'save_user_filing_judgment_revision does not match the expected pre-Pulse-V4 definition';
  end if;

  v_definition := replace(
    v_definition,
    'first_seen_at, last_seen_at, reviewed_at',
    'first_seen_at, reviewed_at'
  );
  v_definition := replace(
    v_definition,
    'p_filing_event_id::text, ''filing'', now(), now(), now()',
    'p_filing_event_id::text, ''filing'', now(), now()'
  );
  v_definition := replace(
    v_definition,
    E'\n      last_seen_at = greatest(state.last_seen_at, excluded.last_seen_at),',
    ''
  );
  if position('last_seen_at' in v_definition) > 0 then
    raise exception 'save_user_filing_judgment_revision still references removed Pulse V4 state';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.resolve_scheduled_monitoring_pulse_item(uuid,uuid,text,text,timestamp with time zone)'::regprocedure
  ) into v_definition;

  if position('first_seen_at, last_seen_at, reviewed_at, dismissed_at' in v_definition) = 0
     or position('set last_seen_at = excluded.last_seen_at,' in v_definition) = 0 then
    raise exception 'resolve_scheduled_monitoring_pulse_item does not match the expected pre-Pulse-V4 definition';
  end if;

  v_definition := replace(
    v_definition,
    'first_seen_at, last_seen_at, reviewed_at, dismissed_at',
    'first_seen_at, reviewed_at, dismissed_at'
  );
  v_definition := replace(
    v_definition,
    E'''resurface'', coalesce(p_resolved_at, now()), coalesce(p_resolved_at, now()),\n    case',
    E'''resurface'', coalesce(p_resolved_at, now()),\n    case'
  );
  v_definition := replace(
    v_definition,
    E'  set last_seen_at = excluded.last_seen_at,\n',
    '  set '
  );
  if position('last_seen_at' in v_definition) > 0 then
    raise exception 'resolve_scheduled_monitoring_pulse_item still references removed Pulse V4 state';
  end if;
  execute v_definition;
end;
$$;

notify pgrst, 'reload schema';
