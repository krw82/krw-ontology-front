import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopFeatureAccess: vi.fn(),
}));
vi.mock("@/lib/desktop/resources/notebook-service", () => ({
  updateDesktopNotebookMark: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { updateDesktopNotebookMark } from "@/lib/desktop/resources/notebook-service";
import { PATCH } from "./route";

describe("PATCH /api/desktop/notebook/companies/:ticker/mark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: null,
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopFeatureAccess).mockResolvedValue({} as never);
    vi.mocked(updateDesktopNotebookMark).mockResolvedValue({
      ok: true,
      contract_version: "desktop-notebook-mutation/v1",
      data: { mark: { version: "version-2" } },
      meta: { generated_at: "2026-06-23T00:00:00.000Z" },
    } as never);
  });

  it("forwards the optimistic concurrency version", async () => {
    const response = await PATCH(
      new NextRequest(
        "http://localhost/api/desktop/notebook/companies/AAPL/mark",
        {
          method: "PATCH",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
            "if-match": '"version-1"',
          },
          body: JSON.stringify({ is_watchlisted: true }),
        },
      ),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(200);
    expect(updateDesktopNotebookMark).toHaveBeenCalledWith({
      userId: "user-1",
      ticker: "AAPL",
      expectedVersion: '"version-1"',
      body: { is_watchlisted: true },
    });
  });
});
