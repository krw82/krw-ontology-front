import { notFound, redirect } from "next/navigation";
import AdminMarketIssuesConsole from "@/components/news/AdminMarketIssuesConsole";
import { getAuthUser } from "@/lib/auth";
import { isMarketIssueAdmin } from "@/lib/market-issues/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminNewsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/admin/news");
  if (!isMarketIssueAdmin(user)) notFound();
  return <AdminMarketIssuesConsole />;
}
