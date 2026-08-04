import MarketIssueDetail from "@/components/news/MarketIssueDetail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketIssueDetailPageProps = {
  params: Promise<{ issueId: string }>;
};

export default async function MarketIssueDetailPage({
  params,
}: MarketIssueDetailPageProps) {
  const { issueId } = await params;

  return (
    <div className="min-h-full bg-canvas text-ink">
      <MarketIssueDetail issueId={issueId} />
    </div>
  );
}
