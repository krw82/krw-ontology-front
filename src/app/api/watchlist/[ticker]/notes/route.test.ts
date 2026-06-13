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
  listCompanyNotes: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { POST } from "./route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/watchlist/AAPL/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
                      id: "20000000-0000-4000-8000-000000000001",
                      user_id: "user-1",
                      ticker: "AAPL",
                      title: "공시 점검",
                      body: "첫 줄\n\n둘째 줄",
                      note_type: "filing_check",
                      tags: ["margin"],
                      source_chat_session_id: "60000000-0000-4000-8000-000000000001",
                      source_message_id: "70000000-0000-4000-8000-000000000001",
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
        upsert(payload: unknown) {
          writes.push({ table, method: "upsert", payload });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;

  return { admin, writes };
}

async function json(response: Response) {
  return response.json() as Promise<{
    note?: { ticker: string; title: string; body: string; note_type: string };
    error?: { code: string; message: string };
  }>;
}

describe("POST /api/watchlist/[ticker]/notes", () => {
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

  it("stores a research note while preserving multiline body text", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest({
        title: "공시 점검",
        body: "첫 줄\r\n\r\n둘째 줄",
        note_type: "filing_check",
        tags: ["margin", "margin"],
        source_chat_session_id: "60000000-0000-4000-8000-000000000001",
        source_message_id: "70000000-0000-4000-8000-000000000001",
      }),
      { params: Promise.resolve({ ticker: "aapl" }) },
    );

    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      note: {
        ticker: "AAPL",
        title: "공시 점검",
        body: "첫 줄\n\n둘째 줄",
        note_type: "filing_check",
      },
    });
    expect(fake.writes[0]).toMatchObject({
      table: "user_research_notes",
      method: "insert",
      payload: {
        user_id: "user-1",
        ticker: "AAPL",
        title: "공시 점검",
        body: "첫 줄\n\n둘째 줄",
        note_type: "filing_check",
        tags: ["margin"],
        source_chat_session_id: "60000000-0000-4000-8000-000000000001",
        source_message_id: "70000000-0000-4000-8000-000000000001",
      },
    });
    expect(fake.writes[1]).toMatchObject({
      table: "user_company_marks",
      method: "upsert",
      payload: {
        user_id: "user-1",
        ticker: "AAPL",
        is_watchlisted: true,
      },
    });
  });

  it("rejects unsupported note types", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest({ title: "공시 점검", note_type: "price_target" }),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "노트 유형이 올바르지 않습니다.",
      },
    });
    expect(fake.writes).toEqual([]);
  });

  it("rejects invalid chat source references", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest({
        title: "채팅 요약",
        note_type: "chat_summary",
        source_message_id: "not-a-uuid",
      }),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "메시지 참조가 올바르지 않습니다.",
      },
    });
    expect(fake.writes).toEqual([]);
  });
});
