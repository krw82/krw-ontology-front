import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security/headers";

const isDevelopment = process.env.NODE_ENV === "development";
const appVersion =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12) ||
  process.env.SOURCE_VERSION?.trim().slice(0, 12) ||
  process.env.npm_package_version ||
  "development";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  output: "standalone",
  ...(process.env.NEXT_DIST_DIR
    ? { distDir: process.env.NEXT_DIST_DIR }
    : {}),
  poweredByHeader: false,
  allowedDevOrigins: isDevelopment ? ["127.0.0.1", "192.168.10.52"] : [],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  async headers() {
    return [
      {
        source: "/offline.html",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          },
          {
            key: "Cache-Control",
            value: "no-cache",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          isDevelopment,
          includeContentSecurityPolicy: false,
        }),
      },
    ];
  },
};

export default nextConfig;
