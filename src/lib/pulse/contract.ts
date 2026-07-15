import type {
  PulseAnalysisPhase,
  PulseItem,
  PulseItemBase,
  PulseItemKind,
  PulseItemPriority,
  PulseItemState,
} from "@/types/api-contracts";
import { z } from "zod";

export const PULSE_ITEM_KINDS = [
  "filing",
  "analysis",
  "checkup",
  "question",
  "resurface",
  "learning",
] as const satisfies readonly PulseItemKind[];

export const PULSE_PAGE_SIZE = 20;
export const PULSE_MAX_PAGE_SIZE = 30;

const pulseLinkActionSchema = z.object({
  type: z.literal("link"),
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(2_000),
  analytics_name: z.string().max(80).optional(),
});

const pulseMutationActionSchema = z.object({
  type: z.literal("mutation"),
  label: z.string().min(1).max(80),
  action: z.enum(["review", "unreview", "read", "unread", "save", "unsave", "snooze", "dismiss"]),
  analytics_name: z.string().max(80).optional(),
});

const pulseActionSchema = z.discriminatedUnion("type", [
  pulseLinkActionSchema,
  pulseMutationActionSchema,
]);

const pulseItemBaseSchema = z.object({
  id: z.string().min(1),
  trigger: z.enum(["event", "schedule", "state", "editorial"]),
  source_id: z.string().min(1),
  ticker: z.string().nullable(),
  eyebrow: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  reason_code: z.string().min(1),
  reason_label: z.string().min(1),
  priority: z.enum(["urgent", "high", "normal", "low"]),
  occurred_at: z.iso.datetime(),
  available_at: z.iso.datetime(),
  expires_at: z.iso.datetime().nullable(),
  reviewed_at: z.iso.datetime().nullable(),
  read_at: z.iso.datetime().nullable(),
  saved_at: z.iso.datetime().nullable(),
  snoozed_until: z.iso.datetime().nullable(),
  state: z.enum(["new", "seen", "reviewed"] satisfies readonly PulseItemState[]),
  actionable: z.boolean(),
  phase: z.enum(["active", "completed", "failed"] satisfies readonly PulseAnalysisPhase[]).nullable(),
  group_key: z.string().nullable(),
  primary_action: pulseActionSchema,
  secondary_actions: z.array(pulseActionSchema).max(3),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

function pulseKindSchema<K extends PulseItemKind>(kind: K) {
  return pulseItemBaseSchema.extend({ kind: z.literal(kind), source_type: z.literal(kind) });
}

export const pulseItemSchema = z.discriminatedUnion("kind", [
  pulseKindSchema("filing"),
  pulseKindSchema("analysis"),
  pulseKindSchema("checkup"),
  pulseKindSchema("question"),
  pulseKindSchema("resurface"),
  pulseKindSchema("learning"),
]);

export interface PulseCandidate extends Omit<
  PulseItemBase<PulseItemKind>,
  "id" | "reviewed_at" | "state" | "actionable" | "phase"
> {
  item_key: string;
  reviewed_at?: string | null;
  state?: PulseItemState;
  actionable?: boolean;
  phase?: PulseAnalysisPhase | null;
  is_holding?: boolean;
  is_pinned?: boolean;
}

export interface PulseSortKey {
  lane: number;
  priority_rank: number;
  holding_rank: number;
  saved_rank: number;
  occurred_at: string;
  item_key: string;
}

export interface PulseRankedCandidate extends PulseCandidate, PulseSortKey {
  reviewed_at: string | null;
  state: PulseItemState;
  actionable: boolean;
  phase: PulseAnalysisPhase | null;
}

export const PULSE_PRIORITY_RANK: Record<PulseItemPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function makePulseItemKey(
  kind: PulseItemKind,
  sourceId: string,
): string {
  return `${kind}:${sourceId}`;
}

export function encodePulseItemId(itemKey: string): string {
  return Buffer.from(itemKey, "utf8").toString("base64url");
}

export function decodePulseItemId(itemId: string): string | null {
  try {
    const decoded = Buffer.from(itemId, "base64url").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) return null;
    const kind = decoded.slice(0, separatorIndex);
    if (!PULSE_ITEM_KINDS.includes(kind as PulseItemKind)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Supabase can serialize timestamptz values with an explicit UTC offset
 * (for example, `+00:00`), while the public Pulse contract uses canonical
 * RFC 3339 UTC strings ending in `Z`.
 */
export function normalizePulseDateTime(value: string): string;
export function normalizePulseDateTime(value: string | null): string | null;
export function normalizePulseDateTime(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}
