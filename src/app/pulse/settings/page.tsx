import { redirect } from "next/navigation";
import PulseSettings from "@/components/pulse/PulseSettings";
import { getAuthUser } from "@/lib/auth";
import { getPulsePreferences } from "@/lib/pulse/preferences";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PulseSettingsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/pulse/settings");
  const preferences = await getPulsePreferences(getSupabaseAdmin(), user.id);
  return (
    <div className="bg-canvas text-ink">
      <PulseSettings initialPreferences={preferences} />
    </div>
  );
}
