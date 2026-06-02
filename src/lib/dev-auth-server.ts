import "server-only";

import { headers } from "next/headers";
import { isDevAuthBypassEnabledForHost } from "@/lib/dev-auth-runtime";

export { isDevAuthBypassEnabledForHost };

export async function isDevAuthBypassEnabled(): Promise<boolean> {
  try {
    const headerStore = await headers();
    const host = headerStore.get("host")?.split(":")[0] ?? null;
    return isDevAuthBypassEnabledForHost(host);
  } catch {
    return false;
  }
}
