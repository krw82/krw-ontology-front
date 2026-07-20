import { redirect } from "next/navigation";
import NotificationSettingsCard from "@/components/filings/NotificationSettingsCard";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/settings/notifications");
  return (
    <div className="bg-canvas text-ink">
      <main
        id="main-content"
        className="mx-auto w-full max-w-2xl px-base py-2xl"
      >
        <NotificationSettingsCard />
      </main>
    </div>
  );
}
