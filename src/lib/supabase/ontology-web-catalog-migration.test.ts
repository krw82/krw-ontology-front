import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260528003000_ontology_web_catalog.sql",
);
const ambiguityFixMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260528004000_fix_publish_web_catalog_env_ambiguity.sql",
);

describe("ontology web catalog migration", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const ambiguityFixMigration = readFileSync(ambiguityFixMigrationPath, "utf8");

  it("creates environment-scoped active catalog release tables", () => {
    expect(migration).toContain("create table if not exists public.ontology_catalog_releases");
    expect(migration).toContain("create table if not exists public.ontology_companies");
    expect(migration).toContain("primary key (env, release_id)");
    expect(migration).toContain("primary key (env, release_id, ticker)");
    expect(migration).toContain("uq_ontology_catalog_releases_active_env");
  });

  it("publishes catalog JSON through a service-role RPC", () => {
    expect(migration).toContain("create or replace function public.publish_ontology_web_catalog");
    expect(migration).toContain("format <> 'krw-ontology-web-catalog/v1'");
    expect(migration).toContain("update public.ontology_catalog_releases");
    expect(migration).toContain("set active = false");
    expect(migration).toContain("set active = true");
    expect(migration).toContain("grant execute on function public.publish_ontology_web_catalog");
    expect(migration).toContain("to service_role");
  });

  it("keeps catalog tables server-owned", () => {
    expect(migration).toContain("alter table public.ontology_catalog_releases enable row level security");
    expect(migration).toContain("alter table public.ontology_companies enable row level security");
    expect(migration).toContain("revoke all on table public.ontology_catalog_releases");
    expect(migration).toContain("revoke all on table public.ontology_companies");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("grant select, insert, update, delete on table public.ontology_catalog_releases");
    expect(migration).toContain("grant select, insert, update, delete on table public.ontology_companies");
  });

  it("replaces the publisher with env-safe conflict handling", () => {
    expect(ambiguityFixMigration).toContain(
      "create or replace function public.publish_ontology_web_catalog",
    );
    expect(ambiguityFixMigration).toContain("#variable_conflict use_column");
    expect(ambiguityFixMigration).toContain(
      "on conflict on constraint ontology_catalog_releases_pkey",
    );
    expect(ambiguityFixMigration).not.toContain("on conflict (env, release_id)");
  });
});
