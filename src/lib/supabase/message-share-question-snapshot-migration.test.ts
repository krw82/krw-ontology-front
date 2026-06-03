import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260603001000_message_share_question_snapshot.sql",
);

describe("message share question snapshot migration", () => {
  it("adds public question snapshot columns without opening table grants", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS source_question_message_id");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS question_content TEXT");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS question_created_at");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS snapshot_version");
    expect(migration).not.toMatch(/GRANT\s+.*message_shares\s+TO\s+(anon|authenticated|PUBLIC)/i);
  });

  it("backfills only the visible question prefix before attachment markers", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("ar.assistant_message_id = ms.source_message_id");
    expect(migration).toContain("SPLIT_PART(um.content, '<attached_file', 1)");
    expect(migration).toContain("um.created_at <= answer.created_at");
  });
});
