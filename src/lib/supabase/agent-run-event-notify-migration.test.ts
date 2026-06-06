import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260606002000_agent_run_event_notify.sql",
  ),
  "utf8",
);

describe("agent run event notify migration", () => {
  it("wakes SSE streams when durable event rows are inserted", () => {
    expect(migration).toContain(
      "create or replace function public.notify_agent_run_event()",
    );
    expect(migration).toContain(
      "perform pg_notify('agent_run_event', new.run_id::text)",
    );
    expect(migration).toContain("after insert on public.agent_run_events");
    expect(migration).toContain(
      "execute function public.notify_agent_run_event()",
    );
  });

  it("keeps NOTIFY payload minimal and avoids Realtime coupling", () => {
    expect(migration).not.toContain("row_to_json");
    expect(migration).not.toContain("json_build_object");
    expect(migration.toLowerCase()).not.toContain("realtime");
  });
});
