import { redirect } from "next/navigation";
import PulseFeed from "@/components/pulse/PulseFeed";
import { getAuthUser } from "@/lib/auth";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import { composePulseFeed, createUnavailablePulseFeed } from "@/lib/pulse/composer";
import {
  createStaticPulseE2EFeed,
  shouldUseStaticPulseE2EFixture,
} from "@/lib/pulse/e2e-fixture";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PulsePage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/pulse");
  if (await shouldUseStaticPulseE2EFixture()) {
    return (
      <div className="bg-canvas text-ink">
        <PulseFeed initialFeed={createStaticPulseE2EFeed()} draftOwnerId={user.id} />
      </div>
    );
  }
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
    <div className="bg-canvas text-ink">
      <PulseFeed initialFeed={initialFeed} draftOwnerId={user.id} />
    </div>
  );
}
