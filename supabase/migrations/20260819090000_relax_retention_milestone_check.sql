-- Relax the retention milestone check constraint so the retention-loop
-- milestones (first_company_followed, first_filing_subscription, push_enabled)
-- can be recorded alongside the original coverage_activated milestone.
ALTER TABLE public.user_retention_milestones
  DROP CONSTRAINT IF EXISTS user_retention_milestones_name_check;

ALTER TABLE public.user_retention_milestones
  ADD CONSTRAINT user_retention_milestones_name_check
  CHECK (milestone ~ '^[a-z][a-z0-9_]{2,63}$');
