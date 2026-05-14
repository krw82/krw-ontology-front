-- Concurrency lease rows are only used by trusted server/service-role code.
-- Authenticated browser clients should not be able to reach this table.

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE concurrency_leases
FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE concurrency_leases
TO service_role;
