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
  getIndexedCompany: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/watchlist/workspace", () => ({
  listCompanyQuestions: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { POST } from "./route";

function postRequest(body: unknown, origin?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new NextRequest("http://localhost/api/watchlist/AAPL/questions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function createAdmin() {
  const writes: Array<{ table: string; method: string; payload: unknown }> = [];
  const admin = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          writes.push({ table, method: "insert", payload });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: {
                      id: "10000000-0000-4000-8000-000000000001",
                      user_id: "user-1",
                      ticker: "AAPL",
                      question: "마진 하락이 일회성인가?",
                      status: "open",
                      source: "manual",
                      source_chat_session_id: null,
                      source_message_id: null,
                      answered_at: null,
                      created_at: "2026-06-13T00:00:00.000Z",
                      updated_at: "2026-06-13T00:00:00.000Z",
                    },
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

  return { admin, writes };
}

async function json(response: Response) {
  return response.json() as Promise<{
    question?: { ticker: string; question: string; source: string };
    error?: { code: string; message: string };
  }>;
}

describe("POST /api/watchlist/[ticker]/questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getIndexedCompany).mockResolvedValue({
      ticker: "AAPL",
      name: "Apple Inc.",
    } as Awaited<ReturnType<typeof getIndexedCompany>>);
  });

  it("stores a manual open question without creating coverage", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(postRequest({ question: "마진 하락이 일회성인가?" }), {
      params: Promise.resolve({ ticker: "aapl" }),
    });

    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      question: {
        ticker: "AAPL",
        question: "마진 하락이 일회성인가?",
        source: "manual",
      },
    });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      table: "user_company_questions",
      method: "insert",
      payload: {
        user_id: "user-1",
        ticker: "AAPL",
        question: "마진 하락이 일회성인가?",
        source: "manual",
      },
    });
  });

  it("rejects blank questions", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(postRequest({ question: "   " }), {
      params: Promise.resolve({ ticker: "AAPL" }),
    });

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "질문을 입력해주세요.",
      },
    });
    expect(fake.writes).toEqual([]);
  });

  it("blocks cross-origin question writes before authentication", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest(
        { question: "마진 하락이 일회성인가?" },
        "https://evil.example",
      ),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(403);
    expect(getAuthUser).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

});
