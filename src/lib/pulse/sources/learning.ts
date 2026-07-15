import { PULSE_LEARNING_ENTRIES } from "@/content/pulse/learning";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import { pulseLearningManifestSchema } from "@/lib/pulse/learning-schema";

/** Returns all active static entries; weekly rotation follows item-state filtering. */
export function buildLearningCandidates(now: Date): PulseCandidate[] {
  const current = now.getTime();
  const manifest = pulseLearningManifestSchema.parse(PULSE_LEARNING_ENTRIES);
  const activeEntries = manifest
    .filter((entry) => Date.parse(entry.active_from) <= current && Date.parse(entry.active_until) > current);
  if (activeEntries.length === 0) return [];
  return activeEntries
    .map((entry) => ({
      item_key: makePulseItemKey("learning", entry.slug),
      kind: "learning",
      trigger: "editorial",
      source_type: "learning",
      source_id: entry.slug,
      ticker: null,
      eyebrow: entry.kind === "checklist" ? "이번 주 체크리스트" : "3분 공시 습관",
      title: entry.title,
      body: entry.body,
      reason_code: "weekly_learning",
      reason_label: "매주 한 번, 공시를 읽는 기준을 정리해드립니다.",
      priority: "low",
      occurred_at: now.toISOString(),
      available_at: entry.active_from,
      expires_at: entry.active_until,
      read_at: null,
      saved_at: null,
      snoozed_until: null,
      group_key: "weekly-learning",
      primary_action: { type: "link", label: entry.action_label, href: entry.action_href },
      secondary_actions: [
        { type: "mutation", label: "저장", action: "save" },
        { type: "mutation", label: "숨기기", action: "dismiss" },
      ],
      metadata: {
        learning_kind: entry.kind,
        source_label: entry.source_label,
        source_href: entry.source_href,
        panel_1: entry.panels?.[0] ?? null,
        panel_2: entry.panels?.[1] ?? null,
        panel_3: entry.panels?.[2] ?? null,
        panel_4: entry.panels?.[3] ?? null,
      },
    }));
}

export function selectLearningCandidate(
  candidates: PulseCandidate[],
  userId: string,
  now: Date,
): PulseCandidate[] {
  const sorted = [...candidates].sort((left, right) => left.item_key.localeCompare(right.item_key));
  if (sorted.length === 0) return [];
  const weekIndex = Math.floor((Math.floor(now.getTime() / 86_400_000) + 3) / 7);
  return [sorted[stableIndex(`${userId}:${weekIndex}`, sorted.length)]];
}

function stableIndex(seed: string, size: number): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % size;
}
