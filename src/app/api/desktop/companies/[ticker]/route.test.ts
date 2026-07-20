import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopFeatureAccess: vi.fn(),
}));
vi.mock("@/lib/desktop/resources/company-catalog-service", () => ({
  getDesktopCompany: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { getDesktopCompany } from "@/lib/desktop/resources/company-catalog-service";
import { GET } from "./route";

describe("GET /api/desktop/companies/:ticker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: null,
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopFeatureAccess).mockResolvedValue({} as never);
  });

  it("returns the Desktop detail DTO", async () => {
    vi.mocked(getDesktopCompany).mockResolvedValue({
      ok: true,
      contract_version: "desktop-company-detail/v2",
      data: { company: { ticker: "AAPL" } },
      meta: {
        catalog_release_id: "release-1",
        generated_at: null,
        max_age_seconds: 21_600,
      },
    } as never);

    const response = await GET(
      new NextRequest("http://localhost/api/desktop/companies/AAPL", {
        headers: { authorization: "Bearer token" },
      }),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      contract_version: "desktop-company-detail/v2",
      data: { company: { ticker: "AAPL" } },
    });
  });

  it("returns a safe 404 for unknown companies", async () => {
    vi.mocked(getDesktopCompany).mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/desktop/companies/MISS", {
        headers: { authorization: "Bearer token" },
      }),
      { params: Promise.resolve({ ticker: "MISS" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });
});
