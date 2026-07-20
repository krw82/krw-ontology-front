import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pulse editorial migration", () => {
  it("keeps editorial records private to the server and validates storage-backed assets", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260720020000_pulse_editorial_entries.sql"), "utf8");
    expect(migration).toContain("insert into storage.buckets");
    expect(migration).toContain("'pulse-editorial'");
    expect(migration).toContain("create table if not exists public.pulse_editorial_entries");
    expect(migration).toContain("create table if not exists public.pulse_editorial_assets");
    expect(migration).toContain("alter table public.pulse_editorial_entries enable row level security");
    expect(migration).toContain("revoke all on table public.pulse_editorial_assets from public, anon, authenticated");
    expect(migration).toContain("mime_type in ('image/jpeg', 'image/png', 'image/webp')");
  });
});
