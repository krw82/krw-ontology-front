import { PULSE_LEARNING_ENTRIES } from "@/content/pulse/learning";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import { pulseLearningManifestSchema } from "@/lib/pulse/learning-schema";
import { getEditorialLearningCandidates } from "@/lib/pulse/sources/editorial";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// A browser needs enough active stories to make its device-local choice feel
// varied, while leaving room in the 48-card candidate reservoir for filings.
// The device selects at most one early company story. Retain alternatives for
// rotation, but do not let them crowd out the general feed reservoir.
const MAX_EARLY_EDITORIAL_CANDIDATES = 8;
const MAX_PERSONAL_EARLY_EDITORIAL_CANDIDATES = 3;
const MAX_PRIORITY_EARLY_EDITORIAL_CANDIDATES = 3;
const MAX_EXPLORATION_EARLY_EDITORIAL_CANDIDATES = 2;

type EarlyEditorialCandidateRole = "personal" | "editorial" | "explore";

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
      coverage_level: null,
      judgment: null,
      linked_thesis: null,
      eyebrow: entry.kind === "checklist" ? "이번 주 체크리스트" : "3분 공시 습관",
      title: entry.title,
      body: entry.body,
      reason_code: "weekly_learning",
      reason_label: "매주 한 번, 공시를 읽는 기준을 정리해드립니다.",
      priority: "low",
      occurred_at: now.toISOString(),
      available_at: entry.active_from,
      expires_at: entry.active_until,
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

/** Prefer published database content, retaining static entries as a safe fallback. */
export async function getLearningCandidates(
  supabase: SupabaseClient<Database>,
  now: Date,
): Promise<PulseCandidate[]> {
  try {
    const editorial = await getEditorialLearningCandidates(supabase, now);
    return editorial.length > 0 ? editorial : buildLearningCandidates(now);
  } catch (error) {
    // Editorial is an optional shared source. A transient cache or database
    // failure must not remove the established static learning card.
    console.warn("[pulse] editorial learning source unavailable", {
      error_code: typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "unknown",
    });
    return buildLearningCandidates(now);
  }
}

export function selectLearningCandidate(
  candidates: PulseCandidate[],
  userId: string,
  now: Date,
): PulseCandidate[] {
  const earlyEditorial = candidates.filter((candidate) =>
    candidate.metadata.editorial_placement === "early");
  if (earlyEditorial.length > 0) {
    return buildEarlyEditorialReservoir(earlyEditorial, userId, now);
  }

  const sorted = [...candidates].sort((left, right) => left.item_key.localeCompare(right.item_key));
  if (sorted.length === 0) return [];
  const weekIndex = Math.floor((Math.floor(now.getTime() / 86_400_000) + 3) / 7);
  return [sorted[stableIndex(`${userId}:${weekIndex}`, sorted.length)]];
}

/**
 * Keep the choice private to the device, but make the server-provided story
 * reservoir account-relevant. This gives the browser meaningful alternatives
 * after a manual refresh without uploading its exposure history.
 */
function buildEarlyEditorialReservoir(
  candidates: PulseCandidate[],
  userId: string,
  now: Date,
): PulseCandidate[] {
  const byEditorialPriority = [...candidates].sort(compareEditorialPriority);
  const selected: PulseCandidate[] = [];
  const selectedKeys = new Set<string>();
  const add = (candidate: PulseCandidate, role: EarlyEditorialCandidateRole) => {
    if (selected.length >= MAX_EARLY_EDITORIAL_CANDIDATES || selectedKeys.has(candidate.item_key)) return;
    selected.push(withEarlyEditorialRole(candidate, role));
    selectedKeys.add(candidate.item_key);
  };

  // A person can have both explicit interest and completed research for the
  // same company. Keep those stories first in the reservoir, but cap them so
  // a broad watchlist cannot turn the feed into a single-topic stream.
  const personal = byEditorialPriority
    .filter(isPersonallyRelevantStory)
    .sort(comparePersonalStory);
  for (const candidate of personal.slice(0, MAX_PERSONAL_EARLY_EDITORIAL_CANDIDATES)) {
    add(candidate, "personal");
  }

  // Editorial priority is still a deliberate publishing control. Reserve
  // enough room for it even when an account has many research signals.
  for (const candidate of byEditorialPriority) {
    if (selected.length >= MAX_PERSONAL_EARLY_EDITORIAL_CANDIDATES + MAX_PRIORITY_EARLY_EDITORIAL_CANDIDATES) break;
    add(candidate, "editorial");
  }

  // Exploration is stable for the account/week, not random on every request.
  // The device may still rotate its chosen story per refresh generation.
  const weekIndex = Math.floor((Math.floor(now.getTime() / 86_400_000) + 3) / 7);
  const exploration = byEditorialPriority
    .filter((candidate) => !selectedKeys.has(candidate.item_key))
    .sort((left, right) => compareStableSeed(
      left.item_key,
      right.item_key,
      `${userId}:${weekIndex}:company-story-exploration`,
    ));
  for (const candidate of exploration.slice(0, MAX_EXPLORATION_EARLY_EDITORIAL_CANDIDATES)) {
    add(candidate, "explore");
  }

  // Small editorial catalogs and cold-start accounts should still get a full
  // authorized reservoir whenever one exists. Remaining cards retain the
  // editorial role rather than being mislabeled as personal or exploratory.
  for (const candidate of byEditorialPriority) {
    add(candidate, "editorial");
  }

  return selected;
}

function isPersonallyRelevantStory(candidate: PulseCandidate): boolean {
  return candidate.coverage_level === "interest"
    || candidate.has_recent_research === true
    || (candidate.research_affinity ?? 0) > 0;
}

function comparePersonalStory(left: PulseCandidate, right: PulseCandidate): number {
  const score = personalStoryScore(right) - personalStoryScore(left);
  return score !== 0 ? score : compareEditorialPriority(left, right);
}

function personalStoryScore(candidate: PulseCandidate): number {
  return Number(candidate.coverage_level === "interest") * 60
    + Number(candidate.has_recent_research === true) * 30
    + Math.min(20, Math.max(0, candidate.research_affinity ?? 0))
    + editorialPriority(candidate);
}

function compareEditorialPriority(left: PulseCandidate, right: PulseCandidate): number {
  const priority = editorialPriority(right) - editorialPriority(left);
  return priority !== 0 ? priority : left.item_key.localeCompare(right.item_key);
}

function withEarlyEditorialRole(
  candidate: PulseCandidate,
  role: EarlyEditorialCandidateRole,
): PulseCandidate {
  return {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      editorial_candidate_role: role,
    },
  };
}

function editorialPriority(candidate: PulseCandidate): number {
  const priority = candidate.metadata.editorial_priority;
  return typeof priority === "number" && Number.isFinite(priority) ? priority : 0;
}

function stableIndex(seed: string, size: number): number {
  if (size <= 1) return 0;
  return stableHash(seed) % size;
}

function compareStableSeed(left: string, right: string, namespace: string): number {
  const leftHash = stableHash(`${namespace}:${left}`);
  const rightHash = stableHash(`${namespace}:${right}`);
  return leftHash - rightHash || left.localeCompare(right);
}

function stableHash(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
