import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() =>
    Response.json({ error: { code: "auth_required" } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/coverage/analytics", () => ({
  recordCoverageMutationAnalytics: vi.fn(),
}));
vi.mock("@/lib/coverage/repository", () => ({
  CoverageIdempotencyConflictError: class CoverageIdempotencyConflictError extends Error {},
  CoverageLimitError: class CoverageLimitError extends Error {},
  getCompanyCoverage: vi.fn(),
  setCompanyCoverageLevelWithEvent: vi.fn(),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  isExpectedMutationOrigin: vi.fn(() => true),
  invalidOriginResponse: vi.fn(() =>
    Response.json({ error: { code: "forbidden" } }, { status: 403 }),
  ),
}));
vi.mock("@/lib/watchlist/api", () => ({
  errorResponse: vi.fn((status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  ),
  parseJsonObject: vi.fn(async () => ({ coverage_level: "interest" })),
  requireIndexedTicker: vi.fn(async () => ({ ok: true, ticker: "AAPL" })),
  stringArrayInput: vi.fn(() => undefined),
  stringInput: vi.fn(() => undefined),
}));
vi.mock("@/lib/watchlist/workspace", () => ({
  getWatchlistCompanyDetail: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import {
  getCompanyCoverage,
  setCompanyCoverageLevelWithEvent,
} from "@/lib/coverage/repository";
import { parseJsonObject } from "@/lib/watchlist/api";
import { PATCH } from "./route";

describe("watchlist company mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as never);
  });

  it("fails closed when the existing coverage state cannot be loaded", async () => {
    vi.mocked(getCompanyCoverage).mockRejectedValue(
      new Error("database unavailable"),
    );
    const request = new NextRequest(
      "https://krwontology.com/api/watchlist/AAPL",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://krwontology.com",
        },
        body: JSON.stringify({ coverage_level: "interest" }),
      },
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticker: "AAPL" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable" },
    });
    expect(setCompanyCoverageLevelWithEvent).not.toHaveBeenCalled();
  });

  it("clears an existing coverage level without deleting the company record", async () => {
    vi.mocked(parseJsonObject).mockResolvedValue({ coverage_level: null });
    vi.mocked(getCompanyCoverage).mockResolvedValue({
      user_id: "user-1",
      ticker: "AAPL",
      coverage_level: "holding",
      priority: 0,
      interest_reason: null,
      tags: [],
      last_activity_at: null,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    });
    vi.mocked(setCompanyCoverageLevelWithEvent).mockResolvedValue({
      mark: {
        user_id: "user-1",
        ticker: "AAPL",
        coverage_level: null,
        priority: 0,
        interest_reason: null,
        tags: [],
        last_activity_at: null,
        created_at: "2026-07-20T00:00:00.000Z",
        updated_at: "2026-07-20T00:00:00.000Z",
      },
      eventId: "20000000-0000-4000-8000-000000000001",
      previousLevel: "holding",
      changed: true,
      idempotentReplay: false,
    });
    const request = new NextRequest(
      "https://krwontology.com/api/watchlist/AAPL",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://krwontology.com",
        },
        body: JSON.stringify({ coverage_level: null }),
      },
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticker: "AAPL" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mark: { coverage_level: null },
    });
    expect(setCompanyCoverageLevelWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({ coverageLevel: null, ticker: "AAPL" }),
    );
  });
});
