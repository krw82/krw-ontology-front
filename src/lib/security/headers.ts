interface SecurityHeaderOptions {
  isDevelopment?: boolean;
  nonce?: string;
  includeContentSecurityPolicy?: boolean;
}

interface SecurityHeader {
  key: string;
  value: string;
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
  nonce,
}: SecurityHeaderOptions = {}) {
  const scriptSources = ["'self'"];
  if (nonce) {
    scriptSources.push(`'nonce-${nonce}'`, "'strict-dynamic'");
  } else if (isDevelopment) {
    scriptSources.push("'unsafe-inline'");
  }
  if (isDevelopment) {
    scriptSources.push("'unsafe-eval'");
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://cdn.brandfetch.io",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSources.join(" ")}`,
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
  nonce,
  includeContentSecurityPolicy = true,
}: SecurityHeaderOptions = {}) {
  const headers: SecurityHeader[] = [];

  if (includeContentSecurityPolicy) {
    headers.push({
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy({ isDevelopment, nonce }),
    });
  }

  headers.push(
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
  );

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
