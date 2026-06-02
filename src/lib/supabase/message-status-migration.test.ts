import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cancelled message status migration", () => {
  it("adds cancelled to the message_status enum for existing databases", () => {
    const migration = readFileSync(
      "supabase/migrations/20260528005000_add_cancelled_message_status.sql",
      "utf8",
    );

    expect(migration).toContain(
      "ALTER TYPE public.message_status ADD VALUE IF NOT EXISTS 'cancelled'",
    );
  });

  it("keeps fresh local schemas aligned with migrations", () => {
    const schema = readFileSync(
      "supabase/migrations/20260510000000_initial_schema.sql",
      "utf8",
    );

    expect(schema).toContain(
      "CREATE TYPE message_status AS ENUM ('pending', 'streaming', 'completed', 'failed', 'cancelled')",
    );
  });
});
