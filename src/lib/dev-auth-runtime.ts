import { isLocalDevHost } from "@/lib/dev-auth";

export const E2E_AUTH_HEADER = "x-krw-e2e-auth";
const MIN_E2E_AUTH_TOKEN_LENGTH = 32;

export function isProductionE2ERuntimeConfigured(): boolean {
  const token = process.env.KRW_E2E_AUTH_TOKEN?.trim() ?? "";
  return (
    process.env.NODE_ENV === "production" &&
    process.env.DEV_AUTH_BYPASS === "1" &&
    process.env.KRW_E2E_PRODUCTION_AUTH_BYPASS === "1" &&
    process.env.KRW_E2E_SERVER_BIND === "127.0.0.1" &&
    token.length >= MIN_E2E_AUTH_TOKEN_LENGTH
  );
}

export function isDevAuthBypassEnabledForHost(
  hostname: string | null | undefined,
  requestE2EToken?: string | null,
): boolean {
  const isDevelopmentBypass =
    process.env.NODE_ENV === "development" &&
    process.env.DEV_AUTH_BYPASS === "1";
  const isProductionE2EBypass =
    isProductionE2ERuntimeConfigured() &&
    constantTimeEqual(
      requestE2EToken ?? "",
      process.env.KRW_E2E_AUTH_TOKEN?.trim() ?? "",
    );

  return (
    (isDevelopmentBypass || isProductionE2EBypass) &&
    isLocalDevHost(hostname)
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
