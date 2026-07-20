import type { SupabaseClient } from "@supabase/supabase-js";
import {
  editorialPublicUrl,
  getPublishedPulseEditorialEntries,
  type PulseEditorialPublishedEntry,
} from "@/lib/editorial/repository";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type { Database } from "@/types/database";

/** Published editorial entries replace static learning fixtures when present. */
export async function getEditorialLearningCandidates(
  supabase: SupabaseClient<Database>,
  now: Date,
): Promise<PulseCandidate[]> {
  const entries = await getPublishedPulseEditorialEntries();
  return entries
    .filter((entry) => isPublishedAt(entry, now))
    .map((entry) => toCandidate(supabase, entry));
}

function isPublishedAt(entry: PulseEditorialPublishedEntry, now: Date): boolean {
  if (entry.status !== "published" || !entry.publish_at) return false;
  const publishAt = Date.parse(entry.publish_at);
  const expiresAt = entry.expires_at ? Date.parse(entry.expires_at) : null;
  return Number.isFinite(publishAt)
    && publishAt <= now.getTime()
    && (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > now.getTime()));
}

function toCandidate(
  supabase: SupabaseClient<Database>,
  entry: PulseEditorialPublishedEntry,
): PulseCandidate {
  const assets = [...entry.pulse_editorial_assets]
    .sort((left, right) => left.position - right.position)
    .slice(0, 8);
  const metadata: PulseCandidate["metadata"] = {
    learning_kind: entry.format === "text" ? "text" : entry.format === "carousel" ? "carousel" : "image",
    editorial_format: entry.format,
    asset_count: assets.length,
    source_label: "KRW.O 편집 콘텐츠",
    source_href: "/pulse",
  };
  for (const [index, asset] of assets.entries()) {
    const slot = index + 1;
    metadata[`asset_${slot}`] = editorialPublicUrl(supabase, asset.storage_path);
    metadata[`asset_alt_${slot}`] = asset.alt_text;
  }

  return {
    item_key: makePulseItemKey("learning", entry.slug),
    kind: "learning",
    trigger: "editorial",
    source_type: "learning",
    source_id: entry.id,
    ticker: entry.ticker,
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: entry.format === "carousel" ? "편집 캐러셀" : "편집 콘텐츠",
    title: entry.title,
    body: entry.body,
    reason_code: "editorial_learning",
    reason_label: "KRW.O 편집팀이 발행한 투자 학습 콘텐츠입니다.",
    priority: "low",
    occurred_at: entry.publish_at ?? entry.created_at,
    available_at: entry.publish_at ?? entry.created_at,
    expires_at: entry.expires_at,
    saved_at: null,
    snoozed_until: null,
    group_key: "editorial-learning",
    primary_action: { type: "link", label: entry.action_label ?? "콘텐츠 보기", href: entry.action_href ?? "/pulse" },
    secondary_actions: [
      { type: "mutation", label: "저장", action: "save" },
      { type: "mutation", label: "숨기기", action: "dismiss" },
    ],
    metadata,
  };
}
