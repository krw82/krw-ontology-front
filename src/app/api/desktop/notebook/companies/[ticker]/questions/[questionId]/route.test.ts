import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopFeatureAccess: vi.fn(),
}));
vi.mock("@/lib/desktop/resources/notebook-service", () => ({
  updateDesktopNotebookQuestion: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { updateDesktopNotebookQuestion } from "@/lib/desktop/resources/notebook-service";
import { PATCH } from "./route";

describe("PATCH /api/desktop/notebook/companies/:ticker/questions/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: null,
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopFeatureAccess).mockResolvedValue({} as never);
    vi.mocked(updateDesktopNotebookQuestion).mockResolvedValue({
      ok: true,
      contract_version: "desktop-notebook-mutation/v1",
      data: { question: { id: "question-1", status: "answered" } },
      meta: { generated_at: "2026-06-23T00:00:00.000Z" },
    } as never);
  });

  it("forwards the question version and mutation", async () => {
    const response = await PATCH(
      new NextRequest(
        "http://localhost/api/desktop/notebook/companies/AAPL/questions/question-1",
        {
          method: "PATCH",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
            "if-match": '"version-1"',
          },
          body: JSON.stringify({ status: "answered" }),
        },
      ),
      {
        params: Promise.resolve({
          ticker: "AAPL",
          questionId: "question-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateDesktopNotebookQuestion).toHaveBeenCalledWith({
      userId: "user-1",
      ticker: "AAPL",
      questionId: "question-1",
      expectedVersion: '"version-1"',
      body: { status: "answered" },
    });
  });
});
