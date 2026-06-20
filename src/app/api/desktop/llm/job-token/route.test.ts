import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopEntitlement: vi.fn(),
}));
vi.mock("@/lib/desktop/llm-jobs", () => ({
  createDesktopLlmJob: vi.fn(),
  validateCreateDesktopLlmJobInput: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
} from "@/lib/desktop/auth";
import {
  createDesktopLlmJob,
  validateCreateDesktopLlmJobInput,
} from "@/lib/desktop/llm-jobs";
import { POST } from "./route";

describe("POST /api/desktop/llm/job-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: "user@example.test",
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopEntitlement).mockResolvedValue({} as never);
    vi.mocked(validateCreateDesktopLlmJobInput).mockReturnValue({
      localRunId: "run-1",
      localSessionId: "session-1",
      requestedModel: null,
      runtime: "claude-sdk",
      requestedMaxBudgetUsd: null,
      requestedTtlSeconds: null,
    });
    vi.mocked(createDesktopLlmJob).mockResolvedValue({
      ok: true,
      job_id: "job-1",
      token: "job-token",
      expires_at: "2026-06-21T00:10:00.000Z",
      audience: "krw-llm-gateway",
      base_url: "https://app.example.com/llm/anthropic",
      provider: "deepseek",
      model_profile: "deepseek-v4-flash",
      sdk_model: "deepseek-v4-flash",
      upstream_model: "deepseek-v4-flash",
      max_budget_usd: 1,
      limits: {
        max_requests: 128,
        max_input_tokens: null,
        max_output_tokens: null,
      },
    });
  });

  it("authenticates, checks entitlement, and mints a no-store job token", async () => {
    const request = new NextRequest(
      "http://localhost/api/desktop/llm/job-token",
      {
        method: "POST",
        headers: { authorization: "Bearer desktop-token" },
        body: JSON.stringify({
          local_run_id: "run-1",
          local_session_id: "session-1",
          runtime: "claude-sdk",
        }),
      },
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      ok: true,
      token: "job-token",
      sdk_model: "deepseek-v4-flash",
      upstream_model: "deepseek-v4-flash",
    });
    expect(authenticateDesktopRequest).toHaveBeenCalledWith(request);
    expect(requireDesktopEntitlement).toHaveBeenCalled();
    expect(createDesktopLlmJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", deviceId: "device-1" }),
      expect.objectContaining({ localRunId: "run-1" }),
    );
  });
});
