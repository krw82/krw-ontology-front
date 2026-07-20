import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { isEditorialAdmin } from "@/lib/editorial/access";
import { listPulseEditorialEntries } from "@/lib/editorial/repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditorialListPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/admin/editorial");
  if (!isEditorialAdmin(user)) redirect("/pulse");
  const entries = await listPulseEditorialEntries(getSupabaseAdmin()).catch(() => []);
  return <main className="mx-auto min-h-screen max-w-5xl bg-canvas px-base py-10 text-ink sm:px-xl"><header className="flex flex-wrap items-end justify-between gap-base"><div><p className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Pulse editorial</p><h1 className="mt-xs text-3xl font-black tracking-[-0.04em]">편집 콘텐츠</h1><p className="mt-xs text-[14px] text-muted">이미지, 캐러셀, 텍스트를 작성하고 Pulse 발행 시간을 관리합니다.</p></div><Link href="/admin/editorial/new" className="inline-flex min-h-11 items-center rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white hover:bg-primary">새 콘텐츠</Link></header><section className="mt-xl overflow-hidden rounded-[18px] border border-hairline bg-white">{entries.length === 0 ? <p className="p-xl text-[14px] text-muted">아직 등록한 콘텐츠가 없습니다.</p> : <ul>{entries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-base border-b border-hairline p-lg last:border-0"><div className="min-w-0"><p className="text-[12px] font-black text-primary">{entry.status === "published" ? "발행" : entry.status === "draft" ? "초안" : "보관"} · {entry.format === "carousel" ? "캐러셀" : entry.format === "single_image" ? "이미지" : "텍스트"}</p><h2 className="mt-1 truncate text-[16px] font-black">{entry.title}</h2><p className="mt-1 text-[12px] text-muted">이미지 {entry.pulse_editorial_assets.length}장 · {entry.publish_at ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.publish_at)) : "발행 일시 미정"}</p></div>{entry.ticker ? <span className="rounded-full bg-primary-fixed px-sm py-xs text-[12px] font-extrabold text-primary">{entry.ticker}</span> : null}</li>)}</ul>}</section></main>;
}
