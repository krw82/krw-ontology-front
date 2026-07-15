import { isIP } from "node:net";

export const TRUSTED_CLIENT_IP_HEADER = "x-krw-client-ip";

type ClientIpEnv = Partial<Record<string, string | undefined>>;

function configuredHeaderName(env: ClientIpEnv): string | null {
  const configured = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  return configured || null;
}

/**
 * The public deployment topology is Caddy -> web. Caddy replaces this header
 * with the remote peer IP before forwarding, so accepting another header here
 * would allow an alternate proxy topology to silently widen the trust boundary.
 */
export function hasTrustedClientIpConfiguration(
  env: ClientIpEnv = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return configuredHeaderName(env) === TRUSTED_CLIENT_IP_HEADER;
}

function getTrustedClientIpHeaderName(env: ClientIpEnv): string | null {
  if (env.NODE_ENV === "production") {
    return hasTrustedClientIpConfiguration(env)
      ? TRUSTED_CLIENT_IP_HEADER
      : null;
  }

  return configuredHeaderName(env) ?? TRUSTED_CLIENT_IP_HEADER;
}

function readTrustedClientIp(
  headers: Headers,
  env: ClientIpEnv,
): string | null {
  const headerName = getTrustedClientIpHeaderName(env);
  if (!headerName) return null;

  const rawIp = headers.get(headerName)?.trim();
  // Caddy emits one address. Reject a forwarded chain or duplicated header
  // rather than selecting one value from attacker-controlled input.
  if (!rawIp || rawIp.includes(",")) return null;

  return isIP(rawIp) ? rawIp : null;
}

export function hasTrustedClientIp(
  headers: Headers,
  env: ClientIpEnv = process.env,
): boolean {
  return readTrustedClientIp(headers, env) !== null;
}

export function getClientIp(
  headers: Headers,
  env: ClientIpEnv = process.env,
): string {
  return readTrustedClientIp(headers, env) ?? "unknown";
}
