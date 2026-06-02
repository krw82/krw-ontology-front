import { isIP } from "node:net";

const DEFAULT_TRUSTED_CLIENT_IP_HEADER = "x-krw-client-ip";

function getTrustedClientIpHeaderName(): string {
  const configured = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  return configured || DEFAULT_TRUSTED_CLIENT_IP_HEADER;
}

export function getClientIp(headers: Headers): string {
  const rawIp = headers.get(getTrustedClientIpHeaderName())?.trim();
  const clientIp = rawIp?.split(",")[0]?.trim();

  return clientIp && isIP(clientIp) ? clientIp : "unknown";
}
