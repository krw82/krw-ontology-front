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
import { POST } from "./route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/watchlist/AAPL/theses", {
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
                      id: "40000000-0000-4000-8000-000000000001",
                      user_id: "user-1",
                      ticker: "AAPL",
                      title: "서비스 매출 방어력",
                      thesis_text: "서비스 매출과 자사주가 EPS를 방어할 수 있는지 본다.",
                      status: "active",
                      tags: ["service", "buyback"],
                      archived_at: null,
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
    thesis?: { ticker: string; title: string; status: string; tags: string[] };
    error?: { code: string; message: string };
  }>;
}

describe("POST /api/watchlist/[ticker]/theses", () => {
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

  it("stores a thesis without using investment-recommendation statuses", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest({
        title: "서비스 매출 방어력",
        thesis_text: "서비스 매출과 자사주가 EPS를 방어할 수 있는지 본다.",
        status: "active",
        tags: ["service", "buyback", "service"],
        source_chat_session_id: "60000000-0000-4000-8000-000000000001",
        source_message_id: "70000000-0000-4000-8000-000000000001",
      }),
      { params: Promise.resolve({ ticker: "aapl" }) },
    );

    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      thesis: {
        ticker: "AAPL",
        title: "서비스 매출 방어력",
        status: "active",
        tags: ["service", "buyback"],
      },
    });
    expect(fake.writes[0]).toMatchObject({
      table: "user_company_theses",
      method: "insert",
      payload: {
        user_id: "user-1",
        ticker: "AAPL",
        title: "서비스 매출 방어력",
        thesis_text: "서비스 매출과 자사주가 EPS를 방어할 수 있는지 본다.",
        status: "active",
        tags: ["service", "buyback"],
        source_chat_session_id: "60000000-0000-4000-8000-000000000001",
        source_message_id: "70000000-0000-4000-8000-000000000001",
      },
    });
  });

  it("rejects invalid chat source references before writing", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest({
        title: "서비스 매출 방어력",
        thesis_text: "서비스 매출과 자사주를 본다.",
        source_chat_session_id: "not-a-uuid",
      }),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "채팅 세션 참조가 올바르지 않습니다.",
      },
    });
    expect(fake.writes).toEqual([]);
  });

  it("rejects unsupported thesis statuses", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest({
        title: "서비스 매출 방어력",
        thesis_text: "서비스 매출과 자사주를 본다.",
        status: "buy",
      }),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "Thesis 상태가 올바르지 않습니다.",
      },
    });
    expect(fake.writes).toEqual([]);
  });
});
