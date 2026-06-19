import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchHistory } from "./fetch-history";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440001";

function createAdmin(params: {
  insertMessage?: { id: string } | null;
  insertError?: { code?: string; message: string } | null;
  existingMessage?: { id: string } | null;
  previousMessages?: Array<{ role: string; content: string }>;
  previousMessagesError?: { message: string } | null;
  deletedIds?: string[];
} = {}) {
  const insertMessage =
    params.insertMessage === undefined
      ? { id: "user-message-1" }
      : params.insertMessage;
  const previousMessages = params.previousMessages ?? [];

  return {
    from(table: string) {
      expect(table).toBe("messages");

      return {
        insert() {
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: insertMessage,
                    error: params.insertError ?? null,
                  });
                },
              };
            },
          };
        },
        select(columns: string) {
          const query = {
            eq() {
              return query;
            },
            neq() {
              return query;
            },
            in() {
              return query;
            },
            order() {
              return query;
            },
            limit() {
              return query;
            },
            maybeSingle() {
              return Promise.resolve({
                data: params.existingMessage ?? null,
                error: null,
              });
            },
            returns() {
              expect(columns).toBe("role, content");
              return Promise.resolve({
                data: previousMessages,
                error: params.previousMessagesError ?? null,
              });
            },
          };
          return query;
        },
        delete() {
          return {
            eq(key: string, value: string) {
              if (key === "id") params.deletedIds?.push(value);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

async function json(response: Response) {
  return response.json() as Promise<{
    error?: { code: string; message: string };
    request_id?: string;
  }>;
}

describe("fetchHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns previous completed messages in chronological order", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createAdmin({
        previousMessages: [
          { role: "assistant", content: "latest" },
          { role: "user", content: "older" },
        ],
      }),
    );

    const result = await fetchHistory("session-1", "current", REQUEST_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toEqual({
      userMessageId: "user-message-1",
      userMessageCreated: true,
      history: [
        { role: "user", content: "older" },
        { role: "assistant", content: "latest" },
      ],
    });
  });

  it("does not continue with empty history when the history query fails", async () => {
    const deletedIds: string[] = [];
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createAdmin({
        previousMessagesError: { message: "database unavailable" },
        deletedIds,
      }),
    );

    const result = await fetchHistory("session-1", "current", REQUEST_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(500);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "대화 기록을 불러오지 못했습니다.",
      },
      request_id: REQUEST_ID,
    });
    expect(deletedIds).toEqual(["user-message-1"]);
  });

  it("does not delete an existing idempotent user message when history loading fails", async () => {
    const deletedIds: string[] = [];
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createAdmin({
        insertMessage: null,
        insertError: { code: "23505", message: "duplicate request" },
        existingMessage: { id: "existing-user-message-1" },
        previousMessagesError: { message: "database unavailable" },
        deletedIds,
      }),
    );

    const result = await fetchHistory("session-1", "current", REQUEST_ID);

    expect(result.ok).toBe(false);
    expect(deletedIds).toEqual([]);
  });
});
