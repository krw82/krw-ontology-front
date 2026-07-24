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
vi.mock("@/lib/coverage/repository", () => ({
  CoverageIdempotencyConflictError: class CoverageIdempotencyConflictError extends Error {
    readonly code = "idempotency_conflict";
  },
  CoverageLimitError: class CoverageLimitError extends Error {
    readonly code = "coverage_limit_reached";
  },
  setCompanyCoverageLevelWithEvent: vi.fn(),
}));
vi.mock("@/lib/coverage/analytics", () => ({
  recordCoverageMutationAnalytics: vi.fn(),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  isExpectedMutationOrigin: vi.fn(() => true),
  invalidOriginResponse: vi.fn(() =>
    Response.json({ error: { code: "forbidden" } }, { status: 403 }),
  ),
}));

import { getAuthUser } from "@/lib/auth";
import { setCompanyCoverageLevelWithEvent } from "@/lib/coverage/repository";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { POST } from "./route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    vi.mocked(setCompanyCoverageLevelWithEvent).mockResolvedValue({
      mark: {
        user_id: "user-1",
        ticker: "AAPL",
        coverage_level: "interest",
        priority: 0,
        interest_reason: "제품 전환 확인",
        tags: ["long-term", "ai"],
        last_activity_at: "2026-06-13T00:00:00.000Z",
        created_at: "2026-06-13T00:00:00.000Z",
        updated_at: "2026-06-13T00:00:00.000Z",
      },
      eventId: "00000000-0000-4000-8000-000000000010",
      previousLevel: null,
      changed: true,
      idempotentReplay: false,
    });

    const response = await POST(
      postRequest({
        ticker: " aapl ",
        coverage_level: "interest",
        client_mutation_id: "coverage-AAPL-1",
        interest_reason: "제품 전환 확인",
        tags: ["long-term", "ai", "ai"],
      }),
    );

    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      mark: { ticker: "AAPL", tags: ["long-term", "ai"] },
    });
    expect(getIndexedCompany).toHaveBeenCalledWith("AAPL");
    expect(setCompanyCoverageLevelWithEvent).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "user@example.test",
      ticker: "AAPL",
      coverageLevel: "interest",
      idempotencyKey: "coverage-AAPL-1",
      source: "watchlist_create",
      interestReason: "제품 전환 확인",
      tags: ["long-term", "ai"],
    });
  });

  it("rejects the removed holding coverage level before writing user data", async () => {
    vi.mocked(getIndexedCompany).mockResolvedValue({
      ticker: "AAPL",
      name: "Apple Inc.",
    } as Awaited<ReturnType<typeof getIndexedCompany>>);

    const response = await POST(postRequest({
      ticker: "AAPL",
      coverage_level: "holding",
    }));

    expect(response.status).toBe(400);
    expect(setCompanyCoverageLevelWithEvent).not.toHaveBeenCalled();
  });

  it("rejects unknown tickers before writing user data", async () => {
    vi.mocked(getIndexedCompany).mockResolvedValue(null);
    const response = await POST(postRequest({ ticker: "NOPE" }));

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "현재 온톨로지 인덱스에 없는 회사입니다: NOPE",
      },
    });
    expect(setCompanyCoverageLevelWithEvent).not.toHaveBeenCalled();
  });

  it("returns a service error when ticker validation cannot reach the catalog", async () => {
    vi.mocked(getIndexedCompany).mockRejectedValue(new Error("catalog down"));
    const response = await POST(postRequest({ ticker: "AAPL" }));

    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({
      error: {
        code: "service_unavailable",
        message: "온톨로지 인덱스를 확인하지 못했습니다.",
      },
    });
    expect(setCompanyCoverageLevelWithEvent).not.toHaveBeenCalled();
  });
});
