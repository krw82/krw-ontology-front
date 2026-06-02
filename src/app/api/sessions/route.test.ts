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
}));
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompanies: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { getIndexedCompanies } from "@/lib/ontology/catalog";
import { createClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

function getRequest() {
  return new NextRequest("http://localhost/api/sessions?page=1&limit=20");
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createSupabase(params: {
  sessions?: Array<Record<string, unknown>>;
  sessionsError?: { message: string } | null;
} = {}) {
  const queriedTables: string[] = [];
  const sessions = params.sessions ?? [
    {
      id: "session-1",
      user_id: "user-1",
      title: "AAPL",
      scope_type: "company",
      default_tickers: ["AAPL"],
      default_document_types: [],
      last_message_preview: "Apple 알려줘",
      last_message_at: "2026-05-31T00:00:00.000Z",
      latest_run_status: "completed",
      deleted_at: null,
      created_at: "2026-05-30T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z",
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
            or() {
              return query;
            },
            order() {
              return query;
            },
            range() {
              return query;
            },
            returns() {
              if (table === "chat_sessions") {
                return Promise.resolve({
                  data: params.sessionsError ? null : sessions,
                  error: params.sessionsError ?? null,
                  count: params.sessionsError ? null : sessions.length,
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
    sessions?: Array<Record<string, unknown>>;
    error?: { code: string; message: string };
  }>;
}

describe("GET /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
  });

  it("returns session summaries when all summary queries succeed", async () => {
    const supabase = createSupabase();
    vi.mocked(createClient).mockResolvedValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      sessions: [
        {
          id: "session-1",
          last_message_preview: "Apple 알려줘",
          latest_run_status: "completed",
        },
      ],
    });
    expect(supabase.queriedTables).toEqual(["chat_sessions"]);
  });

  it("hides internal assistant narration from session previews", async () => {
    const supabase = createSupabase({
      sessions: [
        {
          id: "session-1",
          user_id: "user-1",
          title: "NOW",
          scope_type: "company",
          default_tickers: ["NOW"],
          default_document_types: [],
          last_message_preview:
            "Let me retrieve the full query_context output and run targeted follow-up queries",
          last_message_at: "2026-05-31T00:00:00.000Z",
          latest_run_status: "completed",
          deleted_at: null,
          created_at: "2026-05-30T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(supabase.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      sessions: [
        {
          id: "session-1",
          last_message_preview: "",
        },
      ],
    });
  });

  it("returns 500 when the session list query fails", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabase({ sessionsError: { message: "db failed" } }).client,
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "채팅 목록을 불러오지 못했습니다.",
      },
    });
  });
});

describe("POST /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
  });

  it("validates company tickers with one batch catalog lookup", async () => {
    vi.mocked(getIndexedCompanies).mockResolvedValue([
      { ticker: "AAPL", name: "Apple Inc." },
    ] as Awaited<ReturnType<typeof getIndexedCompanies>>);

    const response = await POST(
      postRequest({
        scope_type: "company",
        default_tickers: [" aapl ", "MSFT", "AAPL"],
      }),
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "현재 온톨로지 인덱스에 없는 회사입니다: MSFT",
      },
    });
    expect(getIndexedCompanies).toHaveBeenCalledTimes(1);
    expect(getIndexedCompanies).toHaveBeenCalledWith(["AAPL", "MSFT"]);
    expect(createClient).not.toHaveBeenCalled();
  });
});
