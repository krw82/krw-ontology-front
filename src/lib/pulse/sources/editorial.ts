import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultLocalizedPath } from "@/i18n/routing";
import {
  editorialAssetUrl,
  getActivePulseEditorialDistributions,
  getPublishedPulseEditorialEntries,
  type PulseEditorialActiveDistribution,
  type PulseEditorialPublishedEntry,
} from "@/lib/editorial/repository";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type { Database } from "@/types/database";

/**
 * Company stories are emitted only from an explicit active Pulse distribution.
 * Legacy standalone entries retain the prior published-entry fallback so a
 * schema rollout never silently removes existing editorial cards.
 */
export async function getEditorialLearningCandidates(
  supabase: SupabaseClient<Database>,
  now: Date,
): Promise<PulseCandidate[]> {
  const distributions = await getActivePulseEditorialDistributions(now);
  if (distributions.length > 0) {
    return distributions.map((distribution) => toDistributionCandidate(supabase, distribution));
  }

  const entries = await getPublishedPulseEditorialEntries();
  return entries
    .filter((entry) => isPublishedAt(entry, now))
    .map((entry) => toLegacyCandidate(supabase, entry));
}

function isPublishedAt(entry: PulseEditorialPublishedEntry, now: Date): boolean {
  if (entry.status !== "published" || !entry.publish_at) return false;
  const publishAt = Date.parse(entry.publish_at);
  const expiresAt = entry.expires_at ? Date.parse(entry.expires_at) : null;
  return Number.isFinite(publishAt)
    && publishAt <= now.getTime()
    && (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > now.getTime()));
}

function toDistributionCandidate(
  supabase: SupabaseClient<Database>,
  distribution: PulseEditorialActiveDistribution,
): PulseCandidate {
  const entry = distribution.pulse_editorial_entries;
  if (!entry || !entry.pulse_editorial_series || !distribution.starts_at) {
    throw new Error("Active editorial distribution is missing its published company episode.");
  }
  const companyHref = companyEditorialHref(entry.ticker);
  const metadata = editorialMetadata(supabase, entry, {
    editorial_distribution_id: distribution.id,
    editorial_placement: distribution.placement,
    editorial_priority: distribution.priority,
    editorial_series_id: entry.pulse_editorial_series.id,
    editorial_series_slug: entry.pulse_editorial_series.slug,
    editorial_episode_number: entry.episode_number,
    company_visible: entry.company_visible,
    source_href: companyHref,
  });

  return {
    item_key: makePulseItemKey("learning", distribution.id),
    kind: "learning",
    trigger: "editorial",
    source_type: "learning",
    source_id: distribution.id,
    ticker: entry.ticker,
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: entry.format === "carousel" ? "회사 이야기" : "회사 콘텐츠",
    title: entry.title,
    body: entry.body,
    reason_code: "company_editorial_distribution",
    reason_label: "관심 있게 보는 회사를 한 장씩 이해할 수 있도록 정리했습니다.",
    priority: "low",
    occurred_at: distribution.starts_at,
    available_at: distribution.starts_at,
    expires_at: distribution.ends_at,
    saved_at: null,
    snoozed_until: null,
    group_key: `company-editorial:${entry.pulse_editorial_series.id}`,
    primary_action: {
      type: "link",
      label: entry.action_label ?? "회사 이야기 보기",
      href: entry.action_href ?? companyHref,
    },
    secondary_actions: [
      { type: "mutation", label: "저장", action: "save" },
      { type: "mutation", label: "숨기기", action: "dismiss" },
    ],
    metadata,
  };
}

function toLegacyCandidate(
  supabase: SupabaseClient<Database>,
  entry: PulseEditorialPublishedEntry,
): PulseCandidate {
  const metadata = editorialMetadata(supabase, entry, {
    editorial_placement: "standard",
    source_href: "/pulse",
  });

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

function editorialMetadata(
  _supabase: SupabaseClient<Database>,
  entry: Pick<PulseEditorialPublishedEntry, "id" | "slug" | "format" | "pulse_editorial_assets">,
  extra: PulseCandidate["metadata"],
): PulseCandidate["metadata"] {
  const assets = [...entry.pulse_editorial_assets]
    .sort((left, right) => left.position - right.position)
    .slice(0, 8);
  const metadata: PulseCandidate["metadata"] = {
    learning_kind: entry.format === "text" ? "text" : entry.format === "carousel" ? "carousel" : "image",
    editorial_format: entry.format,
    editorial_entry_id: entry.id,
    editorial_entry_slug: entry.slug,
    asset_count: assets.length,
    source_label: "KRW.O 회사 이야기",
    ...extra,
  };
  for (const [index, asset] of assets.entries()) {
    const slot = index + 1;
    metadata[`asset_${slot}`] = editorialAssetUrl(asset.id);
    metadata[`asset_alt_${slot}`] = asset.alt_text;
    metadata[`asset_width_${slot}`] = asset.width;
    metadata[`asset_height_${slot}`] = asset.height;
  }
  return metadata;
}

function companyEditorialHref(ticker: string | null): string {
  if (!ticker) return "/pulse";
  return defaultLocalizedPath(`/companies/${encodeURIComponent(ticker)}`);
}
