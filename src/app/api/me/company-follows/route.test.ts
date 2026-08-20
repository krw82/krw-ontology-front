import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() =>
    Response.json({ error: { code: "auth_required" } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/billing/entitlement", () => ({
  getEntitlementStatus: vi.fn(),
}));
vi.mock("@/lib/follow/company-follow", () => ({
  listUserCompanyFollows: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { listUserCompanyFollows } from "@/lib/follow/company-follow";
import { GET } from "./route";

function entitlementWithPlan(planKey: string) {
  return {
    status: "active" as const,
    plan: { key: planKey, label: planKey, status_label: planKey, description: "" },
    usage: {},
    features: [],
    upgrade: null,
  };
}

describe("GET /api/me/company-follows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "u1",
      email: "u@t",
    } as never);
    vi.mocked(listUserCompanyFollows).mockResolvedValue([
      {
        ticker: "AAPL",
        name: "Apple",
        sector: "Technology",
        followed_at: "2026-08-20T00:00:00Z",
      },
      {
        ticker: "TSLA",
        name: "Tesla",
        sector: "Automotive",
        followed_at: "2026-08-19T00:00:00Z",
      },
    ]);
  });

  it("requires an authenticated user", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(listUserCompanyFollows).not.toHaveBeenCalled();
  });

  it("returns follows with the free-plan active limit", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(
      entitlementWithPlan("free") as never,
    );
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      companies: [
        {
          ticker: "AAPL",
          name: "Apple",
          sector: "Technology",
          followed_at: "2026-08-20T00:00:00Z",
        },
        {
          ticker: "TSLA",
          name: "Tesla",
          sector: "Automotive",
          followed_at: "2026-08-19T00:00:00Z",
        },
      ],
      active_limit: 3,
    });
    expect(getEntitlementStatus).toHaveBeenCalledWith("u1", "u@t");
  });

  it("returns a null active limit for paid plans", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(
      entitlementWithPlan("pro") as never,
    );
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { active_limit: number | null };
    expect(payload.active_limit).toBeNull();
  });

  it("maps load failures to a 500 error response", async () => {
    vi.mocked(listUserCompanyFollows).mockRejectedValue(
      new Error("db down") as never,
    );
    const response = await GET();
    expect(response.status).toBe(500);
    const payload = (await response.json()) as {
      error: { code: string };
    };
    expect(payload.error.code).toBe("internal_error");
  });
});
