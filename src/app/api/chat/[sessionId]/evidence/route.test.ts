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

import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

function request(messageId = MESSAGE_ID) {
  return new NextRequest(
    `http://localhost/api/chat/${SESSION_ID}/evidence?message_id=${messageId}`,
  );
}

function params(sessionId = SESSION_ID) {
  return { params: Promise.resolve({ sessionId }) };
}

function createSupabase(
  overrides: {
    session?: Record<string, unknown> | null;
    message?: Record<string, unknown> | null;
    sessionError?: { message: string } | null;
    messageError?: { message: string } | null;
    runsError?: { message: string } | null;
    toolCallsError?: { message: string } | null;
    citationsError?: { message: string } | null;
  } = {},
) {
  const queriedTables: string[] = [];
  const session = overrides.session ?? {
    id: SESSION_ID,
    user_id: "user-1",
  };
  const message = overrides.message ?? {
    id: MESSAGE_ID,
    session_id: SESSION_ID,
    role: "assistant",
  };
  const runs = [
    {
      id: "run-1",
      assistant_message_id: MESSAGE_ID,
      queued_at: "2026-05-31T00:00:00.000Z",
    },
  ];
  const toolCalls = [
    {
      id: "tool-call-1",
      run_id: "run-1",
      tool_use_id: "tool-use-1",
      tool_name: "krw_ontology_query",
      arguments_json: { ticker: "AAPL" },
      result_summary: "summary only",
      started_at: "2026-05-31T00:00:01.000Z",
      finished_at: "2026-05-31T00:00:02.000Z",
      error_message: null,
    },
  ];
  const citations = [
    {
      id: "citation-1",
      message_id: MESSAGE_ID,
      run_id: "run-1",
      object_id: "object-1",
      ticker: "AAPL",
      document_type: "10-K",
      period: "FY2025",
      section: "Risk Factors",
      quote_text: "quoted text",
      claim_text: "claim text",
      evidence_grade: "primary",
      source_quality: "high",
    },
  ];

  const client = {
    from(table: string) {
      queriedTables.push(table);
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            is() {
              return query;
            },
            in() {
              return query;
            },
            order() {
              return query;
            },
            maybeSingle() {
              if (table === "chat_sessions") {
                return Promise.resolve({
                  data: overrides.sessionError ? null : session,
                  error: overrides.sessionError ?? null,
                });
              }
              if (table === "messages") {
                return Promise.resolve({
                  data: overrides.messageError ? null : message,
                  error: overrides.messageError ?? null,
                });
              }
              throw new Error(`Unexpected maybeSingle table: ${table}`);
            },
            returns() {
              if (table === "agent_runs") {
                return Promise.resolve({
                  data: overrides.runsError ? null : runs,
                  error: overrides.runsError ?? null,
                });
              }
              if (table === "tool_calls") {
                return Promise.resolve({
                  data: overrides.toolCallsError ? null : toolCalls,
                  error: overrides.toolCallsError ?? null,
                });
              }
              if (table === "citations") {
                return Promise.resolve({
                  data: overrides.citationsError ? null : citations,
                  error: overrides.citationsError ?? null,
                });
              }
              throw new Error(`Unexpected table: ${table}`);
            },
          };
          return query;
        },
      };
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>;

  return { client, queriedTables };
}

async function json(response: Response) {
  return response.json() as Promise<{
    error?: { code: string; message: string };
    message_id?: string;
    run_ids?: string[];
    tool_calls?: Array<Record<string, unknown>>;
    citations?: Array<Record<string, unknown>>;
  }>;
}

describe("GET /api/chat/[sessionId]/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
  });

  it("rejects invalid session ids before auth and database work", async () => {
    const response = await GET(request(), params("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("returns only scoped evidence summaries for an assistant message", async () => {
    const supabase = createSupabase();
    vi.mocked(createClient).mockResolvedValue(supabase.client);

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      message_id: MESSAGE_ID,
      run_ids: ["run-1"],
      tool_calls: [
        {
          id: "tool-call-1",
          result_summary: "summary only",
          result_json: null,
          result_text: null,
        },
      ],
      citations: [
        {
          id: "citation-1",
          trace_json: null,
        },
      ],
    });
    expect(supabase.queriedTables).toEqual([
      "chat_sessions",
      "messages",
      "agent_runs",
      "tool_calls",
      "citations",
    ]);
  });

  it("rejects evidence requests for non-assistant messages", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabase({
        message: { id: MESSAGE_ID, session_id: SESSION_ID, role: "user" },
      }).client,
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({
      error: {
        code: "not_found",
        message: "근거를 찾지 못했습니다.",
      },
    });
  });

  it("returns 500 instead of empty evidence when tool call loading fails", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabase({ toolCallsError: { message: "db failed" } }).client,
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "도구 실행 기록을 불러오지 못했습니다.",
      },
    });
  });

  it("returns 500 instead of empty evidence when citation loading fails", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabase({ citationsError: { message: "db failed" } }).client,
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "인용 기록을 불러오지 못했습니다.",
      },
    });
  });
});
