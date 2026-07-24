import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260722000000_start_onboarding_v2.sql",
);

describe("start onboarding migration", () => {
  const migration = readFileSync(migrationPath, "utf8");

  it("creates state only for accounts registered after the rollout", () => {
    expect(migration).toContain("create table if not exists public.user_onboarding_states");
    expect(migration).toContain("after insert on auth.users");
    expect(migration).toContain("create_start_onboarding_state_for_new_user");
  });

  it("keeps onboarding state server-owned", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.user_onboarding_states from anon, authenticated");
    expect(migration).toContain("grant select, insert, update, delete on table public.user_onboarding_states to service_role");
  });
});
