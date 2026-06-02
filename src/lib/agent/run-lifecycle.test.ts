import { describe, expect, it, vi } from "vitest";
import {
  buildTerminalAgentRunUpdate,
  markAgentRunTerminal,
} from "./run-lifecycle";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

describe("agent run lifecycle helpers", () => {
  it("always clears the lease when building terminal updates", () => {
    expect(
      buildTerminalAgentRunUpdate({
        status: "completed",
        finishedAt: "2026-05-31T00:00:00.000Z",
        inputTokens: 10,
        outputTokens: 20,
        estimatedCostUsd: 0.01,
        latencyMs: 1234,
      }),
    ).toEqual({
      status: "completed",
      finished_at: "2026-05-31T00:00:00.000Z",
      input_tokens: 10,
      output_tokens: 20,
      estimated_cost_usd: 0.01,
      latency_ms: 1234,
      lease_expires_at: null,
    });
  });

  it("preserves failure diagnostics on terminal updates", () => {
    expect(
      buildTerminalAgentRunUpdate({
        status: "expired",
        finishedAt: "2026-05-31T00:00:00.000Z",
        errorCode: "lease_expired",
        errorMessage: "Worker lease expired",
      }),
    ).toEqual({
      status: "expired",
      finished_at: "2026-05-31T00:00:00.000Z",
      error_code: "lease_expired",
      error_message: "Worker lease expired",
      lease_expires_at: null,
    });
  });

  it("prefers the database terminal lifecycle RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi.fn();
    const admin = { rpc, from } as unknown as ReturnType<typeof getSupabaseAdmin>;

    await markAgentRunTerminal(admin, "run-1", {
      status: "cancelled",
      finishedAt: "2026-05-31T00:00:00.000Z",
      assistantMessageId: "assistant-1",
      errorCode: "cancelled",
      openToolErrorMessage: "Run was cancelled before tool result was received",
    });

    expect(rpc).toHaveBeenCalledWith("mark_agent_run_terminal", {
      p_run_id: "run-1",
      p_status: "cancelled",
      p_finished_at: "2026-05-31T00:00:00.000Z",
      p_error_code: "cancelled",
      p_error_message: null,
      p_input_tokens: null,
      p_output_tokens: null,
      p_estimated_cost_usd: null,
      p_latency_ms: null,
      p_assistant_message_id: "assistant-1",
      p_open_tool_error_message:
        "Run was cancelled before tool result was received",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to direct update when the terminal RPC is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    });
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const admin = { rpc, from } as unknown as ReturnType<typeof getSupabaseAdmin>;

    await markAgentRunTerminal(admin, "run-1", {
      status: "cancelled",
      finishedAt: "2026-05-31T00:00:00.000Z",
      assistantMessageId: "assistant-1",
      errorCode: "cancelled",
    });

    expect(from).toHaveBeenCalledWith("agent_runs");
    expect(update).toHaveBeenCalledWith({
      status: "cancelled",
      finished_at: "2026-05-31T00:00:00.000Z",
      assistant_message_id: "assistant-1",
      error_code: "cancelled",
      lease_expires_at: null,
    });
    expect(eq).toHaveBeenCalledWith("id", "run-1");
  });
});
