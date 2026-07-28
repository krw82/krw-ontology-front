import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import EditorialCreateForm from "@/components/editorial/EditorialCreateForm";
import { getAuthUser } from "@/lib/auth";
import { isEditorialAdmin, isLocalEditorialAdminHost } from "@/lib/editorial/access";
import { listPulseEditorialSeries } from "@/lib/editorial/repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewEditorialPage() {
  if (!isLocalEditorialAdminHost((await headers()).get("host"))) notFound();
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/admin/editorial/new");
  if (!isEditorialAdmin(user)) redirect("/pulse");
  const seriesOptions = await listPulseEditorialSeries(getSupabaseAdmin()).catch(() => []);
  return <main className="mx-auto min-h-screen max-w-6xl bg-canvas px-base py-10 text-ink sm:px-xl"><Link href="/admin/editorial" className="text-[13px] font-extrabold text-primary hover:underline">← 콘텐츠 목록</Link><header className="mt-lg"><p className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Company editorial</p><h1 className="mt-xs text-3xl font-black tracking-[-0.04em]">회사 이야기 만들기</h1><p className="mt-xs text-[14px] text-muted">이미지는 한 번 Storage에 올리고, 회사 페이지와 Pulse 배포가 같은 에피소드를 참조합니다.</p></header><div className="mt-xl"><EditorialCreateForm seriesOptions={seriesOptions} /></div></main>;
}
