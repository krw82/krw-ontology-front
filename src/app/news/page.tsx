import { redirect } from "next/navigation";
import MarketIssuesPage from "@/components/news/MarketIssuesPage";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/news");

  return (
    <div className="min-h-full bg-canvas text-ink">
      <MarketIssuesPage />
    </div>
  );
}
