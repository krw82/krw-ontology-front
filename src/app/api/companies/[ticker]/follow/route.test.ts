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
vi.mock("@/lib/follow/company-follow", () => ({
  followCompanyServer: vi.fn(),
  unfollowCompanyServer: vi.fn(),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  isExpectedMutationOrigin: vi.fn(() => true),
  invalidOriginResponse: vi.fn(() =>
    Response.json({ error: { code: "forbidden" } }, { status: 403 }),
  ),
}));
vi.mock("@/lib/watchlist/api", () => ({
  errorResponse: vi.fn(
    (status: number, code: string, message: string) =>
      Response.json({ error: { code, message } }, { status }),
  ),
  requireIndexedTicker: vi.fn(async () => ({ ok: true, ticker: "AAPL" })),
}));

import { getAuthUser } from "@/lib/auth";
import { recordCoverageMutationAnalytics } from "@/lib/coverage/analytics";
import {
  followCompanyServer,
  unfollowCompanyServer,
} from "@/lib/follow/company-follow";
import { DELETE, PUT } from "./route";

const params = Promise.resolve({ ticker: "AAPL" });

function mutationRequest(method: "PUT" | "DELETE") {
  return new NextRequest("http://localhost/api/companies/AAPL/follow", {
    method,
  });
}

describe("company follow route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "u1",
      email: "u@t",
    } as never);
  });

  it("returns the unified follow payload", async () => {
    vi.mocked(followCompanyServer).mockResolvedValue({
      ok: true,
      mark: { ticker: "AAPL", coverage_level: "interest" },
      alerts: "on",
      newsFollow: true,
      coverageResult: {
        eventId: "e1",
        changed: true,
        idempotentReplay: false,
        previousLevel: null,
        mark: { ticker: "AAPL" },
      },
    } as never);
    const response = await PUT(mutationRequest("PUT"), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mark: { ticker: "AAPL", coverage_level: "interest" },
      alerts: "on",
      news_follow: true,
    });
    expect(recordCoverageMutationAnalytics).toHaveBeenCalledTimes(1);
  });

  it("passes no_sec_id through without failing the follow", async () => {
    vi.mocked(followCompanyServer).mockResolvedValue({
      ok: true,
      mark: null,
      alerts: "no_sec_id",
      newsFollow: true,
      coverageResult: {} as never,
    } as never);
    const response = await PUT(mutationRequest("PUT"), { params });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.alerts).toBe("no_sec_id");
  });

  it("maps limit_reached to 409 coverage_limit_reached", async () => {
    vi.mocked(followCompanyServer).mockResolvedValue({
      ok: false,
      reason: "limit_reached",
    } as never);
    const response = await PUT(mutationRequest("PUT"), { params });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.code).toBe("coverage_limit_reached");
    expect(payload.error.message).toContain("3개");
  });

  it("maps service errors to 503", async () => {
    vi.mocked(followCompanyServer).mockResolvedValue({
      ok: false,
      reason: "error",
    } as never);
    const response = await PUT(mutationRequest("PUT"), { params });
    expect(response.status).toBe(503);
  });

  it("requires auth", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
    const response = await PUT(mutationRequest("PUT"), { params });
    expect(response.status).toBe(401);
  });

  it("deletes through the unified unfollow", async () => {
    vi.mocked(unfollowCompanyServer).mockResolvedValue({ ok: true });
    const response = await DELETE(mutationRequest("DELETE"), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("maps unfollow failures to 503", async () => {
    vi.mocked(unfollowCompanyServer).mockResolvedValue({ ok: false });
    const response = await DELETE(mutationRequest("DELETE"), { params });
    expect(response.status).toBe(503);
  });
});
