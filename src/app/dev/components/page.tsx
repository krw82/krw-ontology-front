import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  E2E_AUTH_HEADER,
  isDevAuthBypassEnabledForHost,
} from "@/lib/dev-auth-runtime";
import DevComponentsGallery from "./DevComponentsGallery";

export const metadata: Metadata = {
  title: "Dev Components",
};

export const dynamic = "force-dynamic";

export default async function DevComponentsPage() {
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get("host");
  let hostname = requestHost;
  if (requestHost) {
    try {
      hostname = new URL(`http://${requestHost}`).hostname;
    } catch {
      hostname = requestHost;
    }
  }

  const canUseE2EFixture = isDevAuthBypassEnabledForHost(
    hostname,
    requestHeaders.get(E2E_AUTH_HEADER),
  );
  if (process.env.NODE_ENV !== "development" && !canUseE2EFixture) {
    notFound();
  }

  return <DevComponentsGallery />;
}
