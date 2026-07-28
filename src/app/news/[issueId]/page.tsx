import { redirect } from "next/navigation";
import MarketIssueDetail from "@/components/news/MarketIssueDetail";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketIssueDetailPageProps = {
  params: Promise<{ issueId: string }>;
};

export default async function MarketIssueDetailPage({
  params,
}: MarketIssueDetailPageProps) {
  const user = await getAuthUser().catch(() => null);
  const { issueId } = await params;
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/news/${issueId}`)}`);
  }

  return (
    <div className="min-h-full bg-canvas text-ink">
      <MarketIssueDetail issueId={issueId} />
    </div>
  );
}
