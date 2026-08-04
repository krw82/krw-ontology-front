import type {
  PulseFeedDeltaResponse,
  PulseFeedRefreshSummary,
  PulseFeedResponse,
  PulseItem,
} from "@/types/api-contracts";

export type PulseItemVersions = Record<string, string>;

/**
 * The item fingerprint is a rendering/version hint, not an authorization or
 * integrity primitive. It lets the private delta endpoint omit cards the
 * device already has byte-for-byte.
 */
export function pulseItemVersion(item: PulseItem): string {
  return `v1-${fnv1a(stableJson(item)).toString(36)}`;
}

export function buildPulseItemVersions(
  feed: Pick<PulseFeedResponse, "candidate_items" | "active_analysis_items" | "completed_analysis_items">,
): PulseItemVersions {
  return Object.fromEntries(
    [...feed.candidate_items, ...feed.active_analysis_items, ...feed.completed_analysis_items].map((item) => [item.id, pulseItemVersion(item)]),
  );
}

export function isPulseItemVersionMap(value: unknown): value is PulseItemVersions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([id, version]) =>
    id.length > 0
      && id.length <= 512
      && typeof version === "string"
      && /^v1-[0-9a-z]+$/.test(version),
  );
}

/**
 * Derives the account-scoped delta payload from the newly composed feed and
 * the item's versions already persisted on a device. Keeping this outside a
 * route module makes it reusable without exporting unsupported route fields.
 */
export function buildPulseFeedDelta(
  feed: PulseFeedResponse,
  knownItemVersions: Record<string, string>,
): PulseFeedDeltaResponse {
  const currentItems = [...feed.candidate_items, ...feed.active_analysis_items, ...feed.completed_analysis_items];
  const currentIds = new Set(currentItems.map((item) => item.id));
  const knownIds = new Set(Object.keys(knownItemVersions));
  const upserts = currentItems.filter((item) =>
    knownItemVersions[item.id] !== feed.item_versions[item.id]);
  const removedItemIds = Object.keys(knownItemVersions).filter((id) => !currentIds.has(id));
  return {
    generated_at: feed.generated_at,
    revision: feed.revision,
    changed: true,
    snapshot: {
      ranking_version: feed.ranking_version,
      timezone: feed.timezone,
      date_label: feed.date_label,
      filter: feed.filter,
      visible_limit: feed.visible_limit,
      new_item_count: feed.new_item_count,
      source_statuses: feed.source_statuses,
    },
    ordered_candidate_ids: feed.candidate_items.map((item) => item.id),
    active_analysis_item_ids: feed.active_analysis_items.map((item) => item.id),
    completed_analysis_item_ids: feed.completed_analysis_items.map((item) => item.id),
    upserts,
    removed_item_ids: removedItemIds,
    item_versions: feed.item_versions,
    refresh_summary: buildRefreshSummary(feed, knownIds, upserts, removedItemIds),
  };
}

function buildRefreshSummary(
  feed: PulseFeedResponse,
  knownIds: Set<string>,
  upserts: PulseItem[],
  removedItemIds: string[],
): PulseFeedRefreshSummary {
  return {
    // A card that was already in the device snapshot but moved between the
    // active-analysis and candidate lists is an update, not a false "new".
    added_candidate_count: feed.candidate_items.filter((item) => !knownIds.has(item.id)).length,
    updated_item_count: upserts.filter((item) => knownIds.has(item.id)).length,
    removed_item_count: removedItemIds.length,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
