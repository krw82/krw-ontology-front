import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  contentSecurityPolicy,
} from "./headers";

function cspDirective(csp: string, name: string) {
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `));
}

describe("security headers", () => {
  it("disables the Next.js powered-by header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sets production browser hardening headers for all routes", async () => {
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("https://*.supabase.co");
    expect(contentSecurityPolicy).toContain("media-src 'self' data: blob:");
    expect(cspDirective(contentSecurityPolicy, "img-src")).toContain(
      "https://cdn.brandfetch.io",
    );
    expect(contentSecurityPolicy).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy).not.toContain("http://localhost:*");
    expect(cspDirective(contentSecurityPolicy, "script-src")).not.toContain(
      "'unsafe-inline'",
    );
    expect(cspDirective(contentSecurityPolicy, "script-src")).not.toContain(
      "'unsafe-eval'",
    );

    const headers = await nextConfig.headers?.();

    expect(headers).toEqual([
      {
        source: "/:path*",
        headers: [
          ...buildSecurityHeaders({
            includeContentSecurityPolicy: false,
          }),
        ],
      },
    ]);
  });

  it("uses nonce based script CSP when a request nonce is available", () => {
    const nonce = "test-nonce";
    const csp = buildContentSecurityPolicy({ nonce });

    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(cspDirective(csp, "script-src")).not.toContain("'unsafe-inline'");
    expect(cspDirective(csp, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("allows local Supabase and dev websocket connections only in development", () => {
    const developmentCsp = buildContentSecurityPolicy({
      isDevelopment: true,
    });
    const developmentNonceCsp = buildContentSecurityPolicy({
      isDevelopment: true,
      nonce: "dev-nonce",
    });
    const developmentHeaders = buildSecurityHeaders({
      isDevelopment: true,
    });

    expect(developmentCsp).toContain("http://localhost:*");
    expect(developmentCsp).toContain("http://127.0.0.1:*");
    expect(developmentCsp).toContain("ws://localhost:*");
    expect(cspDirective(developmentCsp, "script-src")).toContain(
      "'unsafe-inline'",
    );
    expect(cspDirective(developmentCsp, "script-src")).toContain(
      "'unsafe-eval'",
    );
    expect(developmentNonceCsp).toContain("'nonce-dev-nonce'");
    expect(developmentNonceCsp).toContain("'strict-dynamic'");
    expect(cspDirective(developmentNonceCsp, "script-src")).not.toContain(
      "'unsafe-inline'",
    );
    expect(cspDirective(developmentNonceCsp, "script-src")).toContain(
      "'unsafe-eval'",
    );
    expect(developmentCsp).not.toContain("upgrade-insecure-requests");
    expect(developmentHeaders).not.toContainEqual(
      expect.objectContaining({ key: "Strict-Transport-Security" }),
    );
  });
});
