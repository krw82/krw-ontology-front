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

function request() {
  return new NextRequest(`http://localhost/api/chat/${SESSION_ID}`);
}

function params(sessionId = SESSION_ID) {
  return { params: Promise.resolve({ sessionId }) };
}

function createSupabase(overrides: {
  session?: Record<string, unknown> | null;
  messages?: Array<Record<string, unknown>>;
  sessionError?: { message: string } | null;
  messagesError?: { message: string } | null;
  runsError?: { message: string } | null;
} = {}) {
  const queriedTables: string[] = [];
  const session = overrides.session ?? {
    id: SESSION_ID,
    user_id: "user-1",
    title: "AAPL",
    claude_session_id: null,
    client_request_id: null,
    scope_type: "company",
    default_tickers: ["AAPL"],
    default_document_types: [],
    deleted_at: null,
    created_at: "2026-05-31T00:00:00.000Z",
    updated_at: "2026-05-31T00:00:00.000Z",
  };
  const messages = overrides.messages ?? [
    {
      id: "message-1",
      session_id: SESSION_ID,
      role: "user",
      content: "Apple 알려줘",
      status: "failed",
      request_id: null,
      created_at: "2026-05-31T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z",
    },
  ];
  const runs = [
    {
      id: "run-1",
      status: "completed",
      model: "claude-sonnet-4-6",
      assistant_message_id: "assistant-message-1",
      queued_at: "2026-05-31T00:00:00.000Z",
      started_at: null,
      finished_at: "2026-05-31T00:01:00.000Z",
      latency_ms: 60_000,
      input_tokens: 100,
      output_tokens: 200,
      estimated_cost_usd: 0.01,
      ontology_env: "dev",
      worker_env: "dev",
      ontology_release_id: "release-1",
      index_generated_at: "2026-05-31T00:00:00.000Z",
      company_count: 1,
      document_count: 1,
      object_count: 1,
      ontology_root: "/tmp/ontology",
      index_path: "/tmp/index.sqlite",
      manifest_path: "/tmp/manifest.json",
      manifest_valid: true,
      agent_index_schema_version: "agent_index_v1",
      error_code: "claude_api_error",
      error_message: "stack trace: secret=/srv/claude-prod/token",
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
              if (table !== "chat_sessions") {
                throw new Error(`Unexpected maybeSingle table: ${table}`);
              }
              return Promise.resolve({
                data: overrides.sessionError ? null : session,
                error: overrides.sessionError ?? null,
              });
            },
            returns() {
              if (table === "messages") {
                return Promise.resolve({
                  data: overrides.messagesError ? null : messages,
                  error: overrides.messagesError ?? null,
                });
              }
              if (table === "agent_runs") {
                return Promise.resolve({
                  data: overrides.runsError ? null : runs,
                  error: overrides.runsError ?? null,
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
    messages?: Array<Record<string, unknown>>;
    runs?: Array<Record<string, unknown>>;
    tool_calls?: Array<Record<string, unknown>>;
    citations?: Array<Record<string, unknown>>;
  }>;
}

describe("GET /api/chat/[sessionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
  });

  it("rejects invalid ids before auth and database work", async () => {
    const response = await GET(request(), params("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("returns chat details when all queries succeed", async () => {
    const supabase = createSupabase();
    vi.mocked(createClient).mockResolvedValue(supabase.client);

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({
      messages: [{ id: "message-1" }],
      runs: [
        {
          id: "run-1",
          started_at: "2026-05-31T00:00:00.000Z",
          error_code: "claude_api_error",
          error_message:
            "에이전트 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        },
      ],
    });
    expect(body.runs?.[0]).not.toHaveProperty("ontology_root");
    expect(body.runs?.[0]).not.toHaveProperty("index_path");
    expect(body.runs?.[0]).not.toHaveProperty("manifest_path");
    expect(body.runs?.[0]?.error_message).not.toContain(
      "/srv/claude-prod/token",
    );
    expect(supabase.queriedTables).toEqual([
      "chat_sessions",
      "messages",
      "agent_runs",
    ]);
    expect(body).not.toHaveProperty("tool_calls");
    expect(body).not.toHaveProperty("citations");
  });

  it("returns assistant messages without leading internal narration", async () => {
    const supabase = createSupabase({
      messages: [
        {
          id: "message-1",
          session_id: SESSION_ID,
          role: "user",
          content: "Let me retrieve라고 사용자가 직접 입력",
          status: "completed",
          request_id: null,
          created_at: "2026-05-31T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
        {
          id: "message-2",
          session_id: SESSION_ID,
          role: "assistant",
          content:
            "Let me retrieve more evidence.분석 결과를 작성하겠습니다.\n\n---\n\n최종 답변입니다.",
          status: "completed",
          request_id: null,
          created_at: "2026-05-31T00:01:00.000Z",
          updated_at: "2026-05-31T00:01:00.000Z",
        },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(supabase.client);

    const response = await GET(request(), params());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.messages).toMatchObject([
      { role: "user", content: "Let me retrieve라고 사용자가 직접 입력" },
      { role: "assistant", content: "최종 답변입니다." },
    ]);
  });

  it("returns 500 instead of not_found when session loading fails", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabase({ sessionError: { message: "db failed" } }).client,
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "채팅을 불러오지 못했습니다.",
      },
    });
  });

  it("returns 500 instead of empty messages when message loading fails", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabase({ messagesError: { message: "db failed" } }).client,
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "채팅 메시지를 불러오지 못했습니다.",
      },
    });
  });

  it("returns 500 instead of empty runs when run loading fails", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabase({ runsError: { message: "db failed" } }).client,
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "채팅 실행 기록을 불러오지 못했습니다.",
      },
    });
  });

});
