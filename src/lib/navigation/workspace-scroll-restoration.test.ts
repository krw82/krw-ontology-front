import { describe, expect, it } from "vitest";
import {
  WORKSPACE_SCROLL_MAX_AGE_MS,
  WORKSPACE_SCROLL_MAX_ENTRIES,
  WORKSPACE_SCROLL_STORAGE_PREFIX,
  buildWorkspaceScrollStorageKey,
  parseWorkspaceScrollEntry,
  pruneWorkspaceScrollEntries,
  readWorkspaceScrollEntry,
  readWorkspaceScrollPosition,
  writeWorkspaceScrollPosition,
  writeWorkspaceScrollSnapshot,
  type WorkspaceScrollStorage,
} from "./workspace-scroll-restoration";

class MemoryStorage implements WorkspaceScrollStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("workspace scroll restoration storage", () => {
  it("builds versioned, locale-aware keys for standard workspace routes", () => {
    expect(
      buildWorkspaceScrollStorageKey({
        pathname: "/ko/companies/AAPL/",
        locale: "ko",
      }),
    ).toBe(
      `${WORKSPACE_SCROLL_STORAGE_PREFIX}:ko:companies:%2Fcompanies%2FAAPL`,
    );
    expect(
      buildWorkspaceScrollStorageKey({
        pathname: "/en/companies/AAPL",
        locale: "en",
      }),
    ).toBe(
      `${WORKSPACE_SCROLL_STORAGE_PREFIX}:en:companies:%2Fcompanies%2FAAPL`,
    );
  });

  it.each(["/chat/new", "/discover", "/guru", "/ko/pricing", "/login"])(
    "does not create a key for non-standard route %s",
    (pathname) => {
      expect(
        buildWorkspaceScrollStorageKey({ pathname, locale: "ko" }),
      ).toBeNull();
    },
  );

  it("parses a current scroll position and optional Pulse anchor", () => {
    const now = 10_000;
    expect(
      parseWorkspaceScrollEntry(
        JSON.stringify({
          version: 1,
          y: 420.4,
          savedAt: now - 100,
          anchorId: "pulse-entry-1",
          anchorOffset: -12.7,
        }),
        now,
      ),
    ).toEqual({
      version: 1,
      y: 420,
      savedAt: now - 100,
      anchorId: "pulse-entry-1",
      anchorOffset: -13,
    });
  });

  it.each([
    "not-json",
    JSON.stringify({ version: 2, y: 100, savedAt: 9_000 }),
    JSON.stringify({ version: 1, y: -1, savedAt: 9_000 }),
    JSON.stringify({ version: 1, y: 100, savedAt: 9_000, anchorId: "half" }),
  ])("rejects malformed entry %s", (value) => {
    expect(parseWorkspaceScrollEntry(value, 10_000)).toBeNull();
  });

  it("rejects and clears stale stored values", () => {
    const storage = new MemoryStorage();
    const key = `${WORKSPACE_SCROLL_STORAGE_PREFIX}:ko:pulse:%2Fpulse`;
    const now = WORKSPACE_SCROLL_MAX_AGE_MS + 10_000;
    storage.setItem(
      key,
      JSON.stringify({ version: 1, y: 300, savedAt: 1 }),
    );

    expect(readWorkspaceScrollPosition(storage, key, now)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it("writes bounded positions and a valid anchor snapshot", () => {
    const storage = new MemoryStorage();
    const key = `${WORKSPACE_SCROLL_STORAGE_PREFIX}:ko:pulse:%2Fpulse`;

    expect(writeWorkspaceScrollPosition(storage, key, -20, 1_000)).toBe(true);
    expect(readWorkspaceScrollPosition(storage, key, 1_000)).toBe(0);

    expect(
      writeWorkspaceScrollSnapshot(
        storage,
        key,
        { y: 510.6, anchorId: "entry-2", anchorOffset: 74.4 },
        2_000,
      ),
    ).toBe(true);
    expect(readWorkspaceScrollEntry(storage, key, 2_000)).toMatchObject({
      y: 511,
      anchorId: "entry-2",
      anchorOffset: 74,
    });
    expect(writeWorkspaceScrollPosition(storage, key, Number.NaN)).toBe(false);
  });

  it("bounds workspace entries while preserving unrelated session data", () => {
    const storage = new MemoryStorage();
    const now = 50_000;
    storage.setItem("unrelated", "keep-me");

    for (let index = 0; index < WORKSPACE_SCROLL_MAX_ENTRIES + 6; index += 1) {
      const key = `${WORKSPACE_SCROLL_STORAGE_PREFIX}:ko:companies:${index}`;
      storage.setItem(
        key,
        JSON.stringify({ version: 1, y: index, savedAt: now - index }),
      );
    }

    pruneWorkspaceScrollEntries(storage, now);

    const workspaceKeys = Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    ).filter((key) => key?.startsWith(WORKSPACE_SCROLL_STORAGE_PREFIX));
    expect(workspaceKeys).toHaveLength(WORKSPACE_SCROLL_MAX_ENTRIES);
    expect(storage.getItem("unrelated")).toBe("keep-me");
    expect(
      storage.getItem(
        `${WORKSPACE_SCROLL_STORAGE_PREFIX}:ko:companies:${WORKSPACE_SCROLL_MAX_ENTRIES + 5}`,
      ),
    ).toBeNull();
  });
});
