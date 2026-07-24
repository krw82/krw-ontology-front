import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

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
  feed: Pick<PulseFeedResponse, "candidate_items" | "active_analysis_items">,
): PulseItemVersions {
  return Object.fromEntries(
    [...feed.candidate_items, ...feed.active_analysis_items].map((item) => [item.id, pulseItemVersion(item)]),
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
