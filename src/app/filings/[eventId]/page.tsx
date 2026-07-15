import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import FilingDetail from "@/components/filings/FilingDetail";
import { getAuthUser } from "@/lib/auth";
import { shouldPreserveInitialProfile, topNavProfileFromUser } from "@/lib/auth/user-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FilingDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await getAuthUser().catch(() => null);
  const { eventId } = await params;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/filings/${eventId}`)}`);
  return <div className="min-h-[100dvh] bg-canvas text-ink"><TopNav initialUserProfile={topNavProfileFromUser(user)} preserveInitialUserProfile={shouldPreserveInitialProfile(user)} /><main id="main-content" className="mx-auto w-full max-w-3xl px-base py-2xl"><FilingDetail eventId={eventId} /></main></div>;
}
