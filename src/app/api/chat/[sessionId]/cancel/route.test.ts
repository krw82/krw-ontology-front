import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn((error: unknown) =>
    Response.json(
      {
        error: {
          code: "auth_required",
          message: error instanceof Error ? error.message : "Auth failed",
        },
      },
      { status: 401 },
    ),
  ),
  forbiddenError: vi.fn((message: string) =>
    Response.json({ error: { code: "forbidden", message } }, { status: 403 }),
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/agent/abort-manager", () => ({
  abortRun: vi.fn(() => true),
}));
vi.mock("@/lib/agent/job-queue", () => ({
  requestAgentRunCancel: vi.fn(),
}));
vi.mock("@/lib/agent/run-events", () => ({
  appendAgentRunEvent: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/concurrency/execution-budget", () => ({
  releaseExecutionBudget: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requestAgentRunCancel } from "@/lib/agent/job-queue";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { CANCELLED_ASSISTANT_MESSAGE } from "@/lib/chat/message-status";
import { POST } from "./route";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

function request() {
  return new NextRequest(`http://localhost/api/chat/${SESSION_ID}/cancel`, {
    method: "POST",
  });
}

function params(sessionId = SESSION_ID) {
  return { params: Promise.resolve({ sessionId }) };
}

function createSessionClient() {
  return {
    from(table: string) {
      expect(table).toBe("chat_sessions");
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            is() {
              return query;
            },
            single() {
              return Promise.resolve({
                data: { user_id: "user-1" },
                error: null,
              });
            },
          };
          return query;
        },
      };
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function createAdmin() {
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
    inFilters: Record<string, unknown[]>;
  }> = [];

  return {
    updates,
    admin: {
      rpc(fn: string, args: Record<string, unknown>) {
        if (fn === "mark_agent_run_terminal") {
          updates.push({
            table: "agent_runs",
            payload: {
              status: args.p_status,
              assistant_message_id: args.p_assistant_message_id,
              finished_at: args.p_finished_at,
              error_code: args.p_error_code,
              lease_expires_at: null,
            },
            filters: { id: args.p_run_id },
            inFilters: {},
          });
        }
        return Promise.resolve({ data: true, error: null });
      },
      from(table: string) {
        return {
          select() {
            const query = {
              eq() {
                return query;
              },
              in() {
                return query;
              },
              returns() {
                if (table === "agent_runs") {
                  return Promise.resolve({
                    data: [{ id: RUN_ID, status: "queued" }],
                    error: null,
                  });
                }
                return Promise.resolve({ data: [], error: null });
              },
            };
            return query;
          },
          update(payload: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const inFilters: Record<string, unknown[]> = {};
            const record = { table, payload, filters, inFilters };
            updates.push(record);
            const query = {
              eq(key: string, value: unknown) {
                filters[key] = value;
                return query;
              },
              in(key: string, values: unknown[]) {
                inFilters[key] = values;
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

describe("POST /api/chat/[sessionId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(createClient).mockResolvedValue(createSessionClient());
    vi.mocked(requestAgentRunCancel).mockResolvedValue({
      status: "queued",
      assistantMessageId: "assistant-message-1",
      requestId: "request-1",
    });
  });

  it("stores queued assistant placeholders as cancelled, not failed", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "agent_runs",
          payload: expect.objectContaining({
            status: "cancelled",
            assistant_message_id: "assistant-message-1",
            error_code: "cancelled",
            lease_expires_at: null,
          }),
          filters: { id: RUN_ID },
        }),
        expect.objectContaining({
          table: "messages",
          payload: {
            status: "cancelled",
            content: CANCELLED_ASSISTANT_MESSAGE,
          },
          filters: { id: "assistant-message-1" },
        }),
      ]),
    );
    expect(releaseExecutionBudget).toHaveBeenCalledWith(
      "user-1",
      "request-1",
      RUN_ID,
      "cancelled",
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      RUN_ID,
      "cancelled",
      {
        run_id: RUN_ID,
        message_id: "assistant-message-1",
      },
    );
  });
});
