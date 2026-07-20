-- Repair V3's revision writer on production databases that already applied
-- the initial read-model migration before this account-deletion edge case was
-- discovered. Auth-user cascade cleanup must never recreate a child revision.

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

  if not exists (select 1 from auth.users where id = p_user_id) then
    return 0;
  end if;

  begin
    insert into public.user_pulse_feed_revisions as revision (user_id, revision, updated_at)
    values (p_user_id, 1, now())
    on conflict (user_id) do update
    set revision = revision.revision + 1,
        updated_at = now()
    returning revision.revision into v_revision;
  exception when foreign_key_violation then
    return 0;
  end;

  return v_revision;
end;
$$;

revoke all on function public.bump_user_pulse_feed_revision(uuid) from public, anon, authenticated;
grant execute on function public.bump_user_pulse_feed_revision(uuid) to service_role;

notify pgrst, 'reload schema';
