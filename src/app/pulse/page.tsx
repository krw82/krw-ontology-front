import { redirect } from "next/navigation";
import PulseFeed from "@/components/pulse/PulseFeed";
import { getAuthUser } from "@/lib/auth";
import { createUnavailablePulseFeed } from "@/lib/pulse/composer";
import {
  createStaticPulseE2EFeed,
  shouldUseStaticPulseE2EFixture,
} from "@/lib/pulse/e2e-fixture";
import {
  isFirstValueEntry,
  parseFirstValueIntent,
} from "@/lib/onboarding/first-value";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PulsePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function stringParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function PulsePage({ searchParams }: PulsePageProps) {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/pulse");
  const query = await searchParams;
  // Old first-value links remain readable, but onboarding previews now live
  // on the dedicated start route instead of altering the everyday feed.
  const firstValueEntry = isFirstValueEntry(stringParam(query.entry));
  const onboardingIntent = parseFirstValueIntent(stringParam(query.intent));

  if (await shouldUseStaticPulseE2EFixture()) {
    return (
      <div className="bg-canvas text-ink">
        <PulseFeed
          initialFeed={createStaticPulseE2EFeed()}
          draftOwnerId={user.id}
          firstValueEntry={firstValueEntry}
          onboardingIntent={onboardingIntent}
        />
      </div>
    );
  }
  return (
    <div className="bg-canvas text-ink">
      <PulseFeed
        initialFeed={createUnavailablePulseFeed()}
        draftOwnerId={user.id}
        loadInitialFeed
        firstValueEntry={firstValueEntry}
        onboardingIntent={onboardingIntent}
      />
    </div>
  );
}
