-- Lock down the V3 global Pulse read model. These tables are populated and
-- read by server-side workers only; they are not a user-facing Data API.
alter table public.pulse_global_feed_revisions enable row level security;
alter table public.pulse_global_filing_candidates enable row level security;
alter table public.pulse_global_candidate_tickers enable row level security;

revoke all on table public.pulse_global_feed_revisions from public, anon, authenticated;
revoke all on table public.pulse_global_filing_candidates from public, anon, authenticated;
revoke all on table public.pulse_global_candidate_tickers from public, anon, authenticated;

grant select, insert, update, delete on table public.pulse_global_feed_revisions to service_role;
grant select, insert, update, delete on table public.pulse_global_filing_candidates to service_role;
grant select, insert, update, delete on table public.pulse_global_candidate_tickers to service_role;

-- These functions are internal queue/reconciliation helpers or trigger
-- functions. They must not be callable through PostgREST by untrusted roles.
revoke all on function public.ack_market_issue_queue_message(text, text, bigint) from public, anon, authenticated;
revoke all on function public.archive_market_issue_queue_message(text, text, bigint) from public, anon, authenticated;
revoke all on function public.bump_market_issue_feed_revision(text) from public, anon, authenticated;
revoke all on function public.cancel_agent_v1_product_run(jsonb) from public, anon, authenticated;
revoke all on function public.claim_market_issue_queue_messages(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.create_start_onboarding_state_for_new_user() from public, anon, authenticated;
revoke all on function public.dispatch_market_issue_web_sources(text) from public, anon, authenticated;
revoke all on function public.enqueue_agent_v1_product_run(jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_due_market_issue_web_sources(text, integer) from public, anon, authenticated;
revoke all on function public.enqueue_market_issue_queue_message(text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.enqueue_sec_filing_brief_after_enrichment() from public, anon, authenticated;
revoke all on function public.reconcile_coverage_on_entitlement_change() from public, anon, authenticated;
revoke all on function public.refresh_market_company_source_registry(text) from public, anon, authenticated;
revoke all on function public.sweep_expired_company_coverage_limits(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.touch_market_issue_feed_revision() from public, anon, authenticated;

-- service_role is the only PostgREST-facing caller for the internal RPCs. The
-- trigger functions are granted to service_role as well so service-role writes
-- remain valid; PostgreSQL trigger execution itself remains database-owned.
grant execute on function public.ack_market_issue_queue_message(text, text, bigint) to service_role;
grant execute on function public.archive_market_issue_queue_message(text, text, bigint) to service_role;
grant execute on function public.bump_market_issue_feed_revision(text) to service_role;
grant execute on function public.cancel_agent_v1_product_run(jsonb) to service_role;
grant execute on function public.claim_market_issue_queue_messages(text, text, integer, integer) to service_role;
grant execute on function public.create_start_onboarding_state_for_new_user() to service_role;
grant execute on function public.dispatch_market_issue_web_sources(text) to service_role;
grant execute on function public.enqueue_agent_v1_product_run(jsonb) to service_role;
grant execute on function public.enqueue_due_market_issue_web_sources(text, integer) to service_role;
grant execute on function public.enqueue_market_issue_queue_message(text, text, jsonb, integer) to service_role;
grant execute on function public.enqueue_sec_filing_brief_after_enrichment() to service_role;
grant execute on function public.reconcile_coverage_on_entitlement_change() to service_role;
grant execute on function public.refresh_market_company_source_registry(text) to service_role;
grant execute on function public.sweep_expired_company_coverage_limits(timestamptz, integer) to service_role;
grant execute on function public.touch_market_issue_feed_revision() to service_role;

-- Pin the search path for every newly hardened SECURITY DEFINER function. The
-- explicit pg_catalog first prevents shadowing of built-ins; public is retained
-- because the existing function bodies use schema-qualified application tables.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'ack_market_issue_queue_message',
        'archive_market_issue_queue_message',
        'bump_market_issue_feed_revision',
        'cancel_agent_v1_product_run',
        'claim_market_issue_queue_messages',
        'create_start_onboarding_state_for_new_user',
        'dispatch_market_issue_web_sources',
        'enqueue_agent_v1_product_run',
        'enqueue_due_market_issue_web_sources',
        'enqueue_market_issue_queue_message',
        'enqueue_sec_filing_brief_after_enrichment',
        'reconcile_coverage_on_entitlement_change',
        'refresh_market_company_source_registry',
        'sweep_expired_company_coverage_limits',
        'touch_market_issue_feed_revision'
      )
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, pg_temp',
      v_function.identity
    );
  end loop;
end;
$$;

-- Prevent future public-schema functions from silently becoming public RPCs.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

notify pgrst, 'reload schema';
