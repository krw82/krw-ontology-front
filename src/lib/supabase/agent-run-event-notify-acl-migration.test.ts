import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("agent run event notify ACL migration", () => {
  it("revokes direct execution from public roles", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260606004000_agent_run_event_notify_acl.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      "revoke all on function public.notify_agent_run_event()",
    );
    expect(migration).toContain("from public, anon, authenticated");
  });
});
