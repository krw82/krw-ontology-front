import { describe, expect, it } from "vitest";
import {
  deriveSupabaseDatabaseUrl,
  getAgentQueueListenConnectionString,
  normalizeListenChannel,
} from "@/worker/postgres-queue-listener";

describe("postgres queue listener config", () => {
  it("derives a direct Supabase database URL from project URL and password", () => {
    expect(
      deriveSupabaseDatabaseUrl(
        "https://deaumgysfwfcctzhbaxb.supabase.co",
        "pw with symbols!",
      ),
    ).toBe(
      "postgresql://postgres:pw%20with%20symbols!@db.deaumgysfwfcctzhbaxb.supabase.co:5432/postgres?sslmode=require",
    );
  });

  it("uses local Supabase defaults for local development", () => {
    expect(deriveSupabaseDatabaseUrl("http://localhost:54321", undefined)).toBe(
      "postgresql://postgres:postgres@localhost:54322/postgres",
    );
  });

  it("prefers an explicit LISTEN connection string", () => {
    expect(
      getAgentQueueListenConnectionString({
        AGENT_QUEUE_LISTEN_DATABASE_URL:
          "postgresql://postgres:secret@pooler.example.com:5432/postgres",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_DB_PASSWORD: "unused",
      }),
    ).toBe("postgresql://postgres:secret@pooler.example.com:5432/postgres");
  });

  it("rejects unsafe channel identifiers", () => {
    expect(normalizeListenChannel("agent_run_queued")).toBe("agent_run_queued");
    expect(() => normalizeListenChannel("agent-run-queued")).toThrow(
      "Invalid Postgres LISTEN channel",
    );
  });
});
