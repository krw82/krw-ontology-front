import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  contentSecurityPolicy,
  securityHeaders,
} from "./headers";

describe("security headers", () => {
  it("disables the Next.js powered-by header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sets production browser hardening headers for all routes", async () => {
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("https://*.supabase.co");
    expect(contentSecurityPolicy).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy).not.toContain("http://localhost:*");
    expect(contentSecurityPolicy).not.toContain("'unsafe-eval'");

    const headers = await nextConfig.headers?.();

    expect(headers).toEqual([
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
    ]);
  });

  it("allows local Supabase and dev websocket connections only in development", () => {
    const developmentCsp = buildContentSecurityPolicy({
      isDevelopment: true,
    });
    const developmentHeaders = buildSecurityHeaders({
      isDevelopment: true,
    });

    expect(developmentCsp).toContain("http://localhost:*");
    expect(developmentCsp).toContain("http://127.0.0.1:*");
    expect(developmentCsp).toContain("ws://localhost:*");
    expect(developmentCsp).toContain("'unsafe-eval'");
    expect(developmentCsp).not.toContain("upgrade-insecure-requests");
    expect(developmentHeaders).not.toContainEqual(
      expect.objectContaining({ key: "Strict-Transport-Security" }),
    );
  });
});
