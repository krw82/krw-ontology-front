interface SecurityHeaderOptions {
  isDevelopment?: boolean;
}

const productionConnectSources = [
  "'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
];

const developmentConnectSources = [
  ...productionConnectSources,
  "http://localhost:*",
  "http://127.0.0.1:*",
  "ws://localhost:*",
  "ws://127.0.0.1:*",
];

export function buildContentSecurityPolicy({
  isDevelopment = false,
}: SecurityHeaderOptions = {}) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `connect-src ${
      isDevelopment
        ? developmentConnectSources.join(" ")
        : productionConnectSources.join(" ")
    }`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];

  if (!isDevelopment) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export const contentSecurityPolicy = buildContentSecurityPolicy();

export function buildSecurityHeaders({
  isDevelopment = false,
}: SecurityHeaderOptions = {}) {
  const headers = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy({ isDevelopment }),
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
  ];

  if (!isDevelopment) {
    headers.splice(1, 0, {
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains; preload",
    });
  }

  return headers;
}

export const securityHeaders = buildSecurityHeaders();

export const developmentSecurityHeaders = buildSecurityHeaders({
  isDevelopment: true,
});
