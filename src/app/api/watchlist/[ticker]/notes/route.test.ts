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
vi.mock("@/lib/coverage/repository", () => ({
  CoverageIdempotencyConflictError: class CoverageIdempotencyConflictError extends Error {
    readonly code = "idempotency_conflict";
  },
  CoverageLimitError: class CoverageLimitError extends Error {
    readonly code = "coverage_limit_reached";

    constructor() {
      super("무료 플랜에서는 진행 중인 회사 커버리지를 최대 3개까지 둘 수 있습니다.");
    }
  },
  ensureCompanyCoverage: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/watchlist/workspace", () => ({
  listCompanyNotes: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import {
  CoverageIdempotencyConflictError,
  CoverageLimitError,
  ensureCompanyCoverage,
} from "@/lib/coverage/repository";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { POST } from "./route";

function postRequest(body: unknown, origin?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new NextRequest("http://localhost/api/watchlist/AAPL/notes", {
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
    vi.mocked(ensureCompanyCoverage).mockResolvedValue({
      user_id: "user-1",
      ticker: "AAPL",
      coverage_status: "exploring",
      priority: 0,
      interest_reason: null,
      tags: [],
      last_activity_at: null,
      created_at: "2026-06-13T00:00:00.000Z",
      updated_at: "2026-06-13T00:00:00.000Z",
    });
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
    expect(ensureCompanyCoverage).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "user@example.test",
      ticker: "AAPL",
      source: "note_created",
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
    expect(ensureCompanyCoverage).not.toHaveBeenCalled();
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
    expect(ensureCompanyCoverage).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes before authentication or persistence", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(
      postRequest({ title: "공시 점검" }, "https://evil.example"),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(403);
    expect(getAuthUser).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
    expect(ensureCompanyCoverage).not.toHaveBeenCalled();
  });

  it("does not create a note when the coverage limit rejects the company", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(ensureCompanyCoverage).mockRejectedValueOnce(new CoverageLimitError());

    const response = await POST(
      postRequest({ title: "공시 점검" }),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      error: { code: "coverage_limit_reached" },
    });
    expect(fake.writes).toEqual([]);
  });

  it("maps coverage idempotency conflicts without writing the child row", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(ensureCompanyCoverage).mockRejectedValueOnce(
      new CoverageIdempotencyConflictError(),
    );

    const response = await POST(
      postRequest({ title: "공시 점검" }),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    expect(fake.writes).toEqual([]);
  });
});
