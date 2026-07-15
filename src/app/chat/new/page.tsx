import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { isEntitlementFeatureEnabled } from "@/lib/billing/feature-access";
import ChatPageClient from "../ChatPageClient";

type NewChatPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function NewChatPage({
  searchParams,
}: NewChatPageProps) {
  const query = await searchParams;
  const user = await getAuthUser().catch(() => null);
  const ticker = firstParam(query.ticker);
  const runKind = firstParam(query.runKind);
  const isFreeWorkspace =
    Boolean(ticker) ||
    runKind === "idea_generation" ||
    runKind === "guru_advisor";

  if (user && !isFreeWorkspace) {
    const entitlement = await getEntitlementStatus(user.id, user.email ?? null);
    if (!isEntitlementFeatureEnabled(entitlement, "wide_research")) {
      redirect("/settings/billing?feature=wide_research");
    }
  }

  return <ChatPageClient />;
}
