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

import { getAuthUser } from "@/lib/auth";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PUT } from "./route";

function putRequest(body: unknown) {
  return new NextRequest("http://localhost/api/watchlist/AAPL/card", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createAdmin() {
  const writes: Array<{ table: string; payload: unknown; options: unknown }> = [];
  const admin = {
    from(table: string) {
      return {
        upsert(payload: unknown, options: unknown) {
          writes.push({ table, payload, options });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: {
                      id: "30000000-0000-4000-8000-000000000001",
                      user_id: "user-1",
                      ticker: "AAPL",
                      title: "AAPL 종목 카드",
                      summary: "서비스 매출과 자사주가 핵심 변수",
                      content_md: "사업 구조\n\n핵심 변수",
                      basis_release_id: null,
                      basis_period: "CY2026Q1",
                      basis_document_type: "10-Q",
                      source_chat_session_id: null,
                      source_message_id: null,
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
    card?: { ticker: string; title: string; content_md: string };
    error?: { code: string; message: string };
  }>;
}

describe("PUT /api/watchlist/[ticker]/card", () => {
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

  it("upserts a user-owned company card and touches the mark", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await PUT(
      putRequest({
        title: "AAPL 종목 카드",
        summary: "서비스 매출과 자사주가 핵심 변수",
        content_md: "사업 구조\r\n\r\n핵심 변수",
        basis_period: "CY2026Q1",
        basis_document_type: "10-Q",
        source_chat_session_id: "60000000-0000-4000-8000-000000000001",
        source_message_id: "70000000-0000-4000-8000-000000000001",
      }),
      { params: Promise.resolve({ ticker: "aapl" }) },
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      card: {
        ticker: "AAPL",
        title: "AAPL 종목 카드",
        content_md: "사업 구조\n\n핵심 변수",
      },
    });
    expect(fake.writes).toHaveLength(2);
    expect(fake.writes[0]).toMatchObject({
      table: "user_company_cards",
      options: { onConflict: "user_id,ticker" },
      payload: {
        user_id: "user-1",
        ticker: "AAPL",
        title: "AAPL 종목 카드",
        summary: "서비스 매출과 자사주가 핵심 변수",
        content_md: "사업 구조\n\n핵심 변수",
        basis_period: "CY2026Q1",
        basis_document_type: "10-Q",
        source_chat_session_id: "60000000-0000-4000-8000-000000000001",
        source_message_id: "70000000-0000-4000-8000-000000000001",
      },
    });
    expect(fake.writes[1]).toMatchObject({
      table: "user_company_marks",
      options: { onConflict: "user_id,ticker" },
      payload: {
        user_id: "user-1",
        ticker: "AAPL",
        is_watchlisted: true,
      },
    });
  });

  it("rejects invalid chat source references before writing", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await PUT(
      putRequest({
        title: "AAPL 종목 카드",
        content_md: "사업 구조",
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
