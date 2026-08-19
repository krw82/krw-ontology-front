import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent-v1/runtime", () => ({
  getRustAgentRuntime: vi.fn(),
}));
vi.mock("@/lib/agent/run-lifecycle", () => ({
  markAgentRunTerminal: vi.fn(),
}));
vi.mock("@/lib/agent/run-events", () => ({
  appendAgentRunEvent: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/concurrency/execution-budget", () => ({
  releaseExecutionBudget: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getRustAgentRuntime } from "@/lib/agent-v1/runtime";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import { cancelRustAgentRun } from "./rust-cancel";

const RUN = {
  id: "11111111-1111-4111-8111-111111111111",
  session_id: "session-1",
  assistant_message_id: "assistant-message-1",
  request_id: "request-1",
};

function createAdmin() {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    admin: {
      from(table: string) {
        return {
          update(payload: Record<string, unknown>) {
            updates.push({ table, payload });
            const query = {
              eq() {
                return Promise.resolve({ data: null, error: null });
              },
            };
            return query;
          },
        };
      },
    } as unknown as ReturnType<typeof getSupabaseAdmin>,
  };
}

describe("cancelRustAgentRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels through the kernel and finalizes the product rows", async () => {
    const fake = createAdmin();
    const cancel = vi.fn().mockResolvedValue({ runId: RUN.id, outcome: "cancelled" });
    vi.mocked(getRustAgentRuntime).mockResolvedValue({
      enqueue: vi.fn(),
      cancel,
    } as unknown as Awaited<ReturnType<typeof getRustAgentRuntime>>);

    const outcome = await cancelRustAgentRun({
      admin: fake.admin,
      run: RUN,
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(cancel).toHaveBeenCalledWith({
      runId: RUN.id,
      userId: "user-1",
      sessionId: "session-1",
      reasonCode: "user_cancelled",
    });
    expect(markAgentRunTerminal).toHaveBeenCalledWith(
      fake.admin,
      RUN.id,
      expect.objectContaining({
        status: "cancelled",
        assistantMessageId: "assistant-message-1",
        errorCode: "cancelled",
      }),
    );
    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: "messages",
        payload: expect.objectContaining({ status: "cancelled" }),
      }),
    ]);
    expect(releaseExecutionBudget).toHaveBeenCalledWith(
      "user-1",
      "request-1",
      RUN.id,
      "cancelled",
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      RUN.id,
      "cancelled",
      { run_id: RUN.id, message_id: "assistant-message-1" },
    );
  });

  it("returns already_terminal without finalizing when the kernel finished first", async () => {
    const fake = createAdmin();
    vi.mocked(getRustAgentRuntime).mockResolvedValue({
      enqueue: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ runId: RUN.id, outcome: "already_final" }),
    } as unknown as Awaited<ReturnType<typeof getRustAgentRuntime>>);

    const outcome = await cancelRustAgentRun({
      admin: fake.admin,
      run: RUN,
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(outcome).toEqual({ kind: "already_terminal" });
    expect(markAgentRunTerminal).not.toHaveBeenCalled();
    expect(appendAgentRunEvent).not.toHaveBeenCalled();
  });

  it("returns null so callers fall back to the legacy stamp when the runtime is unavailable", async () => {
    const fake = createAdmin();
    vi.mocked(getRustAgentRuntime).mockRejectedValue(new Error("agent_v1_release_pin_missing"));

    const outcome = await cancelRustAgentRun({
      admin: fake.admin,
      run: RUN,
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(outcome).toBeNull();
    expect(markAgentRunTerminal).not.toHaveBeenCalled();
  });

  it("skips optional finalization steps when message or request ids are null", async () => {
    const fake = createAdmin();
    vi.mocked(getRustAgentRuntime).mockResolvedValue({
      enqueue: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ runId: RUN.id, outcome: "cancelled" }),
    } as unknown as Awaited<ReturnType<typeof getRustAgentRuntime>>);

    const outcome = await cancelRustAgentRun({
      admin: fake.admin,
      run: { ...RUN, assistant_message_id: null, request_id: null },
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(fake.updates).toHaveLength(0);
    expect(releaseExecutionBudget).not.toHaveBeenCalled();
  });
});
