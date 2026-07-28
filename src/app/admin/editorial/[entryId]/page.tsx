import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import EditorialEntryForm, {
  type EditorialEntryInitialValue,
} from "@/components/editorial/EditorialEntryForm";
import { getAuthUser } from "@/lib/auth";
import { isEditorialAdmin, isLocalEditorialAdminHost } from "@/lib/editorial/access";
import {
  editorialAssetUrl,
  getPulseEditorialEntryForAdmin,
  listPulseEditorialSeries,
} from "@/lib/editorial/repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditorialEntryEditPage({
  params,
}: PageProps<"/admin/editorial/[entryId]">) {
  if (!isLocalEditorialAdminHost((await headers()).get("host"))) notFound();
  const { entryId } = await params;
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect(`/login?next=/admin/editorial/${encodeURIComponent(entryId)}`);
  if (!isEditorialAdmin(user)) redirect("/pulse");

  const admin = getSupabaseAdmin();
  const [entry, seriesOptions] = await Promise.all([
    getPulseEditorialEntryForAdmin(admin, entryId).catch(() => null),
    listPulseEditorialSeries(admin).catch(() => []),
  ]);
  if (!entry) notFound();

  const distribution = entry.pulse_editorial_distributions.find((item) => item.channel === "pulse" && item.status !== "archived") ?? null;
  const initialValue: EditorialEntryInitialValue = {
    id: entry.id,
    seriesId: entry.series_id,
    episodeNumber: entry.episode_number,
    companyVisible: entry.company_visible,
    title: entry.title,
    body: entry.body,
    ticker: entry.ticker,
    format: entry.format,
    status: entry.status === "published" ? "published" : "draft",
    actionLabel: entry.action_label,
    actionHref: entry.action_href,
    publishAt: entry.publish_at,
    assets: entry.pulse_editorial_assets.map((asset) => ({
      id: asset.id,
      src: editorialAssetUrl(asset.id),
      altText: asset.alt_text,
      width: asset.width,
      height: asset.height,
    })),
    distribution: distribution ? {
      id: distribution.id,
      status: distribution.status,
      placement: distribution.placement,
      priority: distribution.priority,
      startsAt: distribution.starts_at,
      endsAt: distribution.ends_at,
    } : null,
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-canvas px-base py-10 text-ink sm:px-xl">
      <Link href="/admin/editorial" className="text-[13px] font-extrabold text-primary hover:underline">← 콘텐츠 목록</Link>
      <header className="mt-lg">
        <p className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Company editorial</p>
        <h1 className="mt-xs text-3xl font-black tracking-[-0.04em]">회사 이야기 편집</h1>
        <p className="mt-xs text-[14px] text-muted">사진 순서·대체 텍스트·회사 페이지·Pulse 노출을 한 곳에서 관리합니다.</p>
      </header>
      <div className="mt-xl"><EditorialEntryForm seriesOptions={seriesOptions} initialValue={initialValue} /></div>
    </main>
  );
}
