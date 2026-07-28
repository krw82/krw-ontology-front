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

  it("adds company series and independent Pulse distribution records without replacing the shared bucket", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260726094151_company_editorial_series.sql"), "utf8");
    expect(migration).toContain("create table if not exists public.pulse_editorial_series");
    expect(migration).toContain("create table if not exists public.pulse_editorial_distributions");
    expect(migration).toContain("add column if not exists series_id");
    expect(migration).toContain("company_visible boolean not null default false");
    expect(migration).toContain("storage_path ~ '^series/");
    expect(migration).toContain("pulse_editorial_distributions_active_window");
    expect(migration).toContain("trg_pulse_global_feed_revision_editorial_distributions");
    expect(migration).toContain("revoke all on table public.pulse_editorial_series from public, anon, authenticated");
  });

  it("keeps a single active Pulse distribution per editorial entry", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260727045748_editorial_admin_distribution_guard.sql"), "utf8");
    expect(migration).toContain("ranked_distributions");
    expect(migration).toContain("idx_pulse_editorial_distributions_one_live_channel");
    expect(migration).toContain("where status <> 'archived'");
  });
});
