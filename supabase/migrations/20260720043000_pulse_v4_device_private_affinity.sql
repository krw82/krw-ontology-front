-- Pulse V4 keeps only explicit user decisions in Postgres. Exposure counts,
-- fatigue, and preference scores are private to each browser's IndexedDB.

begin;

drop function if exists public.record_pulse_item_impression(
  uuid, text, text, text, text, uuid, timestamptz
);
drop function if exists public.record_pulse_item_impressions(
  uuid, jsonb, uuid, timestamptz
);
drop function if exists public.close_user_decision_session(uuid, uuid, text);

drop table if exists public.user_decision_sessions;

alter table public.user_pulse_item_states
  drop constraint if exists user_pulse_item_states_view_count,
  drop constraint if exists user_pulse_item_states_impression_count,
  drop constraint if exists user_pulse_item_states_feedback;

alter table public.user_pulse_item_states
  drop column if exists last_seen_at,
  drop column if exists view_count,
  drop column if exists last_impression_at,
  drop column if exists last_impression_session_id,
  drop column if exists impression_count,
  drop column if exists feedback;

drop index if exists public.idx_user_pulse_item_states_p0_v2_active;

notify pgrst, 'reload schema';

commit;
