alter table public.user_pulse_preferences
  drop constraint if exists user_pulse_preferences_enabled_kinds;

alter table public.user_pulse_preferences
  alter column enabled_kinds set default array[
    'filing', 'analysis', 'checkup', 'question', 'resurface', 'learning'
  ]::text[];

update public.user_pulse_preferences
set enabled_kinds = array_append(enabled_kinds, 'analysis')
where not ('analysis' = any(enabled_kinds));

alter table public.user_pulse_preferences
  add constraint user_pulse_preferences_enabled_kinds check (
    enabled_kinds <@ array[
      'filing', 'analysis', 'checkup', 'question', 'resurface', 'learning'
    ]::text[]
  );

alter table public.user_pulse_item_states
  drop constraint if exists user_pulse_item_states_source_type;

alter table public.user_pulse_item_states
  add constraint user_pulse_item_states_source_type check (
    source_type in ('filing', 'analysis', 'checkup', 'question', 'resurface', 'learning')
  );

alter table public.user_pulse_item_states
  drop constraint if exists user_pulse_item_states_kind;

alter table public.user_pulse_item_states
  add constraint user_pulse_item_states_kind check (
    kind in ('filing', 'analysis', 'checkup', 'question', 'resurface', 'learning')
  );
