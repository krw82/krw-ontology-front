import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(() => NextResponse.json({ ok: true })),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { proxy } from "./proxy";

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
