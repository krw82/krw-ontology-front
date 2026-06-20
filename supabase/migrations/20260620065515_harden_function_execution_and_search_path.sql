-- Supabase advisor hardening:
-- - session_owner is an RLS helper and should execute with caller privileges.
-- - pin search_path for helper and trigger functions to prevent object shadowing.

alter function public.session_owner(uuid) security invoker;

do $$
declare
  v_function record;
begin
  for v_function in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'session_owner',
        'run_session',
        'set_updated_at',
        'increment_usage_daily',
        'try_acquire_lease',
        'touch_message_updated_at',
        'touch_session_from_message',
        'build_chat_session_message_preview',
        'refresh_chat_session_message_summary',
        'refresh_chat_session_run_summary',
        'refresh_chat_session_message_summary_trigger',
        'refresh_chat_session_run_summary_trigger',
        'current_weekly_credit_period'
      )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, pg_temp',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
  end loop;
end;
$$;
