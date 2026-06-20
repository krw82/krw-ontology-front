import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
}));
vi.mock("@/lib/desktop/llm-jobs", () => ({
  finalizeDesktopLlmJob: vi.fn(),
  validateFinalizeDesktopLlmJobInput: vi.fn(),
}));

import { authenticateDesktopRequest } from "@/lib/desktop/auth";
import {
  finalizeDesktopLlmJob,
  validateFinalizeDesktopLlmJobInput,
} from "@/lib/desktop/llm-jobs";
import { POST } from "./route";

describe("POST /api/desktop/llm/jobs/[jobId]/finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: null,
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(validateFinalizeDesktopLlmJobInput).mockReturnValue({
      terminalStatus: "completed",
      inputTokens: 120,
      outputTokens: 30,
      cacheReadInputTokens: 20,
      cacheCreationInputTokens: 0,
      errorCode: null,
    });
    vi.mocked(finalizeDesktopLlmJob).mockResolvedValue({
      ok: true,
      job_id: "job-1",
      status: "completed",
      finalized_at: "2026-06-21T00:10:00.000Z",
      already_finalized: false,
    });
  });

  it("finalizes the authenticated run and disables response caching", async () => {
    const request = new NextRequest(
      "http://localhost/api/desktop/llm/jobs/job-1/finalize",
      {
        method: "POST",
        headers: { authorization: "Bearer desktop-token" },
        body: JSON.stringify({
          terminal_status: "completed",
          input_tokens: 120,
          output_tokens: 30,
        }),
      },
    );
    const response = await POST(request, {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(finalizeDesktopLlmJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", deviceId: "device-1" }),
      "job-1",
      expect.objectContaining({ terminalStatus: "completed" }),
    );
  });
});
