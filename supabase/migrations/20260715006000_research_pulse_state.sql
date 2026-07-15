create table if not exists public.user_pulse_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Seoul',
  enabled_kinds text[] not null default array['filing', 'checkup', 'question', 'resurface', 'learning']::text[],
  muted_tickers text[] not null default '{}'::text[],
  daily_checkup_enabled boolean not null default true,
  daily_checkup_at time not null default '08:30:00',
  question_cadence text not null default 'daily',
  resurface_cadence text not null default 'weekly',
  learning_cadence text not null default 'weekly',
  learning_enabled boolean not null default true,
  resurfacing_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_pulse_preferences_timezone_length check (char_length(timezone) between 1 and 80),
  constraint user_pulse_preferences_enabled_kinds check (
    enabled_kinds <@ array['filing', 'checkup', 'question', 'resurface', 'learning']::text[]
  ),
  constraint user_pulse_preferences_question_cadence check (question_cadence in ('daily', 'three_weekly', 'off')),
  constraint user_pulse_preferences_resurface_cadence check (resurface_cadence in ('weekly', 'biweekly', 'off')),
  constraint user_pulse_preferences_learning_cadence check (learning_cadence in ('weekly', 'off')),
  constraint user_pulse_preferences_muted_tickers_count check (cardinality(muted_tickers) <= 200)
);

create table if not exists public.user_pulse_item_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  source_type text not null,
  source_id text not null,
  kind text not null,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  view_count integer not null default 0,
  read_at timestamptz,
  saved_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  last_impression_at timestamptz,
  impression_count integer not null default 0,
  feedback smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_pulse_item_states_item_key_length check (char_length(item_key) between 3 and 300),
  constraint user_pulse_item_states_source_type check (
    source_type in ('filing', 'checkup', 'question', 'resurface', 'learning')
  ),
  constraint user_pulse_item_states_kind check (
    kind in ('filing', 'checkup', 'question', 'resurface', 'learning')
  ),
  constraint user_pulse_item_states_source_id_length check (char_length(source_id) between 1 and 240),
  constraint user_pulse_item_states_impression_count check (impression_count >= 0),
  constraint user_pulse_item_states_view_count check (view_count >= 0),
  constraint user_pulse_item_states_feedback check (feedback is null or feedback in (-1, 1)),
  primary key (user_id, item_key)
);

create index if not exists idx_user_pulse_item_states_active
  on public.user_pulse_item_states (user_id, dismissed_at, snoozed_until, updated_at desc);

create index if not exists idx_user_pulse_item_states_source
  on public.user_pulse_item_states (user_id, source_type, source_id);

drop trigger if exists trg_user_pulse_preferences_updated_at on public.user_pulse_preferences;
create trigger trg_user_pulse_preferences_updated_at
  before update on public.user_pulse_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_pulse_item_states_updated_at on public.user_pulse_item_states;
create trigger trg_user_pulse_item_states_updated_at
  before update on public.user_pulse_item_states
  for each row execute function public.set_updated_at();

alter table public.user_pulse_preferences enable row level security;
alter table public.user_pulse_item_states enable row level security;

revoke all on table public.user_pulse_preferences from public, anon, authenticated;
revoke all on table public.user_pulse_item_states from public, anon, authenticated;

grant select, insert, update, delete on table public.user_pulse_preferences to service_role;
grant select, insert, update, delete on table public.user_pulse_item_states to service_role;
grant select, insert, update, delete on table public.user_pulse_preferences to authenticated;
grant select, insert, update, delete on table public.user_pulse_item_states to authenticated;

create policy "user_pulse_preferences_own" on public.user_pulse_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "user_pulse_item_states_own" on public.user_pulse_item_states
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
