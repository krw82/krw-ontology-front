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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
      message: "LLM gateway configured",
      gateway_health: null,
      provider: "deepseek",
      job_token_ttl_seconds: 600,
    });
    expect(body.models[0].sdk_model).toBe("deepseek-v4-flash");
    expect(authenticateDesktopRequest).toHaveBeenCalled();
    expect(requireDesktopEntitlement).toHaveBeenCalled();
  });

  it("reports not ready when the job token secret is missing", async () => {
    vi.stubEnv("KRW_LLM_JOB_TOKEN_SECRET", undefined);

    const response = await GET(
      new NextRequest("http://localhost/api/desktop/llm/proxy-status", {
        headers: { authorization: "Bearer desktop-token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ready: false,
      message: "LLM gateway job token secret is not configured",
      gateway_health: null,
      provider: "deepseek",
    });
  });

  it("reports not ready when the job token secret is too short", async () => {
    vi.stubEnv("KRW_LLM_JOB_TOKEN_SECRET", "short");

    const response = await GET(
      new NextRequest("http://localhost/api/desktop/llm/proxy-status", {
        headers: { authorization: "Bearer desktop-token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ready: false,
      message: "LLM gateway job token secret must be at least 32 characters",
      gateway_health: null,
      provider: "deepseek",
    });
  });

  it("probes the configured gateway health URL", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        service: "krw-llm-gateway",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DESKTOP_LLM_GATEWAY_HEALTH_URL", "http://127.0.0.1:8787/healthz");

    const response = await GET(
      new NextRequest("http://localhost/api/desktop/llm/proxy-status", {
        headers: { authorization: "Bearer desktop-token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/healthz",
      expect.objectContaining({
        cache: "no-store",
        headers: { accept: "application/json" },
      }),
    );
    expect(body).toMatchObject({
      ok: true,
      ready: true,
      message: "LLM gateway health check passed",
      gateway_health: {
        url: "http://127.0.0.1:8787/healthz",
        status: 200,
        service: "krw-llm-gateway",
      },
    });
  });

  it("reports not ready when the configured gateway health check fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ok: false, service: "krw-llm-gateway" }, { status: 503 }),
      ),
    );
    vi.stubEnv("DESKTOP_LLM_GATEWAY_HEALTH_URL", "http://127.0.0.1:8787/healthz");

    const response = await GET(
      new NextRequest("http://localhost/api/desktop/llm/proxy-status", {
        headers: { authorization: "Bearer desktop-token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ready: false,
      message: "LLM gateway health check failed",
      gateway_health: {
        status: 503,
        service: "krw-llm-gateway",
      },
    });
  });
});
