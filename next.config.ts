import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security/headers";

const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
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
        source: "/:path*",
        headers: buildSecurityHeaders({ isDevelopment }),
      },
    ];
  },
};

export default nextConfig;
