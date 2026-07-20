import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFilingJudgmentDraftKey,
  clearAllFilingJudgmentDrafts,
  clearFilingJudgmentDraft,
  createFilingJudgmentDraftRecord,
  FILING_JUDGMENT_DRAFT_TTL_MS,
  isFilingJudgmentDraftRecord,
  loadFilingJudgmentDraft,
  saveFilingJudgmentDraft,
} from "@/lib/pulse/judgment-draft-store";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("filing judgment draft storage", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isolates the same filing by signed-in owner", () => {
    const filing = "2db39d11-89e0-4de2-96ca-10d899f5b04d";
    expect(
      buildFilingJudgmentDraftKey({ ownerId: "user-a", filingEventId: filing }),
    ).not.toBe(
      buildFilingJudgmentDraftKey({ ownerId: "user-b", filingEventId: filing }),
    );
  });

  it("saves, restores, and clears a valid draft", () => {
    const key = buildFilingJudgmentDraftKey({
      ownerId: "user-a",
      filingEventId: "2db39d11-89e0-4de2-96ca-10d899f5b04d",
    });
    saveFilingJudgmentDraft({
      key,
      impact: "negative",
      summary: "마진 가정과 충돌합니다.",
      reviewDelayDays: 30,
      now: 1_000,
    });

    expect(loadFilingJudgmentDraft(key, 2_000)).toMatchObject({
      impact: "negative",
      summary: "마진 가정과 충돌합니다.",
      reviewDelayDays: 30,
    });
    clearFilingJudgmentDraft(key);
    expect(loadFilingJudgmentDraft(key, 2_000)).toBeNull();
  });

  it("rejects expired or cross-key records and normalizes unsafe fields", () => {
    const key = buildFilingJudgmentDraftKey({
      ownerId: "user-a",
      filingEventId: "2db39d11-89e0-4de2-96ca-10d899f5b04d",
    });
    const record = createFilingJudgmentDraftRecord({
      key,
      impact: "positive",
      summary: "x".repeat(2_000),
      reviewDelayDays: 99,
      now: 1_000,
    });

    expect(record.summary).toHaveLength(1_200);
    expect(record.reviewDelayDays).toBe(7);
    expect(
      isFilingJudgmentDraftRecord(
        record,
        key,
        1_000 + FILING_JUDGMENT_DRAFT_TTL_MS,
      ),
    ).toBe(false);
    expect(isFilingJudgmentDraftRecord(record, `${key}:other`, 2_000)).toBe(
      false,
    );
  });

  it("clears only filing judgment drafts on sign-out", () => {
    const first = buildFilingJudgmentDraftKey({
      ownerId: "user-a",
      filingEventId: "2db39d11-89e0-4de2-96ca-10d899f5b04d",
    });
    const second = buildFilingJudgmentDraftKey({
      ownerId: "user-b",
      filingEventId: "8e874c5e-5891-40a4-b487-d5956f1e18c5",
    });
    storage.setItem(first, "{}");
    storage.setItem(second, "{}");
    storage.setItem("unrelated", "keep");

    clearAllFilingJudgmentDrafts();

    expect(storage.getItem(first)).toBeNull();
    expect(storage.getItem(second)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });
});
