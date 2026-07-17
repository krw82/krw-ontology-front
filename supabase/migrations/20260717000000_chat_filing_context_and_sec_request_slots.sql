-- Filing-question context is a lightweight pointer to an existing metadata
-- event. It intentionally does not store an SEC document body or extracted
-- section text in Postgres.

alter table public.chat_sessions
  add column if not exists source_filing_event_id uuid
    references public.sec_filing_events(id) on delete set null;

create index if not exists idx_chat_sessions_source_filing_event_id
  on public.chat_sessions (source_filing_event_id)
  where source_filing_event_id is not null;

-- Every SEC caller (the discovery worker and the on-demand filings MCP) takes
-- a slot here before making a network request. This is operational state only:
-- no SEC response, document body, or derived filing text is retained.
create table if not exists public.sec_request_rate_limit_slots (
  scope text primary key,
  next_allowed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint sec_request_rate_limit_slots_scope_format
    check (scope ~ '^[a-z0-9:_-]{1,80}$')
);

alter table public.sec_request_rate_limit_slots enable row level security;

create or replace function public.reserve_sec_request_slot(
  p_scope text default 'global',
  p_min_interval_ms integer default 150
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_min_interval_ms integer := least(greatest(coalesce(p_min_interval_ms, 150), 100), 10000);
  v_next_allowed_at timestamptz;
  v_allowed_at timestamptz;
begin
  if v_scope !~ '^[a-z0-9:_-]{1,80}$' then
    raise exception 'invalid SEC request rate-limit scope';
  end if;

  insert into public.sec_request_rate_limit_slots (scope, next_allowed_at)
  values (v_scope, now())
  on conflict (scope) do nothing;

  select slot.next_allowed_at
    into v_next_allowed_at
    from public.sec_request_rate_limit_slots as slot
   where slot.scope = v_scope
   for update;

  v_allowed_at := greatest(now(), v_next_allowed_at);

  update public.sec_request_rate_limit_slots
     set next_allowed_at = v_allowed_at + (v_min_interval_ms * interval '1 millisecond'),
         updated_at = now()
   where scope = v_scope;

  return v_allowed_at;
end;
$$;

revoke all on table public.sec_request_rate_limit_slots from public, anon, authenticated;
revoke all on function public.reserve_sec_request_slot(text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_sec_request_slot(text, integer)
  to service_role;
