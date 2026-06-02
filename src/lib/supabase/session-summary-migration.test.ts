import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("chat session summary migration", () => {
  const migration = readFileSync(
    "supabase/migrations/20260528006000_add_chat_session_summaries.sql",
    "utf8",
  );
  const initialSchema = readFileSync(
    "supabase/migrations/20260510000000_initial_schema.sql",
    "utf8",
  );

  it("stores list summaries on chat_sessions and keeps them refreshed", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS last_message_preview TEXT",
    );
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS last_message_at");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS latest_run_status");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.refresh_chat_session_message_summary",
    );
    expect(migration).toContain(
      "CREATE TRIGGER trg_messages_session_summary_insert",
    );
    expect(migration).toContain(
      "CREATE TRIGGER trg_agent_runs_session_summary_update",
    );
    expect(migration).toContain(
      "CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_visible_summary",
    );
  });

  it("keeps fresh schemas aligned with incremental migrations", () => {
    expect(initialSchema).toContain("last_message_preview TEXT");
    expect(initialSchema).toContain("last_message_at TIMESTAMPTZ");
    expect(initialSchema).toContain("latest_run_status run_status");
    expect(initialSchema).toContain(
      "CREATE TYPE run_status AS ENUM ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled', 'expired')",
    );
  });
});
