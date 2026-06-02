import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(() => NextResponse.json({ ok: true })),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { proxy, resetProxyRateLimitForTests } from "./proxy";

function request(path: string, headers?: HeadersInit) {
  return new NextRequest(`http://localhost${path}`, { headers });
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

describe("proxy gross-abuse guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProxyRateLimitForTests();
    delete process.env.CHAT_RUN_PROXY_GROSS_ABUSE_PER_MINUTE;
  });

  it("lets normal chat run requests pass through to session middleware", async () => {
    const response = await proxy(
      request("/api/chat/run", {
        "cf-connecting-ip": "203.0.113.20",
      }),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });
    expect(updateSession).toHaveBeenCalledOnce();
  });

  it("uses a high-threshold gross-abuse guard with API-shaped errors", async () => {
    process.env.CHAT_RUN_PROXY_GROSS_ABUSE_PER_MINUTE = "2";

    await proxy(request("/api/chat/run", { "x-real-ip": "198.51.100.8" }));
    await proxy(request("/api/chat/run", { "x-real-ip": "198.51.100.8" }));
    const response = await proxy(
      request("/api/chat/run", { "x-real-ip": "198.51.100.8" }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("X-Rate-Limit-Scope")).toBe(
      "proxy-gross-abuse",
    );
    expect(await json(response)).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(updateSession).toHaveBeenCalledTimes(2);
  });

  it("does not rate-limit unrelated routes in proxy", async () => {
    process.env.CHAT_RUN_PROXY_GROSS_ABUSE_PER_MINUTE = "1";

    await proxy(request("/api/companies", { "x-real-ip": "198.51.100.8" }));
    const response = await proxy(
      request("/api/companies", { "x-real-ip": "198.51.100.8" }),
    );

    expect(response.status).toBe(200);
    expect(updateSession).toHaveBeenCalledTimes(2);
  });

  it("adds nonce CSP only to non-API document routes", async () => {
    const pageResponse = await proxy(request("/companies"));

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
    expect(apiOptions?.requestHeaderOverrides).toBeUndefined();
  });
});
