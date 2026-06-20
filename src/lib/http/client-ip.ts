import { isIP } from "node:net";

const DEFAULT_TRUSTED_CLIENT_IP_HEADER = "x-krw-client-ip";

type ClientIpEnv = Partial<Record<string, string | undefined>>;

function getTrustedClientIpHeaderName(env: ClientIpEnv): string | null {
  const configured = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (configured) return configured;
  return env.NODE_ENV === "production" ? null : DEFAULT_TRUSTED_CLIENT_IP_HEADER;
}

export function getClientIp(
  headers: Headers,
  env: ClientIpEnv = process.env,
): string {
  const headerName = getTrustedClientIpHeaderName(env);
  if (!headerName) return "unknown";

  const rawIp = headers.get(headerName)?.trim();
  const clientIp = rawIp?.split(",")[0]?.trim();

  return clientIp && isIP(clientIp) ? clientIp : "unknown";
}
