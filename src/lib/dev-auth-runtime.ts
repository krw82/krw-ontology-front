import { isLocalDevHost } from "@/lib/dev-auth";

export function isDevAuthBypassEnabledForHost(
  hostname: string | null | undefined,
): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.DEV_AUTH_BYPASS === "1" &&
    isLocalDevHost(hostname)
  );
}
