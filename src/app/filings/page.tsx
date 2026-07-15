import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import FilingInbox from "@/components/filings/FilingInbox";
import { getAuthUser } from "@/lib/auth";
import { shouldPreserveInitialProfile, topNavProfileFromUser } from "@/lib/auth/user-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FilingsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/filings");
  return <div className="min-h-[100dvh] bg-canvas text-ink"><TopNav initialUserProfile={topNavProfileFromUser(user)} preserveInitialUserProfile={shouldPreserveInitialProfile(user)} /><main id="main-content" className="mx-auto w-full max-w-3xl px-base py-2xl"><div className="mb-xl"><p className="text-xs font-black uppercase tracking-[0.12em] text-primary">SEC filing alerts</p><h1 className="mt-sm text-2xl font-black tracking-[-0.04em] text-ink">새 공시</h1><p className="mt-sm text-sm leading-6 text-muted">추적 중인 기업의 8-K·6-K를 사건 유형과 SEC 제출문서 기준으로 모아봅니다. 자동 분석은 실행하지 않고, 필요할 때만 질문을 시작할 수 있습니다.</p></div><FilingInbox /></main></div>;
}
