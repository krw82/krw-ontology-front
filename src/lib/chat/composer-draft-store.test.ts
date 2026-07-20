import { describe, expect, it } from "vitest";
import {
  buildComposerDraftKey,
  COMPOSER_DRAFT_MAX_ENTRIES,
  COMPOSER_DRAFT_TTL_MS,
  createComposerDraftRecord,
  isComposerDraftRecord,
  pruneComposerDraftRecords,
} from "./composer-draft-store";

describe("composer draft storage helpers", () => {
  it("keys drafts by workspace context without including prompt text", () => {
    const key = buildComposerDraftKey({
      ownerId: "User-42",
      workspace: "guru",
      sessionId: "Session-123",
      ticker: "AAPL",
      runKind: "guru_advisor",
      locale: "ko",
    });

    expect(key).toBe(
      "krw:composer-draft:v1:user-42:guru:session-123:aapl:guru_advisor:ko",
    );
    expect(key).not.toContain("prompt");
  });

  it("expires records after the fixed TTL", () => {
    const now = 1_000;
    const record = createComposerDraftRecord({
      key: buildComposerDraftKey({ ownerId: "user-1", workspace: "chat" }),
      text: "unsent research question",
      urls: [],
      now,
    });

    expect(isComposerDraftRecord(record, now + COMPOSER_DRAFT_TTL_MS - 1)).toBe(
      true,
    );
    expect(isComposerDraftRecord(record, now + COMPOSER_DRAFT_TTL_MS)).toBe(
      false,
    );
  });

  it("keeps only the newest bounded set and removes duplicates", () => {
    const records = Array.from(
      { length: COMPOSER_DRAFT_MAX_ENTRIES + 4 },
      (_, index) =>
        createComposerDraftRecord({
          key: buildComposerDraftKey({
            ownerId: "user-1",
            workspace: "chat",
            sessionId: `session-${index}`,
          }),
          text: `draft-${index}`,
          urls: [],
          now: 10_000 + index,
        }),
    );
    records.push({ ...records.at(-1)!, text: "older duplicate", updatedAt: 1 });

    const pruned = pruneComposerDraftRecords(records, 10_100);

    expect(pruned).toHaveLength(COMPOSER_DRAFT_MAX_ENTRIES);
    expect(pruned[0]?.text).toBe(`draft-${COMPOSER_DRAFT_MAX_ENTRIES + 3}`);
    expect(new Set(pruned.map((record) => record.key)).size).toBe(
      COMPOSER_DRAFT_MAX_ENTRIES,
    );
  });

  it("stores only valid, unique web URLs", () => {
    const record = createComposerDraftRecord({
      key: buildComposerDraftKey({ ownerId: "user-1", workspace: "chat" }),
      text: "draft",
      urls: [
        "https://example.com/article",
        "https://example.com/article",
        "javascript:alert(1)",
        "https://openai.com/",
      ],
      now: 5_000,
    });

    expect(record.urls).toEqual([
      "https://example.com/article",
      "https://openai.com/",
    ]);
  });

  it("isolates otherwise identical draft contexts by owner", () => {
    const context = {
      workspace: "chat",
      ticker: "AAPL",
    };

    expect(
      buildComposerDraftKey({ ...context, ownerId: "user-a" }),
    ).not.toBe(buildComposerDraftKey({ ...context, ownerId: "user-b" }));
  });
});
