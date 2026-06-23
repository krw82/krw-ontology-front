import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopFeatureAccess: vi.fn(),
}));
vi.mock("@/lib/desktop/resources/notebook-service", () => ({
  createDesktopNotebookNote: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { createDesktopNotebookNote } from "@/lib/desktop/resources/notebook-service";
import { POST } from "./route";

describe("POST /api/desktop/notebook/companies/:ticker/notes", () => {
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

  it("creates a note with an idempotency key and Desktop provenance", async () => {
    vi.mocked(createDesktopNotebookNote).mockResolvedValue({
      ok: true,
      contract_version: "desktop-notebook-mutation/v1",
      data: { note: { id: "note-1" } },
      meta: {
        generated_at: "2026-06-23T00:00:00.000Z",
        replayed: false,
      },
    } as never);

    const response = await POST(
      new NextRequest(
        "http://localhost/api/desktop/notebook/companies/AAPL/notes",
        {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
            "idempotency-key": "operation-123",
          },
          body: JSON.stringify({
            title: "메모",
            body: "본문",
            local_session_id: "local-session",
          }),
        },
      ),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(201);
    expect(createDesktopNotebookNote).toHaveBeenCalledWith({
      userId: "user-1",
      deviceId: "device-1",
      ticker: "AAPL",
      idempotencyKey: "operation-123",
      body: {
        title: "메모",
        body: "본문",
        local_session_id: "local-session",
      },
    });
  });

  it("returns 200 for an idempotent replay", async () => {
    vi.mocked(createDesktopNotebookNote).mockResolvedValue({
      ok: true,
      contract_version: "desktop-notebook-mutation/v1",
      data: { note: { id: "note-1" } },
      meta: {
        generated_at: "2026-06-23T00:00:00.000Z",
        replayed: true,
      },
    } as never);

    const response = await POST(
      new NextRequest(
        "http://localhost/api/desktop/notebook/companies/AAPL/notes",
        {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
            "idempotency-key": "operation-123",
          },
          body: JSON.stringify({ title: "메모" }),
        },
      ),
      { params: Promise.resolve({ ticker: "AAPL" }) },
    );

    expect(response.status).toBe(200);
  });
});
