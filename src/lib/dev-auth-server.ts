import "server-only";

import { headers } from "next/headers";
import {
  E2E_AUTH_HEADER,
  isDevAuthBypassEnabledForHost,
} from "@/lib/dev-auth-runtime";

export { isDevAuthBypassEnabledForHost };

export async function isDevAuthBypassEnabled(): Promise<boolean> {
  try {
    const headerStore = await headers();
    const host = headerStore.get("host")?.split(":")[0] ?? null;
    return isDevAuthBypassEnabledForHost(
      host,
      headerStore.get(E2E_AUTH_HEADER),
    );
  } catch {
    return false;
  }
}
