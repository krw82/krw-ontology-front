import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import NotificationSettingsCard from "@/components/filings/NotificationSettingsCard";
import { getAuthUser } from "@/lib/auth";
import { shouldPreserveInitialProfile, topNavProfileFromUser } from "@/lib/auth/user-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/settings/notifications");
  return <div className="min-h-[100dvh] bg-canvas text-ink"><TopNav initialUserProfile={topNavProfileFromUser(user)} preserveInitialUserProfile={shouldPreserveInitialProfile(user)} /><main id="main-content" className="mx-auto w-full max-w-2xl px-base py-2xl"><NotificationSettingsCard /></main></div>;
}
