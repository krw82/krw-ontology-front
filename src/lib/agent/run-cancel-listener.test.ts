import { beforeEach, describe, expect, it } from "vitest";
import {
  getAgentRunCancelListenConnectionString,
  getAgentRunCancelWaiter,
  PostgresAgentRunCancelWaiter,
  resetAgentRunCancelWaiterForTests,
  SleepAgentRunCancelWaiter,
} from "@/lib/agent/run-cancel-listener";

describe("run cancel listener config", () => {
  beforeEach(() => {
    resetAgentRunCancelWaiterForTests();
  });

  it("prefers the explicit cancel LISTEN connection string", () => {
    expect(
      getAgentRunCancelListenConnectionString({
        AGENT_RUN_CANCEL_LISTEN_DATABASE_URL:
          "postgresql://postgres:secret@cancel.example.com:5432/postgres",
        AGENT_QUEUE_LISTEN_DATABASE_URL:
          "postgresql://postgres:secret@queue.example.com:5432/postgres",
      }),
    ).toBe("postgresql://postgres:secret@cancel.example.com:5432/postgres");
  });

  it("falls back to the queue listener connection string", () => {
    expect(
      getAgentRunCancelListenConnectionString({
        AGENT_QUEUE_LISTEN_DATABASE_URL:
          "postgresql://postgres:secret@queue.example.com:5432/postgres",
      }),
    ).toBe("postgresql://postgres:secret@queue.example.com:5432/postgres");
  });

  it("derives a direct Supabase database URL when no explicit URL is set", () => {
    expect(
      getAgentRunCancelListenConnectionString({
        SUPABASE_URL: "https://deaumgysfwfcctzhbaxb.supabase.co",
        SUPABASE_DB_PASSWORD: "pw with symbols!",
      }),
    ).toBe(
      "postgresql://postgres:pw%20with%20symbols!@db.deaumgysfwfcctzhbaxb.supabase.co:5432/postgres?sslmode=require",
    );
  });

  it("uses a sleep waiter when LISTEN is disabled", () => {
    expect(
      getAgentRunCancelWaiter({
        AGENT_RUN_CANCEL_LISTEN_ENABLED: "0",
      }),
    ).toBeInstanceOf(SleepAgentRunCancelWaiter);
  });

  it("creates a Postgres waiter when LISTEN config is available", () => {
    expect(
      getAgentRunCancelWaiter({
        AGENT_RUN_CANCEL_LISTEN_DATABASE_URL:
          "postgresql://postgres:secret@cancel.example.com:5432/postgres",
      }),
    ).toBeInstanceOf(PostgresAgentRunCancelWaiter);
  });

  it("sleep waiter resolves after timeout and respects abort", async () => {
    const waiter = new SleepAgentRunCancelWaiter();
    await expect(waiter.waitForRunCancel("run-1", 1)).resolves.toBe("timeout");

    const abortController = new AbortController();
    abortController.abort();
    await expect(
      waiter.waitForRunCancel("run-1", 10_000, abortController.signal),
    ).resolves.toBe("aborted");
  });
});
