import "server-only";

import { headers } from "next/headers";

export async function getCspNonce() {
  return (await headers()).get("x-nonce") ?? undefined;
}
