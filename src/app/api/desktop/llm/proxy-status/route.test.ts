import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopEntitlement: vi.fn(),
}));
vi.mock("@/lib/desktop/llm-models", () => ({
  resolveDesktopLlmModelProfile: vi.fn(() => ({
    provider: "deepseek",
    gatewayBaseUrl: "https://app.example.com/llm/anthropic",
    jobTokenTtlSeconds: 600,
  })),
  availableDesktopLlmModelProfiles: vi.fn(() => [
    {
      model_profile: "deepseek-v4-flash",
      sdk_model: "deepseek-v4-flash",
      upstream_model: "deepseek-v4-flash",
      provider: "deepseek",
    },
  ]),
}));

import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
} from "@/lib/desktop/auth";
import { GET } from "./route";

describe("GET /api/desktop/llm/proxy-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "KRW_LLM_JOB_TOKEN_SECRET",
      "test-secret-that-is-long-enough-for-hmac-validation",
    );
    vi.stubEnv(
      "DESKTOP_LLM_GATEWAY_BASE_URL",
      "https://app.example.com/llm/anthropic",
    );
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: null,
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopEntitlement).mockResolvedValue({} as never);
  });

  it("returns the configured DeepSeek gateway model profile", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/desktop/llm/proxy-status", {
        headers: { authorization: "Bearer desktop-token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ready: true,
      provider: "deepseek",
      job_token_ttl_seconds: 600,
    });
    expect(body.models[0].sdk_model).toBe("deepseek-v4-flash");
    expect(authenticateDesktopRequest).toHaveBeenCalled();
    expect(requireDesktopEntitlement).toHaveBeenCalled();
  });
});
