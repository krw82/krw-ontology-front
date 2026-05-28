import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260514045332_harden_chat_rls.sql",
);
const leaseReadMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260514045627_lock_concurrency_lease_reads.sql",
);
const softDeleteRlsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260522004000_soft_delete_rls.sql",
);
const workerHeartbeatRlsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260528002000_harden_agent_worker_heartbeats_rls.sql",
);

describe("harden chat RLS migration", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const leaseReadMigration = readFileSync(leaseReadMigrationPath, "utf8");
  const softDeleteRlsMigration = readFileSync(softDeleteRlsMigrationPath, "utf8");
  const workerHeartbeatRlsMigration = readFileSync(
    workerHeartbeatRlsMigrationPath,
    "utf8",
  );

  it("revokes direct client writes from server-owned chat tables", () => {
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE");
    for (const table of [
      "messages",
      "agent_runs",
      "tool_calls",
      "citations",
      "research_artifacts",
      "usage_daily",
      "concurrency_leases",
    ]) {
      expect(migration).toContain(table);
    }
    expect(migration).toContain("FROM anon, authenticated");
  });

  it("drops write policies that let clients forge lifecycle rows", () => {
    for (const policy of [
      "messages_insert_own",
      "messages_update_own",
      "runs_insert_own",
      "runs_update_own",
      "tool_calls_insert_own",
      "tool_calls_update_own",
      "citations_insert_own",
      "citations_update_own",
      "research_artifacts_insert_own",
      "research_artifacts_update_own",
    ]) {
      expect(migration).toContain(`DROP POLICY IF EXISTS "${policy}"`);
    }
  });

  it("removes all direct authenticated access to concurrency leases", () => {
    expect(leaseReadMigration).toContain(
      "REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE concurrency_leases",
    );
    expect(leaseReadMigration).toContain("FROM anon, authenticated, PUBLIC");
  });

  it("hides soft-deleted sessions from child-table ownership checks", () => {
    expect(softDeleteRlsMigration).toContain(
      "CREATE OR REPLACE FUNCTION session_owner",
    );
    expect(softDeleteRlsMigration).toContain("AND deleted_at IS NULL");
    expect(softDeleteRlsMigration).toContain("sessions_select_own");
    expect(softDeleteRlsMigration).toContain("sessions_update_own");
    expect(softDeleteRlsMigration).toContain("sessions_delete_own");
  });

  it("keeps agent worker heartbeat state server-only", () => {
    expect(workerHeartbeatRlsMigration).toContain(
      "ALTER TABLE public.agent_worker_heartbeats ENABLE ROW LEVEL SECURITY",
    );
    expect(workerHeartbeatRlsMigration).toContain(
      "REVOKE ALL ON TABLE public.agent_worker_heartbeats",
    );
    expect(workerHeartbeatRlsMigration).toContain(
      "FROM PUBLIC, anon, authenticated",
    );
    expect(workerHeartbeatRlsMigration).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_worker_heartbeats",
    );
    expect(workerHeartbeatRlsMigration).toContain("TO service_role");
    expect(workerHeartbeatRlsMigration).not.toMatch(/CREATE\s+POLICY/i);
  });
});
