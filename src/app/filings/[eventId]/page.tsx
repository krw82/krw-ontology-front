import { redirect } from "next/navigation";
import FilingDetail from "@/components/filings/FilingDetail";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FilingDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await getAuthUser().catch(() => null);
  const { eventId } = await params;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/filings/${eventId}`)}`);
  return <div className="bg-canvas text-ink"><main id="main-content" className="mx-auto w-full max-w-3xl px-base py-2xl"><FilingDetail eventId={eventId} /></main></div>;
}
