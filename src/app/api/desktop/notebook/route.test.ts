import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopFeatureAccess: vi.fn(),
}));
vi.mock("@/lib/desktop/resources/notebook-service", () => ({
  getDesktopNotebookOverview: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { getDesktopNotebookOverview } from "@/lib/desktop/resources/notebook-service";
import { GET } from "./route";

describe("GET /api/desktop/notebook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: null,
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopFeatureAccess).mockResolvedValue({} as never);
    vi.mocked(getDesktopNotebookOverview).mockResolvedValue({
      etag: '"notebook-etag"',
      payload: {
        ok: true,
        contract_version: "desktop-notebook/v2",
        data: {
          stats: { total_companies: 1 },
          companies: [{ ticker: "AAPL" }],
          inbox: [],
        },
        meta: { generated_at: "2026-06-23T00:00:00.000Z" },
      },
    } as never);
  });

  it("returns a private versioned notebook resource", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/desktop/notebook", {
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"notebook-etag"');
    expect(response.headers.get("cache-control")).toContain("private");
    expect(await response.json()).toMatchObject({
      contract_version: "desktop-notebook/v2",
      data: { companies: [{ ticker: "AAPL" }] },
    });
    expect(requireDesktopFeatureAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "evidence_research",
    );
  });

  it("returns 304 for a current notebook ETag", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/desktop/notebook", {
        headers: {
          authorization: "Bearer token",
          "if-none-match": '"notebook-etag"',
        },
      }),
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });
});
