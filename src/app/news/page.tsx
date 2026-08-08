import MarketIssuesPage from "@/components/news/MarketIssuesPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewsPage() {
  return (
    <div className="min-h-full bg-canvas text-ink">
      <MarketIssuesPage />
    </div>
  );
}
