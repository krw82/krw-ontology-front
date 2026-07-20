import type { FilingJudgmentImpact } from "@/types/api-contracts";

const FILING_JUDGMENT_DRAFT_KEY_PREFIX =
  "krw:filing-judgment-draft:v1";
const MAX_SUMMARY_CHARS = 1_200;
const REVIEW_DELAY_DAYS = new Set([1, 7, 30]);

export const FILING_JUDGMENT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface FilingJudgmentDraftKeyParts {
  ownerId: string;
  filingEventId: string;
}

export interface FilingJudgmentDraftRecord {
  version: 1;
  key: string;
  impact: FilingJudgmentImpact | null;
  summary: string;
  reviewDelayDays: 1 | 7 | 30;
  updatedAt: number;
  expiresAt: number;
}

interface SaveFilingJudgmentDraftInput {
  key: string;
  impact: FilingJudgmentImpact | null;
  summary: string;
  reviewDelayDays: number;
  now?: number;
}

const IMPACTS = new Set<FilingJudgmentImpact>([
  "positive",
  "neutral",
  "negative",
  "unclear",
]);

function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function buildFilingJudgmentDraftKey({
  ownerId,
  filingEventId,
}: FilingJudgmentDraftKeyParts): string {
  return [
    FILING_JUDGMENT_DRAFT_KEY_PREFIX,
    normalizeKeyPart(ownerId),
    normalizeKeyPart(filingEventId),
  ].join(":");
}

export function createFilingJudgmentDraftRecord({
  key,
  impact,
  summary,
  reviewDelayDays,
  now = Date.now(),
}: SaveFilingJudgmentDraftInput): FilingJudgmentDraftRecord {
  return {
    version: 1,
    key,
    impact: impact && IMPACTS.has(impact) ? impact : null,
    summary: summary.slice(0, MAX_SUMMARY_CHARS),
    reviewDelayDays: normalizeReviewDelayDays(reviewDelayDays),
    updatedAt: now,
    expiresAt: now + FILING_JUDGMENT_DRAFT_TTL_MS,
  };
}

export function isFilingJudgmentDraftRecord(
  value: unknown,
  expectedKey: string,
  now = Date.now(),
): value is FilingJudgmentDraftRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FilingJudgmentDraftRecord>;
  return (
    candidate.version === 1 &&
    candidate.key === expectedKey &&
    expectedKey.startsWith(`${FILING_JUDGMENT_DRAFT_KEY_PREFIX}:`) &&
    (candidate.impact === null ||
      (typeof candidate.impact === "string" &&
        IMPACTS.has(candidate.impact as FilingJudgmentImpact))) &&
    typeof candidate.summary === "string" &&
    candidate.summary.length <= MAX_SUMMARY_CHARS &&
    typeof candidate.reviewDelayDays === "number" &&
    REVIEW_DELAY_DAYS.has(candidate.reviewDelayDays) &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt) &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > now
  );
}

export function loadFilingJudgmentDraft(
  key: string,
  now = Date.now(),
): FilingJudgmentDraftRecord | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isFilingJudgmentDraftRecord(parsed, key, now)) return parsed;
    storage.removeItem(key);
  } catch {
    // Corrupt or unavailable storage never blocks the judgment workflow.
  }
  return null;
}

export function saveFilingJudgmentDraft(
  input: SaveFilingJudgmentDraftInput,
): void {
  const storage = getLocalStorage();
  if (!storage) return;
  const record = createFilingJudgmentDraftRecord(input);
  try {
    if (
      record.impact === null &&
      !record.summary.trim() &&
      record.reviewDelayDays === 7
    ) {
      storage.removeItem(record.key);
      return;
    }
    storage.setItem(record.key, JSON.stringify(record));
  } catch {
    // Private browsing and hardened storage policies can reject writes.
  }
}

export function clearFilingJudgmentDraft(key: string): void {
  try {
    getLocalStorage()?.removeItem(key);
  } catch {
    // The saved server judgment is authoritative even if local cleanup fails.
  }
}

export function clearAllFilingJudgmentDrafts(): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${FILING_JUDGMENT_DRAFT_KEY_PREFIX}:`)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Storage cleanup is best-effort during sign-out.
  }
}

function normalizeReviewDelayDays(value: number): 1 | 7 | 30 {
  return value === 1 || value === 30 ? value : 7;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
