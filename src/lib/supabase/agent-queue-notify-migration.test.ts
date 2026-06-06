import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260606001000_agent_run_queue_notify.sql",
  ),
  "utf8",
);

describe("agent queue notify migration", () => {
  it("wakes supervisors only when durable queue rows are available", () => {
    expect(migration).toContain(
      "create or replace function public.notify_agent_run_queued()",
    );
    expect(migration).toContain("new.status <> 'queued'");
    expect(migration).toContain("new.cancel_requested_at is not null");
    expect(migration).toContain("perform pg_notify('agent_run_queued', new.id::text)");
    expect(migration).toContain("after insert or update of status, cancel_requested_at");
    expect(migration).toContain("execute function public.notify_agent_run_queued()");
  });

  it("keeps NOTIFY payload minimal and avoids Realtime coupling", () => {
    expect(migration).not.toContain("row_to_json");
    expect(migration).not.toContain("json_build_object");
    expect(migration.toLowerCase()).not.toContain("realtime");
  });
});
