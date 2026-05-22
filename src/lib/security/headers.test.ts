import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { contentSecurityPolicy, securityHeaders } from "./headers";

describe("security headers", () => {
  it("disables the Next.js powered-by header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sets production browser hardening headers for all routes", async () => {
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("https://*.supabase.co");

    const headers = await nextConfig.headers?.();

    expect(headers).toEqual([
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
    ]);
  });
});
