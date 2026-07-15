import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import PulseSettings from "@/components/pulse/PulseSettings";
import { getAuthUser } from "@/lib/auth";
import { shouldPreserveInitialProfile, topNavProfileFromUser } from "@/lib/auth/user-profile";
import { isPulseFeedEnabled } from "@/lib/pulse/enabled";
import { getPulsePreferences } from "@/lib/pulse/preferences";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PulseSettingsPage() {
  if (!isPulseFeedEnabled()) redirect("/filings");
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/pulse/settings");
  const preferences = await getPulsePreferences(getSupabaseAdmin(), user.id);
  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <TopNav initialUserProfile={topNavProfileFromUser(user)} preserveInitialUserProfile={shouldPreserveInitialProfile(user)} />
      <PulseSettings initialPreferences={preferences} />
    </div>
  );
}
