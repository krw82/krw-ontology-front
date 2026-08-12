import { redirect } from "next/navigation";
import FilingInbox from "@/components/filings/FilingInbox";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FilingsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/filings");
  return <div className="bg-canvas text-ink"><main id="main-content" className="mx-auto w-full max-w-3xl px-base py-2xl"><div className="mb-xl"><p className="text-xs font-black uppercase tracking-[0.12em] text-primary">company updates</p><h1 className="mt-sm text-2xl font-black tracking-[-0.04em] text-ink">관심기업 업데이트</h1><p className="mt-sm text-sm leading-6 text-muted">추적 중인 기업의 8-K·6-K·Form 4와 검증된 시장 이슈를 모아봅니다. 알림은 확인된 자료를 다시 살피는 출발점이며, 투자 판단을 대신하지 않습니다.</p></div><FilingInbox /></main></div>;
}
