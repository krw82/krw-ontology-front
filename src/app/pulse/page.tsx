import { redirect } from "next/navigation";
import PulseFeed from "@/components/pulse/PulseFeed";
import { getAuthUser } from "@/lib/auth";
import { createUnavailablePulseFeed } from "@/lib/pulse/composer";
import {
  createStaticPulseE2EFeed,
  shouldUseStaticPulseE2EFixture,
} from "@/lib/pulse/e2e-fixture";

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
  return (
    <div className="bg-canvas text-ink">
      <PulseFeed
        initialFeed={createUnavailablePulseFeed()}
        draftOwnerId={user.id}
        loadInitialFeed
      />
    </div>
  );
}
