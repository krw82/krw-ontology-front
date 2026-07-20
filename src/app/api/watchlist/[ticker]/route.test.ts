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
  getCompanyCoverageStatus: vi.fn(),
  setCompanyCoverageStatusWithEvent: vi.fn(),
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
  parseJsonObject: vi.fn(async () => ({ coverage_status: "watching" })),
  requireIndexedTicker: vi.fn(async () => ({ ok: true, ticker: "AAPL" })),
  stringArrayInput: vi.fn(() => undefined),
  stringInput: vi.fn(() => undefined),
}));
vi.mock("@/lib/watchlist/workspace", () => ({
  getWatchlistCompanyDetail: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import {
  getCompanyCoverageStatus,
  setCompanyCoverageStatusWithEvent,
} from "@/lib/coverage/repository";
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
    vi.mocked(getCompanyCoverageStatus).mockRejectedValue(
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
        body: JSON.stringify({ coverage_status: "watching" }),
      },
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ ticker: "AAPL" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable" },
    });
    expect(setCompanyCoverageStatusWithEvent).not.toHaveBeenCalled();
  });
});
