import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopFeatureAccess: vi.fn(),
  DesktopAuthError: class DesktopAuthError extends Error {
    code = "authentication_error";
    publicMessage = "로그인이 필요합니다.";
    status = 401;
    retryable = false;
  },
}));
vi.mock("@/lib/ontology/catalog", () => ({
  searchIndexedCompanies: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { searchIndexedCompanies } from "@/lib/ontology/catalog";
import { GET } from "./route";

function request(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: {
      authorization: "Bearer token",
    },
  });
}

describe("GET /api/desktop/ontology/catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: "user@example.test",
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopFeatureAccess).mockResolvedValue({} as never);
    vi.mocked(searchIndexedCompanies).mockResolvedValue([
      {
        ticker: "AAPL",
        name: "Apple Inc.",
      },
    ] as Awaited<ReturnType<typeof searchIndexedCompanies>>);
  });

  it("searches the bounded Desktop catalog after auth and entitlement checks", async () => {
    const response = await GET(
      request("/api/desktop/ontology/catalog?q=apple&limit=999"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      count: 1,
      companies: [{ ticker: "AAPL" }],
    });
    expect(authenticateDesktopRequest).toHaveBeenCalledTimes(1);
    expect(requireDesktopFeatureAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "evidence_research",
    );
    expect(searchIndexedCompanies).toHaveBeenCalledWith({
      query: "apple",
      limit: 20,
    });
  });
});
