import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("agent run cancel notify migration", () => {
  it("notifies workers when runs are cancelled", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260606003000_agent_run_cancel_notify.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      "create or replace function public.notify_agent_run_cancel()",
    );
    expect(migration).toContain("perform pg_notify('agent_run_cancel', new.id::text)");
    expect(migration).toContain("after update of cancel_requested_at, status");
    expect(migration).toContain("execute function public.notify_agent_run_cancel()");
    expect(migration).toContain(
      "revoke all on function public.notify_agent_run_cancel()",
    );
  });
});
