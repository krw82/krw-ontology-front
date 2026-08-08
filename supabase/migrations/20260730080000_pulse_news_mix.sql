-- Pulse V9 adds reviewed market-issue cards as a first-class source. The
-- source remains opt-out in user preferences and is fed only by published
-- News-tab issues (never raw collected social posts).

alter table public.user_pulse_preferences
  drop constraint if exists user_pulse_preferences_enabled_kinds;

alter table public.user_pulse_preferences
  alter column enabled_kinds set default array[
    'filing', 'analysis', 'checkup', 'question', 'resurface', 'learning', 'news'
  ]::text[];

update public.user_pulse_preferences
set enabled_kinds = array_append(enabled_kinds, 'news')
where not ('news' = any(enabled_kinds));

alter table public.user_pulse_preferences
  add constraint user_pulse_preferences_enabled_kinds check (
    enabled_kinds <@ array[
      'filing', 'analysis', 'checkup', 'question', 'resurface', 'learning', 'news'
    ]::text[]
  );

alter table public.user_pulse_item_states
  drop constraint if exists user_pulse_item_states_source_type;

alter table public.user_pulse_item_states
  add constraint user_pulse_item_states_source_type check (
    source_type in ('filing', 'analysis', 'checkup', 'question', 'resurface', 'learning', 'news')
  );

alter table public.user_pulse_item_states
  drop constraint if exists user_pulse_item_states_kind;

alter table public.user_pulse_item_states
  add constraint user_pulse_item_states_kind check (
    kind in ('filing', 'analysis', 'checkup', 'question', 'resurface', 'learning', 'news')
  );

-- The standard Pulse revision intentionally stays the one ETag namespace. A
-- published News update therefore invalidates the same snapshot cache without
-- adding account content to a global key. MARKET_ISSUE_ENV can intentionally
-- differ from FILING_WORKER_ENV in local development, while the Pulse ETag
-- currently uses the filing environment. Invalidate all three cache rows so
-- a newly published News issue is never hidden behind a stale Pulse ETag.
create or replace function public.pulse_global_feed_revision_from_market_issue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.bump_pulse_global_feed_revision('dev');
  perform public.bump_pulse_global_feed_revision('staging');
  perform public.bump_pulse_global_feed_revision('prod');
  return coalesce(new, old);
end;
$$;

create or replace function public.pulse_global_feed_revision_from_market_issue_entity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.bump_pulse_global_feed_revision('dev');
  perform public.bump_pulse_global_feed_revision('staging');
  perform public.bump_pulse_global_feed_revision('prod');
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_pulse_global_feed_revision_market_issues on public.market_issues;
create trigger trg_pulse_global_feed_revision_market_issues
after insert or update or delete on public.market_issues
for each row execute function public.pulse_global_feed_revision_from_market_issue();

drop trigger if exists trg_pulse_global_feed_revision_market_issue_entities on public.market_issue_entities;
create trigger trg_pulse_global_feed_revision_market_issue_entities
after insert or update or delete on public.market_issue_entities
for each row execute function public.pulse_global_feed_revision_from_market_issue_entity();

-- Ingestion timestamps update often, while only this setting changes whether
-- the News source participates in Pulse. Keep the invalidation narrowly
-- scoped so routine worker heartbeats do not force every browser to refresh.
drop trigger if exists trg_pulse_global_feed_revision_market_issue_settings_insert_delete on public.market_issue_settings;
create trigger trg_pulse_global_feed_revision_market_issue_settings_insert_delete
after insert or delete on public.market_issue_settings
for each row execute function public.pulse_global_feed_revision_from_market_issue();

drop trigger if exists trg_pulse_global_feed_revision_market_issue_settings_enabled on public.market_issue_settings;
create trigger trg_pulse_global_feed_revision_market_issue_settings_enabled
after update of feed_enabled on public.market_issue_settings
for each row execute function public.pulse_global_feed_revision_from_market_issue();

drop trigger if exists trg_pulse_feed_revision_market_issue_user_states on public.market_issue_user_states;
create trigger trg_pulse_feed_revision_market_issue_user_states
after insert or update or delete on public.market_issue_user_states
for each row execute function public.pulse_user_feed_revision_from_row();

drop trigger if exists trg_pulse_feed_revision_market_issue_follows on public.market_issue_user_company_follows;
create trigger trg_pulse_feed_revision_market_issue_follows
after insert or update or delete on public.market_issue_user_company_follows
for each row execute function public.pulse_user_feed_revision_from_row();

revoke all on function public.pulse_global_feed_revision_from_market_issue() from public, anon, authenticated;
revoke all on function public.pulse_global_feed_revision_from_market_issue_entity() from public, anon, authenticated;
grant execute on function public.pulse_global_feed_revision_from_market_issue() to service_role;
grant execute on function public.pulse_global_feed_revision_from_market_issue_entity() to service_role;

notify pgrst, 'reload schema';
