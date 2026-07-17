import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import PulseFeed from "@/components/pulse/PulseFeed";
import { getAuthUser } from "@/lib/auth";
import {
  shouldPreserveInitialProfile,
  topNavProfileFromUser,
} from "@/lib/auth/user-profile";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import { composePulseFeed, createUnavailablePulseFeed } from "@/lib/pulse/composer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PulsePage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/pulse");
  const includeNotebookSources = await canAccessMenuFeature(
    user.id,
    user.email,
    "research_notebook",
  ).catch(() => false);
  const options = {
    supabase: getSupabaseAdmin(),
    userId: user.id,
    includeNotebookSources,
    filter: "all" as const,
  };
  const initialFeed = await composePulseFeed(options).catch((error) => {
    console.warn("[pulse] failed initial feed composition", {
      error_code: typeof error === "object" && error && "code" in error ? String(error.code) : "unknown",
    });
    return createUnavailablePulseFeed();
  });

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <TopNav
        initialUserProfile={topNavProfileFromUser(user)}
        preserveInitialUserProfile={shouldPreserveInitialProfile(user)}
      />
      <PulseFeed initialFeed={initialFeed} />
    </div>
  );
}
