import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requestAgentRunCancel } from "./job-queue";

function createQueueAdmin(params: {
  cancelRun?: {
    status: "pending" | "queued" | "running" | "completed";
    assistant_message_id: string | null;
    request_id: string | null;
  } | null;
} = {}) {
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
    inFilters: Record<string, unknown[]>;
  }> = [];

  const admin = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const inFilters: Record<string, unknown[]> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            in(key: string, values: unknown[]) {
              inFilters[key] = values;
              return query;
            },
            select() {
              return query;
            },
            maybeSingle() {
              updates.push({ table, payload, filters, inFilters });
              return Promise.resolve({
                data: params.cancelRun ?? null,
                error: null,
              });
            },
          };
          return query;
        },
      };
    },
  };

  return {
    admin: admin as unknown as ReturnType<typeof getSupabaseAdmin>,
    updates,
  };
}

describe("agent job queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks active queued or running runs as cancel requested", async () => {
    const fake = createQueueAdmin({
      cancelRun: {
        status: "queued",
        assistant_message_id: "assistant-message-1",
        request_id: "req-1",
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const result = await requestAgentRunCancel("run-1");

    expect(result).toEqual({
      status: "queued",
      assistantMessageId: "assistant-message-1",
      requestId: "req-1",
    });
    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: "agent_runs",
        payload: expect.objectContaining({
          cancel_requested_at: expect.any(String),
        }),
        filters: { id: "run-1" },
        inFilters: { status: ["queued", "running", "pending"] },
      }),
    ]);
  });
});
