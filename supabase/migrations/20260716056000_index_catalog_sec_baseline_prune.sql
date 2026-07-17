-- Cascade deletes from the large first-run baseline must be able to find every
-- child row by filing_event_id. PostgreSQL does not create those supporting
-- indexes automatically for foreign keys.

create index if not exists idx_sec_filing_events_baseline_prune
  on public.sec_filing_events (env, occurred_at asc, id)
  where not feed_eligible
    and coalesce(source_metadata ->> 'discoveryBaseline', 'false') = 'true';

create index if not exists idx_sec_filing_processing_jobs_event
  on public.sec_filing_processing_jobs (filing_event_id);

create index if not exists idx_user_filing_notifications_event
  on public.user_filing_notifications (filing_event_id);

create index if not exists idx_filing_keyword_matches_event
  on public.filing_keyword_matches (filing_event_id);
