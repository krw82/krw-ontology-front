import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAgentRunEventListenConnectionString,
  getAgentRunEventWaiter,
  PostgresAgentRunEventWaiter,
  resetAgentRunEventWaiterForTests,
  SleepAgentRunEventWaiter,
} from "@/lib/agent/run-event-listener";

describe("agent run event listener config", () => {
  afterEach(() => {
    resetAgentRunEventWaiterForTests();
    vi.restoreAllMocks();
  });

  it("prefers an explicit run event LISTEN connection string", () => {
    expect(
      getAgentRunEventListenConnectionString({
        AGENT_RUN_EVENT_LISTEN_DATABASE_URL:
          "postgresql://postgres:secret@db.example.com:5432/postgres",
        SUPABASE_DB_URL:
          "postgresql://postgres:unused@db.other.example.com:5432/postgres",
      }),
    ).toBe("postgresql://postgres:secret@db.example.com:5432/postgres");
  });

  it("uses the Rust agent database URL when it is the only local database setting", () => {
    expect(
      getAgentRunEventListenConnectionString({
        AGENT_V1_DATABASE_URL:
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      }),
    ).toBe("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  });

  it("derives a Supabase direct database URL from project URL and password", () => {
    expect(
      getAgentRunEventListenConnectionString({
        NEXT_PUBLIC_SUPABASE_URL: "https://deaumgysfwfcctzhbaxb.supabase.co",
        SUPABASE_DB_PASSWORD: "pw with symbols!",
      }),
    ).toBe(
      "postgresql://postgres:pw%20with%20symbols!@db.deaumgysfwfcctzhbaxb.supabase.co:5432/postgres?sslmode=require",
    );
  });

  it("uses a sleeping fallback when LISTEN is disabled or unavailable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      getAgentRunEventWaiter({
        AGENT_RUN_EVENT_LISTEN_ENABLED: "0",
      }),
    ).toBeInstanceOf(SleepAgentRunEventWaiter);

    resetAgentRunEventWaiterForTests();
    expect(getAgentRunEventWaiter({})).toBeInstanceOf(SleepAgentRunEventWaiter);
  });

  it("creates a Postgres waiter when LISTEN config is available", () => {
    expect(
      getAgentRunEventWaiter({
        AGENT_RUN_EVENT_LISTEN_DATABASE_URL:
          "postgresql://postgres:secret@db.example.com:5432/postgres",
      }),
    ).toBeInstanceOf(PostgresAgentRunEventWaiter);
  });

  it("sleep waiter resolves after timeout and respects abort", async () => {
    const waiter = new SleepAgentRunEventWaiter();
    await expect(waiter.waitForRunEvent("run-1", 0)).resolves.toBe("timeout");

    const abortController = new AbortController();
    abortController.abort();
    await expect(
      waiter.waitForRunEvent("run-1", 10_000, abortController.signal),
    ).resolves.toBe("aborted");
  });
});
