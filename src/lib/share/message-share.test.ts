import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createMessageShare,
  findPublicMessageShare,
  findPublicShareStarter,
} from "./message-share";
import type { ChatSessionRow, MessageRow } from "@/types/database";

function createPublicShareAdmin(data: Record<string, unknown> | null) {
  return {
    from(table: string) {
      expect(table).toBe("message_shares");
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            is() {
              return query;
            },
            maybeSingle() {
              return Promise.resolve({ data, error: null });
            },
          };
          return query;
        },
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

function createSnapshotAdmin(params: {
  userMessage: MessageRow;
  insertedPayloads: Array<Record<string, unknown>>;
}) {
  return {
    from(table: string) {
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            is() {
              return query;
            },
            order() {
              return query;
            },
            limit() {
              return query;
            },
            maybeSingle() {
              if (table === "agent_runs") {
                return Promise.resolve({
                  data: { user_message_id: params.userMessage.id },
                  error: null,
                });
              }
              if (table === "messages") {
                return Promise.resolve({
                  data: params.userMessage,
                  error: null,
                });
              }
              if (table === "message_shares") {
                return Promise.resolve({ data: null, error: null });
              }
              throw new Error(`Unexpected maybeSingle table: ${table}`);
            },
          };
          return query;
        },
        insert(payload: Record<string, unknown>) {
          params.insertedPayloads.push(payload);
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: { token: String(payload.token) },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

describe("findPublicMessageShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes public share answer content and title", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createPublicShareAdmin({
        token: "share-token",
        title: "Let me retrieve more evidence.",
        question_content:
          "AAPL 서비스 매출 리스크를 정리해줘.\n\n<attached_file name=\"notes.txt\">\nsecret attachment\n</attached_file>",
        question_created_at: "2026-05-31T00:00:00.000Z",
        answer_content:
          "Let me retrieve more evidence.분석 결과를 작성하겠습니다.\n\n---\n\n최종 답변입니다.",
        answer_created_at: "2026-05-31T00:00:00.000Z",
        tickers: ["NOW"],
        created_at: "2026-05-31T00:00:00.000Z",
      }),
    );

    await expect(findPublicMessageShare("share-token")).resolves.toMatchObject({
      title: "최종 답변입니다.",
      question_content: "AAPL 서비스 매출 리스크를 정리해줘.",
      answer_content: "최종 답변입니다.",
    });
  });
});

describe("findPublicShareStarter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the starter question surface", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createPublicShareAdmin({
        token: "share-token",
        title: "공유된 답변",
        question_content: "AAPL 서비스 매출 리스크를 정리해줘.",
        question_created_at: "2026-05-31T00:00:00.000Z",
        answer_content: "답변 본문",
        answer_created_at: "2026-05-31T00:00:00.000Z",
        tickers: ["AAPL"],
        created_at: "2026-05-31T00:00:00.000Z",
      }),
    );

    await expect(findPublicShareStarter("share-token")).resolves.toEqual({
      token: "share-token",
      title: "답변 본문",
      question_content: "AAPL 서비스 매출 리스크를 정리해줘.",
      tickers: ["AAPL"],
    });
  });

  it("returns null when a legacy share has no question snapshot", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createPublicShareAdmin({
        token: "share-token",
        title: "공유된 답변",
        question_content: null,
        question_created_at: null,
        answer_content: "답변 본문",
        answer_created_at: "2026-05-31T00:00:00.000Z",
        tickers: ["AAPL"],
        created_at: "2026-05-31T00:00:00.000Z",
      }),
    );

    await expect(findPublicShareStarter("share-token")).resolves.toBeNull();
  });
});

describe("createMessageShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores a run-linked question snapshot without attachment content", async () => {
    const insertedPayloads: Array<Record<string, unknown>> = [];
    const session = {
      id: "session-1",
      user_id: "user-1",
      title: "AAPL",
      claude_session_id: null,
      client_request_id: null,
      scope_type: "company",
      default_tickers: ["AAPL"],
      default_document_types: [],
      last_message_preview: null,
      last_message_at: null,
      latest_run_status: null,
      deleted_at: null,
      created_at: "2026-05-31T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z",
    } satisfies ChatSessionRow;
    const answerMessage = {
      id: "assistant-1",
      session_id: session.id,
      role: "assistant",
      content: "AAPL 답변",
      status: "completed",
      request_id: null,
      created_at: "2026-05-31T00:01:00.000Z",
      updated_at: "2026-05-31T00:01:00.000Z",
    } satisfies MessageRow;
    const userMessage = {
      id: "user-message-1",
      session_id: session.id,
      role: "user",
      content:
        "AAPL 서비스 매출 리스크를 정리해줘.\n\n<attached_file name=\"notes.txt\">\nsecret attachment\n</attached_file>",
      status: "completed",
      request_id: null,
      created_at: "2026-05-31T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z",
    } satisfies MessageRow;

    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createSnapshotAdmin({ userMessage, insertedPayloads }),
    );

    await createMessageShare({
      userId: "user-1",
      message: answerMessage,
      session,
    });

    expect(insertedPayloads).toHaveLength(1);
    expect(insertedPayloads[0]).toMatchObject({
      source_question_message_id: "user-message-1",
      question_content: "AAPL 서비스 매출 리스크를 정리해줘.",
      question_created_at: "2026-05-31T00:00:00.000Z",
      answer_content: "AAPL 답변",
      tickers: ["AAPL"],
      snapshot_version: 2,
    });
    expect(String(insertedPayloads[0]?.question_content)).not.toContain(
      "secret attachment",
    );
  });
});
