import type { PulseSortKey } from "@/lib/pulse/contract";

export interface PulseCursorV1 {
  version: 1;
  offset: number;
  filter: string;
  generated_at: string;
}

export interface PulseCursorV2 {
  version: 2;
  snapshot_at: string;
  filter: "all";
  boundary: Omit<PulseSortKey, "rank_score">;
}

export interface PulseCursorV3 {
  version: 3;
  snapshot_at: string;
  filter: "all";
  ranking_version: "rule_v1";
  boundary: PulseSortKey;
}

export type PulseCursorPayload = PulseCursorV1 | PulseCursorV2 | PulseCursorV3;

export function encodePulseCursor(payload: PulseCursorV3): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Temporary one-release compatibility encoder for the legacy Pulse surface.
 * New v3 callers must always use `encodePulseCursor` above.
 */
export function encodeLegacyPulseCursor(payload: PulseCursorV1): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePulseCursor(
  value: string | null | undefined,
): PulseCursorPayload | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (isPulseCursorV1(parsed)) return parsed as PulseCursorV1;
    if (isEncodedPulseCursorV2(parsed)) return parsed as PulseCursorV2;
    if (isEncodedPulseCursorV3(parsed)) return parsed as PulseCursorV3;
    return null;
  } catch {
    return null;
  }
}

export function isPulseCursorV2(
  value: PulseCursorPayload | null,
): value is PulseCursorV2 {
  return value?.version === 2;
}

export function isPulseCursorV3(
  value: PulseCursorPayload | null,
): value is PulseCursorV3 {
  return value?.version === 3;
}

function isPulseCursorV1(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PulseCursorV1 {
  return (
    value.version === 1 &&
    Number.isInteger(value.offset) &&
    Number(value.offset) >= 0 &&
    typeof value.filter === "string" &&
    isIsoDate(value.generated_at)
  );
}

function isEncodedPulseCursorV2(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PulseCursorV2 {
  if (
    value.version !== 2 ||
    value.filter !== "all" ||
    !isIsoDate(value.snapshot_at) ||
    !isRecord(value.boundary)
  )
    return false;
  const boundary = value.boundary;
  return (
    Number.isInteger(boundary.lane) &&
    Number.isInteger(boundary.priority_rank) &&
    Number.isInteger(boundary.holding_rank) &&
    Number.isInteger(boundary.saved_rank) &&
    isIsoDate(boundary.occurred_at) &&
    typeof boundary.item_key === "string" &&
    boundary.item_key.length > 0 &&
    boundary.item_key.length <= 300
  );
}

function isEncodedPulseCursorV3(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PulseCursorV3 {
  if (
    value.version !== 3
    || value.filter !== "all"
    || value.ranking_version !== "rule_v1"
    || !isIsoDate(value.snapshot_at)
    || !isRecord(value.boundary)
  ) return false;
  const boundary = value.boundary;
  return (
    Number.isInteger(boundary.lane)
    && Number.isInteger(boundary.rank_score)
    && Number.isInteger(boundary.priority_rank)
    && Number.isInteger(boundary.holding_rank)
    && Number.isInteger(boundary.saved_rank)
    && isIsoDate(boundary.occurred_at)
    && typeof boundary.item_key === "string"
    && boundary.item_key.length > 0
    && boundary.item_key.length <= 300
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
