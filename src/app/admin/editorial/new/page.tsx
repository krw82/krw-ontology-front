import Link from "next/link";
import { redirect } from "next/navigation";
import EditorialCreateForm from "@/components/editorial/EditorialCreateForm";
import { getAuthUser } from "@/lib/auth";
import { isEditorialAdmin } from "@/lib/editorial/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewEditorialPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/admin/editorial/new");
  if (!isEditorialAdmin(user)) redirect("/pulse");
  return <main className="mx-auto min-h-screen max-w-6xl bg-canvas px-base py-10 text-ink sm:px-xl"><Link href="/admin/editorial" className="text-[13px] font-extrabold text-primary hover:underline">← 콘텐츠 목록</Link><header className="mt-lg"><p className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">New editorial</p><h1 className="mt-xs text-3xl font-black tracking-[-0.04em]">Pulse 콘텐츠 만들기</h1><p className="mt-xs text-[14px] text-muted">이미지는 Storage에, 제목·발행 상태·순서는 DB에 저장됩니다.</p></header><div className="mt-xl"><EditorialCreateForm /></div></main>;
}
