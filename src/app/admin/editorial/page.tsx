import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { isEditorialAdmin, isLocalEditorialAdminHost } from "@/lib/editorial/access";
import { listPulseEditorialEntries } from "@/lib/editorial/repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditorialListPage() {
  if (!isLocalEditorialAdminHost((await headers()).get("host"))) notFound();
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/admin/editorial");
  if (!isEditorialAdmin(user)) redirect("/pulse");
  const entries = await listPulseEditorialEntries(getSupabaseAdmin()).catch(() => []);
  return <main className="mx-auto min-h-screen max-w-5xl bg-canvas px-base py-10 text-ink sm:px-xl"><header className="flex flex-wrap items-end justify-between gap-base"><div><p className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Company editorial</p><h1 className="mt-xs text-3xl font-black tracking-[-0.04em]">회사 이야기 콘텐츠</h1><p className="mt-xs text-[14px] text-muted">시리즈 원본은 회사 페이지에, 배포 기간과 위치는 Pulse에 따로 관리합니다.</p></div><Link href="/admin/editorial/new" className="inline-flex min-h-11 items-center rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white hover:bg-primary">새 이야기</Link></header><section className="mt-xl overflow-hidden rounded-[18px] border border-hairline bg-white">{entries.length === 0 ? <p className="p-xl text-[14px] text-muted">아직 등록한 콘텐츠가 없습니다.</p> : <ul>{entries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-base border-b border-hairline p-lg last:border-0"><div className="min-w-0"><p className="text-[12px] font-black text-primary">{entry.status === "published" ? "발행" : entry.status === "draft" ? "초안" : "보관"} · {entry.format === "carousel" ? "캐러셀" : entry.format === "single_image" ? "이미지" : "텍스트"}{entry.company_visible ? " · 회사 공개" : ""}</p><h2 className="mt-1 truncate text-[16px] font-black">{entry.title}</h2><p className="mt-1 text-[12px] text-muted">{entry.pulse_editorial_series ? `${entry.pulse_editorial_series.ticker} · ${entry.pulse_editorial_series.title}${entry.episode_number ? ` · 에피소드 ${entry.episode_number}` : ""}` : "단독 편집 콘텐츠"} · 이미지 {entry.pulse_editorial_assets.length}장 · {entry.publish_at ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.publish_at)) : "발행 일시 미정"}</p></div><div className="flex items-center gap-sm">{entry.ticker ? <span className="rounded-full bg-primary-fixed px-sm py-xs text-[12px] font-extrabold text-primary">{entry.ticker}</span> : null}<Link href={`/admin/editorial/${entry.id}`} className="inline-flex min-h-10 items-center rounded-[9px] border border-hairline px-sm text-[12px] font-extrabold text-ink hover:border-ink">편집</Link></div></li>)}</ul>}</section></main>;
}
