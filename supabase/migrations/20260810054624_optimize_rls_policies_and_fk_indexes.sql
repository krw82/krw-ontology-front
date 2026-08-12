-- The high-volume/parent-delete foreign keys identified by the live advisor.
-- These are deliberately limited to relationships with real join/delete
-- pressure; the remaining low-volume lint entries are retained for review.
create index if not exists market_source_fetch_runs_candidate_id_idx
  on public.market_source_fetch_runs (candidate_id);

create index if not exists sec_13f_position_changes_previous_filing_id_idx
  on public.sec_13f_position_changes (previous_filing_id);

create index if not exists analytics_events_message_id_idx
  on public.analytics_events (message_id);

create index if not exists analytics_events_run_id_idx
  on public.analytics_events (run_id);

create index if not exists market_issues_merged_into_issue_id_idx
  on public.market_issues (merged_into_issue_id);

create index if not exists pulse_global_filing_candidates_filing_event_id_idx
  on public.pulse_global_filing_candidates (filing_event_id);

-- The ready-priority index is the index used by the current claim function;
-- the older claim index has seen only two scans since the statistics reset and
-- adds write work to a frequently-updated queue table.
drop index if exists public.idx_sec_filing_processing_jobs_claim;

-- Supabase's auth_rls_initplan advisor recommends evaluating auth.uid() once per
-- statement. Normalize both direct calls and existing SELECT-wrapped calls,
-- then rewrite each policy expression. This only changes evaluation strategy;
-- the ownership predicate and policy roles remain unchanged.
do $$
declare
  v_policy record;
  v_qual text;
  v_check text;
begin
  for v_policy in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where coalesce(qual, '') ~* 'auth\.uid\(\)'
       or coalesce(with_check, '') ~* 'auth\.uid\(\)'
  loop
    v_qual := v_policy.qual;
    v_check := v_policy.with_check;

    if v_qual is not null then
      v_qual := regexp_replace(
        v_qual,
        '\(\s*SELECT\s+auth\.uid\(\)(\s+AS\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\)',
        'auth.uid()',
        'gi'
      );
      v_qual := replace(v_qual, 'auth.uid()', '(select auth.uid())');
    end if;

    if v_check is not null then
      v_check := regexp_replace(
        v_check,
        '\(\s*SELECT\s+auth\.uid\(\)(\s+AS\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\)',
        'auth.uid()',
        'gi'
      );
      v_check := replace(v_check, 'auth.uid()', '(select auth.uid())');
    end if;

    if v_qual is not null and v_check is not null then
      execute format(
        'alter policy %I on %I.%I using (%s) with check (%s)',
        v_policy.policyname,
        v_policy.schemaname,
        v_policy.tablename,
        v_qual,
        v_check
      );
    elsif v_qual is not null then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        v_policy.policyname,
        v_policy.schemaname,
        v_policy.tablename,
        v_qual
      );
    elsif v_check is not null then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        v_policy.policyname,
        v_policy.schemaname,
        v_policy.tablename,
        v_check
      );
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
