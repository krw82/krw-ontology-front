import { NextRequest, NextResponse } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(() => NextResponse.json({ ok: true })),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { config, proxy } from "./proxy";

const ORIGINAL_NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

function request(path: string, headers?: HeadersInit) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

function absoluteRequest(url: string, headers?: HeadersInit) {
  return new NextRequest(url, { headers });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function json(response: Response) {
  return response.json() as Promise<{
    error?: { code: string; message: string };
    ok?: boolean;
  }>;
}

function cspDirective(csp: string, name: string) {
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `));
}

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    restoreEnv("NEXT_PUBLIC_SITE_URL", ORIGINAL_NEXT_PUBLIC_SITE_URL);
    restoreEnv("NEXT_PUBLIC_APP_URL", ORIGINAL_NEXT_PUBLIC_APP_URL);
    vi.unstubAllEnvs();
  });

  it("fails closed in production before an invalid client IP reaches a route", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-krw-client-ip");

    const response = await proxy(request("/api/chat/run"));

    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      error: {
        code: "service_unavailable",
        message: "서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("keeps editorial operations local while allowing public editorial assets", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-krw-client-ip");

    const adminResponse = await proxy(request("/admin/editorial"));
    const mutationResponse = await proxy(
      request("/api/editorial/e1b2c3d4-e5f6-4789-abcd-123456789012"),
    );
    const publicAssetResponse = await proxy(
      request("/api/editorial/assets/e1b2c3d4-e5f6-4789-abcd-123456789012", {
        "x-krw-client-ip": "203.0.113.20",
      }),
    );

    expect(adminResponse.status).toBe(404);
    expect(mutationResponse.status).toBe(404);
    expect(adminResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(publicAssetResponse.status).toBe(200);
    expect(updateSession).toHaveBeenCalledOnce();
  });

  it("rejects an external host even while the local app runs in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await proxy(
      absoluteRequest("http://krwontology.example/admin/editorial", {
        host: "krwontology.example",
      }),
    );

    expect(response.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("accepts the Caddy-owned client IP header in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-krw-client-ip");

    const response = await proxy(
      request("/api/chat/run", { "x-krw-client-ip": "203.0.113.20" }),
    );

    expect(response.status).toBe(200);
    expect(updateSession).toHaveBeenCalledOnce();
  });

  it("does not let E2E auth flags weaken the trusted client-IP boundary", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_PRODUCTION_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_SERVER_BIND", "127.0.0.1");
    vi.stubEnv("KRW_E2E_AUTH_TOKEN", "a".repeat(64));
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-krw-client-ip");

    const response = await proxy(request("/sw.js"));

    expect(response.status).toBe(503);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("rejects an alternate trusted-header configuration in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-forwarded-for");

    const response = await proxy(
      request("/api/chat/run", {
        "x-forwarded-for": "203.0.113.20",
        "x-krw-client-ip": "198.51.100.9",
      }),
    );

    expect(response.status).toBe(503);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("does not block the Docker web health check in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-krw-client-ip");

    const response = await proxy(request("/api/healthz"));

    expect(response.status).toBe(200);
    expect(updateSession).toHaveBeenCalledOnce();
  });

  it("always runs the proxy for API requests carrying a prefetch marker", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: "http://localhost/api/chat/run",
        headers: { "next-router-prefetch": "1" },
        nextConfig: {},
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: "http://localhost/chat",
        headers: { "next-router-prefetch": "1" },
        nextConfig: {},
      }),
    ).toBe(false);
  });

  it("redirects document GET requests to the configured canonical origin", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://krwontology.com";

    const response = await proxy(
      absoluteRequest("https://www.krwontology.com/login?next=%2Fchat"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      "https://krwontology.com/login?next=%2Fchat",
    );
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("does not redirect the canonical host when only the internal protocol differs", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://krwontology.com";

    const response = await proxy(
      absoluteRequest("http://web:3000/login?next=%2Fchat", {
        host: "krwontology.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(updateSession).toHaveBeenCalledOnce();
  });

  it("redirects unprefixed public pages to the default Korean locale", async () => {
    const response = await proxy(request("/companies/AAPL?tab=overview"));

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      "http://localhost/ko/companies/AAPL?tab=overview",
    );
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("does not locale-redirect API or app routes", async () => {
    const apiResponse = await proxy(request("/api/companies"));
    const chatResponse = await proxy(request("/chat"));

    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers.get("Location")).toBeNull();
    expect(chatResponse.status).toBe(200);
    expect(chatResponse.headers.get("Location")).toBeNull();
    expect(updateSession).toHaveBeenCalledTimes(2);
  });

  it("forwards the URL locale to document requests", async () => {
    await proxy(request("/en/companies"));

    const pageOptions = vi.mocked(updateSession).mock.calls.at(-1)?.[1];
    expect(pageOptions?.requestHeaderOverrides?.get("x-krw-locale")).toBe("en");
  });

  it("forwards the trusted request pathname and overwrites client input", async () => {
    await proxy(
      request("/en/companies/AAPL?tab=overview", {
        "x-krw-pathname": "/pulse",
      }),
    );

    const pageOptions = vi.mocked(updateSession).mock.calls.at(-1)?.[1];
    expect(pageOptions?.requestHeaderOverrides?.get("x-krw-pathname")).toBe(
      "/en/companies/AAPL",
    );
  });

  it("forwards an explicit locale header for chat run API requests", async () => {
    await proxy(
      request("/api/chat/run", {
        "x-krw-locale": "en",
      }),
    );

    const apiOptions = vi.mocked(updateSession).mock.calls.at(-1)?.[1];
    expect(apiOptions?.requestHeaderOverrides?.get("x-krw-locale")).toBe("en");
  });

  it("uses the referer locale when API requests have no path locale", async () => {
    await proxy(
      request("/api/chat/run", {
        referer: "http://localhost/en/companies/AAPL",
      }),
    );

    const apiOptions = vi.mocked(updateSession).mock.calls.at(-1)?.[1];
    expect(apiOptions?.requestHeaderOverrides?.get("x-krw-locale")).toBe("en");
  });

  it("uses the locale query for app routes without a path locale", async () => {
    await proxy(request("/chat/new?ticker=AAPL&locale=en"));

    const pageOptions = vi.mocked(updateSession).mock.calls.at(-1)?.[1];
    expect(pageOptions?.requestHeaderOverrides?.get("x-krw-locale")).toBe("en");
  });

  it("uses the nested next locale for login redirects", async () => {
    await proxy(
      request("/login?next=%2Fchat%2Fnew%3Fticker%3DAAPL%26locale%3Den"),
    );

    const pageOptions = vi.mocked(updateSession).mock.calls.at(-1)?.[1];
    expect(pageOptions?.requestHeaderOverrides?.get("x-krw-locale")).toBe("en");
  });

  it("lets normal chat run requests pass through to session middleware", async () => {
    const response = await proxy(
      request("/api/chat/run", {
        "x-krw-client-ip": "203.0.113.20",
      }),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });
    expect(updateSession).toHaveBeenCalledOnce();
  });

  it("adds nonce CSP only to non-API document routes", async () => {
    const pageResponse = await proxy(request("/ko/companies"));

    const csp = pageResponse.headers.get("Content-Security-Policy");
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    expect(cspDirective(csp ?? "", "script-src")).not.toContain(
      "'unsafe-inline'",
    );
    const pageOptions = vi.mocked(updateSession).mock.calls.at(-1)?.[1];
    const forwardedCsp = pageOptions?.requestHeaderOverrides?.get(
      "Content-Security-Policy",
    );
    const forwardedNonce = pageOptions?.requestHeaderOverrides?.get("x-nonce");
    expect(forwardedCsp).toBe(csp);
    expect(forwardedNonce).toBeTruthy();

    const apiResponse = await proxy(request("/api/companies"));

    expect(apiResponse.headers.get("Content-Security-Policy")).toBeNull();
    const apiOptions = vi.mocked(updateSession).mock.calls.at(-1)?.[1];
    expect(apiOptions?.requestHeaderOverrides?.get("x-krw-locale")).toBe("ko");
    expect(
      apiOptions?.requestHeaderOverrides?.get("Content-Security-Policy"),
    ).toBeNull();
  });
});
