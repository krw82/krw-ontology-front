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
  return new NextRequest("http://localhost/api/watchlist", {
    method: "POST",
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
                      user_id: "user-1",
                      ticker: "AAPL",
                      is_watchlisted: true,
                      is_holding: true,
                      priority: 0,
                      interest_reason: "제품 전환 확인",
                      tags: ["long-term", "ai"],
                      last_activity_at: "2026-06-13T00:00:00.000Z",
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
    mark?: { ticker: string; tags: string[] };
    error?: { code: string; message: string };
  }>;
}

describe("POST /api/watchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
  });

  it("validates the ticker and upserts a personal company mark", async () => {
    vi.mocked(getIndexedCompany).mockResolvedValue({
      ticker: "AAPL",
      name: "Apple Inc.",
    } as Awaited<ReturnType<typeof getIndexedCompany>>);
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest({
        ticker: " aapl ",
        is_watchlisted: true,
        is_holding: true,
        interest_reason: "제품 전환 확인",
        tags: ["long-term", "ai", "ai"],
      }),
    );

    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      mark: { ticker: "AAPL", tags: ["long-term", "ai"] },
    });
    expect(getIndexedCompany).toHaveBeenCalledWith("AAPL");
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      table: "user_company_marks",
      options: { onConflict: "user_id,ticker" },
      payload: {
        user_id: "user-1",
        ticker: "AAPL",
        is_watchlisted: true,
        is_holding: true,
        interest_reason: "제품 전환 확인",
        tags: ["long-term", "ai"],
      },
    });
  });

  it("rejects unknown tickers before writing user data", async () => {
    vi.mocked(getIndexedCompany).mockResolvedValue(null);
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(postRequest({ ticker: "NOPE" }));

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "현재 온톨로지 인덱스에 없는 회사입니다: NOPE",
      },
    });
    expect(fake.writes).toEqual([]);
  });

  it("returns a service error when ticker validation cannot reach the catalog", async () => {
    vi.mocked(getIndexedCompany).mockRejectedValue(new Error("catalog down"));
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(postRequest({ ticker: "AAPL" }));

    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({
      error: {
        code: "service_unavailable",
        message: "온톨로지 인덱스를 확인하지 못했습니다.",
      },
    });
    expect(fake.writes).toEqual([]);
  });
});
