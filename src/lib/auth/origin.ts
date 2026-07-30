const APP_ORIGIN_ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

const REDIRECT_ORIGIN_ENV_KEYS = [
  "AUTH_REDIRECT_ORIGIN",
  ...APP_ORIGIN_ENV_KEYS,
] as const;

type OriginEnv = Partial<Record<string, string | undefined>>;

export function normalizeRedirectOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getConfiguredAppOrigin(env: OriginEnv = process.env): string | null {
  for (const key of APP_ORIGIN_ENV_KEYS) {
    const configuredOrigin = normalizeRedirectOrigin(env[key]);
    if (configuredOrigin) return configuredOrigin;
  }

  return null;
}

export function getConfiguredRedirectOrigin(
  fallbackOrigin: string,
  env: OriginEnv = process.env,
): string {
  const configuredOrigin = getConfiguredRedirectOriginOrNull(env);
  if (configuredOrigin) return configuredOrigin;
  return fallbackOrigin;
}

export function getConfiguredBillingRedirectOrigin(
  fallbackOrigin: string,
  env: OriginEnv = process.env,
): string | null {
  for (const key of REDIRECT_ORIGIN_ENV_KEYS) {
    const configuredOrigin = normalizeRedirectOrigin(env[key]);
    if (!configuredOrigin) continue;
    if (
      env.NODE_ENV !== "production" ||
      isProductionBillingRedirectOrigin(configuredOrigin)
    ) {
      return configuredOrigin;
    }
  }
  if (env.NODE_ENV !== "production") {
    return normalizeRedirectOrigin(fallbackOrigin);
  }
  return null;
}

function isProductionBillingRedirectOrigin(origin: string): boolean {
  const url = new URL(origin);
  if (url.protocol !== "https:") return false;
  return ![
    "0.0.0.0",
    "127.0.0.1",
    "localhost",
    "[::1]",
    "::1",
  ].includes(url.hostname.toLowerCase());
}

function getConfiguredRedirectOriginOrNull(env: OriginEnv): string | null {
  for (const key of REDIRECT_ORIGIN_ENV_KEYS) {
    const configuredOrigin = normalizeRedirectOrigin(env[key]);
    if (configuredOrigin) return configuredOrigin;
  }

  return null;
}
