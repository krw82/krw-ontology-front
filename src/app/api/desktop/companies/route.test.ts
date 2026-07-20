import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopFeatureAccess: vi.fn(),
}));
vi.mock("@/lib/desktop/resources/company-catalog-service", () => ({
  listDesktopCompanies: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { listDesktopCompanies } from "@/lib/desktop/resources/company-catalog-service";
import { GET } from "./route";

function request(headers: Record<string, string> = {}) {
  return new NextRequest(
    "http://localhost/api/desktop/companies?q=apple&limit=20",
    {
      headers: {
        authorization: "Bearer token",
        ...headers,
      },
    },
  );
}

describe("GET /api/desktop/companies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: "user@example.test",
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopFeatureAccess).mockResolvedValue({} as never);
    vi.mocked(listDesktopCompanies).mockResolvedValue({
      etag: '"catalog-etag"',
      payload: {
        ok: true,
        contract_version: "desktop-company-catalog/v2",
        data: { companies: [{ ticker: "AAPL", logo_url: null }] },
        meta: {
          catalog_release_id: "release-1",
          generated_at: null,
          query: "apple",
          total_count: 1,
          returned_count: 1,
          next_cursor: null,
          has_more: false,
          max_age_seconds: 21_600,
        },
      },
    } as never);
  });

  it("returns the versioned catalog for feature-authorized users", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"catalog-etag"');
    expect(await response.json()).toMatchObject({
      contract_version: "desktop-company-catalog/v2",
      data: { companies: [{ ticker: "AAPL", logo_url: null }] },
    });
    expect(requireDesktopFeatureAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "evidence_research",
    );
  });

  it("returns 304 when the client ETag is current", async () => {
    const response = await GET(request({ "if-none-match": '"catalog-etag"' }));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });
});
