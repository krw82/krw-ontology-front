-- Add durable queue lifecycle states in a standalone migration. PostgreSQL
-- cannot safely use a newly-added enum value in indexes/functions until the
-- enum ALTER transaction commits.

alter type run_status add value if not exists 'queued';
alter type run_status add value if not exists 'expired';
