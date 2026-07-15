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

function createPublicShareAdminWithQuestionAttachments(params: {
  share: Record<string, unknown>;
  questionMessage: MessageRow;
  documentFiles?: Array<{
    file_name: string;
    mime_type: string;
    file_size: number;
  }>;
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
            maybeSingle() {
              if (table === "message_shares") {
                return Promise.resolve({ data: params.share, error: null });
              }
              if (table === "messages") {
                return Promise.resolve({
                  data: {
                    content: params.questionMessage.content,
                    metadata: params.questionMessage.metadata ?? null,
                  },
                  error: null,
                });
              }
              throw new Error(`Unexpected maybeSingle table: ${table}`);
            },
            returns() {
              if (table === "chat_attachments") {
                return Promise.resolve({
                  data: params.documentFiles ?? [],
                  error: null,
                });
              }
              throw new Error(`Unexpected returns table: ${table}`);
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
  run?: { id: string; run_kind: string; user_message_id: string };
  runQueuedPayload?: Record<string, unknown>;
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
                  data: params.run ?? { user_message_id: params.userMessage.id },
                  error: null,
                });
              }
              if (table === "agent_run_events") {
                return Promise.resolve({
                  data: params.runQueuedPayload
                    ? { payload: params.runQueuedPayload }
                    : null,
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
      share_context: { run_kind: null, guru_lens: null },
      locale: "ko",
    });
  });

  it("infers English locale and removes internal trace labels for shared answers", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createPublicShareAdmin({
        token: "share-token",
        title:
          "Now let me verify the key MD&A quotes from the CY2025 10-K and get the CY2026Q1 10-Q segment details.",
        question_content: "Should I cut losses on MU now?",
        question_created_at: "2026-05-31T00:00:00.000Z",
        answer_content:
          "Now let me verify the key MD&A quotes from the CY2025 10-K and get the CY2026Q1 10-Q segment details.Based on Micron's latest filing, cutting losses now looks premature. *(Source: CY2025 10-K, Item 7 MD&A, verified by trace)*",
        answer_created_at: "2026-05-31T00:00:00.000Z",
        tickers: ["MU"],
        created_at: "2026-05-31T00:00:00.000Z",
      }),
    );

    await expect(findPublicMessageShare("share-token")).resolves.toMatchObject({
      title: "Based on Micron's latest filing, cutting losses now looks premature. (Source: CY2025 10-K...",
      question_content: "Should I cut losses on MU now?",
      answer_content:
        "Based on Micron's latest filing, cutting losses now looks premature. *(Source: CY2025 10-K, Item 7 MD&A)*",
      locale: "en",
    });
  });

  it("normalizes public guru share context", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createPublicShareAdmin({
        token: "share-token",
        title: "버핏식으로 보면",
        question_content: "AAPL을 버핏 관점으로 봐줘.",
        question_created_at: "2026-05-31T00:00:00.000Z",
        answer_content: "버핏 렌즈로 보면 사업 품질을 먼저 봐야 합니다.",
        answer_created_at: "2026-05-31T00:00:00.000Z",
        tickers: ["AAPL"],
        share_context: { run_kind: "guru_advisor", guru_lens: "buffett" },
        created_at: "2026-05-31T00:00:00.000Z",
      }),
    );

    await expect(findPublicMessageShare("share-token")).resolves.toMatchObject({
      share_context: { run_kind: "guru_advisor", guru_lens: "buffett" },
    });
  });

  it("redacts sensitive paths and environment names from public shares", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createPublicShareAdmin({
        token: "share-token",
        title: "~/krw-ontology-front/.env",
        question_content: ".env 알려줘",
        question_created_at: "2026-05-31T00:00:00.000Z",
        answer_content:
          "프로젝트 경로는 ~/krw-ontology-front 이고 SUPABASE_SERVICE_ROLE_KEY=secret 입니다.",
        answer_created_at: "2026-05-31T00:00:00.000Z",
        tickers: ["AAPL"],
        created_at: "2026-05-31T00:00:00.000Z",
      }),
    );

    const share = await findPublicMessageShare("share-token");

    expect(share?.answer_content).toContain("[내부 경로 제거됨]");
    expect(share?.answer_content).toContain("[민감 환경변수 제거됨]");
    expect(share?.answer_content).not.toContain("~");
    expect(share?.answer_content).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(share?.question_content).toBe("[내부 설정 파일 제거됨] 알려줘");
    expect(share?.title).not.toContain("~");
  });

  it("returns public URL and file attachment chips without exposing attachment content", async () => {
    const questionMessage = {
      id: "user-message-1",
      session_id: "session-1",
      role: "user",
      content:
        "이게뭐야?\n\n<attached_file name=\"notes.md\">\nsecret inline attachment\n</attached_file>",
      metadata: {
        user_urls: [
          "https://www.google.com/search?q=x.com&newwindow=1",
          "javascript:alert(1)",
        ],
      },
      status: "completed",
      request_id: null,
      created_at: "2026-05-31T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z",
    } satisfies MessageRow;

    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createPublicShareAdminWithQuestionAttachments({
        share: {
          token: "share-token",
          title: "공유된 답변",
          question_content: "이게뭐야?",
          question_created_at: "2026-05-31T00:00:00.000Z",
          source_question_message_id: questionMessage.id,
          answer_content: "답변 본문",
          answer_created_at: "2026-05-31T00:01:00.000Z",
          tickers: ["AAPL"],
          created_at: "2026-05-31T00:02:00.000Z",
        },
        questionMessage,
        documentFiles: [
          {
            file_name: "filing.pdf",
            mime_type: "application/pdf",
            file_size: 2048,
          },
        ],
      }),
    );

    const share = await findPublicMessageShare("share-token");

    expect(share?.question_attachments).toEqual({
      urls: ["https://www.google.com/search?q=x.com&newwindow=1"],
      files: [
        { name: "notes.md", mimeType: null, size: 24 },
        { name: "filing.pdf", mimeType: "application/pdf", size: 2048 },
      ],
    });
    expect(JSON.stringify(share)).not.toContain("secret inline attachment");
    expect(JSON.stringify(share)).not.toContain("javascript:");
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

  it("removes placeholder tickers from shared starter data", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createPublicShareAdmin({
        token: "share-token",
        title: "공유된 답변",
        question_content: "서비스 매출 리스크를 정리해줘.",
        question_created_at: "2026-05-31T00:00:00.000Z",
        answer_content: "답변 본문",
        answer_created_at: "2026-05-31T00:00:00.000Z",
        tickers: ["UNKNOWN", " aapl ", "unknown"],
        created_at: "2026-05-31T00:00:00.000Z",
      }),
    );

    await expect(findPublicShareStarter("share-token")).resolves.toMatchObject({
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
      default_tickers: ["UNKNOWN", "AAPL"],
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
      share_context: { run_kind: null, guru_lens: null },
      snapshot_version: 2,
    });
    expect(String(insertedPayloads[0]?.question_content)).not.toContain(
      "secret attachment",
    );
  });

  it("redacts sensitive content before storing a share snapshot", async () => {
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
      content:
        "경로는 ~/krw-ontology-front 이고 SUPABASE_SERVICE_ROLE_KEY=secret 입니다.",
      status: "completed",
      request_id: null,
      created_at: "2026-05-31T00:01:00.000Z",
      updated_at: "2026-05-31T00:01:00.000Z",
    } satisfies MessageRow;
    const userMessage = {
      id: "user-message-1",
      session_id: session.id,
      role: "user",
      content: ".env 보여줘",
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

    expect(String(insertedPayloads[0]?.answer_content)).toContain(
      "[내부 경로 제거됨]",
    );
    expect(String(insertedPayloads[0]?.answer_content)).toContain(
      "[민감 환경변수 제거됨]",
    );
    expect(String(insertedPayloads[0]?.answer_content)).not.toContain(
      "~",
    );
    expect(String(insertedPayloads[0]?.question_content)).toBe(
      "[내부 설정 파일 제거됨] 보여줘",
    );
  });

  it("stores guru run context in the share snapshot", async () => {
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
      content: "버핏 렌즈 답변",
      status: "completed",
      request_id: null,
      created_at: "2026-05-31T00:01:00.000Z",
      updated_at: "2026-05-31T00:01:00.000Z",
    } satisfies MessageRow;
    const userMessage = {
      id: "user-message-1",
      session_id: session.id,
      role: "user",
      content: "AAPL을 버핏 관점으로 봐줘.",
      status: "completed",
      request_id: null,
      created_at: "2026-05-31T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z",
    } satisfies MessageRow;

    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createSnapshotAdmin({
        userMessage,
        insertedPayloads,
        run: {
          id: "run-1",
          run_kind: "guru_advisor",
          user_message_id: userMessage.id,
        },
        runQueuedPayload: { guru_lens: "buffett" },
      }),
    );

    await createMessageShare({
      userId: "user-1",
      message: answerMessage,
      session,
    });

    expect(insertedPayloads[0]).toMatchObject({
      share_context: { run_kind: "guru_advisor", guru_lens: "buffett" },
    });
  });
});
