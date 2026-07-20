import type { Locale } from "@/i18n/config";
import { stripLocalePrefix } from "@/i18n/routing";

export const WORKSPACE_SCROLL_STORAGE_VERSION = 1;
export const WORKSPACE_SCROLL_STORAGE_PREFIX = `krw:workspace-scroll:v${WORKSPACE_SCROLL_STORAGE_VERSION}`;
export const WORKSPACE_SCROLL_MAX_ENTRIES = 24;
export const WORKSPACE_SCROLL_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const MAX_SCROLL_POSITION = 10_000_000;
const MAX_ANCHOR_ID_LENGTH = 200;
const MAX_ANCHOR_OFFSET = 10_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

type WorkspaceRouteFamily =
  | "pulse"
  | "companies"
  | "watchlist"
  | "filings"
  | "institutional-holdings"
  | "settings";

export interface WorkspaceScrollStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkspaceScrollEntry {
  version: typeof WORKSPACE_SCROLL_STORAGE_VERSION;
  y: number;
  savedAt: number;
  anchorId?: string;
  anchorOffset?: number;
}

export interface WorkspaceScrollSnapshot {
  y: number;
  anchorId?: string;
  anchorOffset?: number;
}

function matchesRouteFamily(pathname: string, family: WorkspaceRouteFamily) {
  const route = `/${family}`;
  return pathname === route || pathname.startsWith(`${route}/`);
}

function normalizeWorkspacePathname(pathname: string): string {
  const pathOnly = pathname.split("?", 1)[0] || "/";
  const unlocalizedPathname = stripLocalePrefix(pathOnly);
  if (unlocalizedPathname === "/") return unlocalizedPathname;
  return unlocalizedPathname.replace(/\/+$/, "");
}

export function getWorkspaceScrollRouteFamily(
  pathname: string,
): WorkspaceRouteFamily | null {
  const normalizedPathname = normalizeWorkspacePathname(pathname);
  const families: WorkspaceRouteFamily[] = [
    "pulse",
    "companies",
    "watchlist",
    "filings",
    "institutional-holdings",
    "settings",
  ];

  return (
    families.find((family) => matchesRouteFamily(normalizedPathname, family)) ??
    null
  );
}

export function buildWorkspaceScrollStorageKey({
  pathname,
  locale,
}: {
  pathname: string;
  locale: Locale;
}): string | null {
  const normalizedPathname = normalizeWorkspacePathname(pathname);
  const family = getWorkspaceScrollRouteFamily(normalizedPathname);
  if (!family) return null;

  return `${WORKSPACE_SCROLL_STORAGE_PREFIX}:${locale}:${family}:${encodeURIComponent(normalizedPathname)}`;
}

export function parseWorkspaceScrollEntry(
  rawValue: string | null,
  now = Date.now(),
): WorkspaceScrollEntry | null {
  if (!rawValue) return null;

  try {
    const value = JSON.parse(rawValue) as Partial<WorkspaceScrollEntry>;
    if (
      value.version !== WORKSPACE_SCROLL_STORAGE_VERSION ||
      typeof value.y !== "number" ||
      !Number.isFinite(value.y) ||
      value.y < 0 ||
      value.y > MAX_SCROLL_POSITION ||
      typeof value.savedAt !== "number" ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > now + MAX_FUTURE_CLOCK_SKEW_MS ||
      now - value.savedAt > WORKSPACE_SCROLL_MAX_AGE_MS
    ) {
      return null;
    }

    const hasAnchorId = value.anchorId !== undefined;
    const hasAnchorOffset = value.anchorOffset !== undefined;
    if (hasAnchorId !== hasAnchorOffset) return null;
    if (
      hasAnchorId &&
      (typeof value.anchorId !== "string" ||
        value.anchorId.length === 0 ||
        value.anchorId.length > MAX_ANCHOR_ID_LENGTH ||
        typeof value.anchorOffset !== "number" ||
        !Number.isFinite(value.anchorOffset) ||
        Math.abs(value.anchorOffset) > MAX_ANCHOR_OFFSET)
    ) {
      return null;
    }

    return {
      version: WORKSPACE_SCROLL_STORAGE_VERSION,
      y: Math.round(value.y),
      savedAt: value.savedAt,
      ...(hasAnchorId
        ? {
            anchorId: value.anchorId,
            anchorOffset: Math.round(value.anchorOffset as number),
          }
        : {}),
    };
  } catch {
    return null;
  }
}

export function readWorkspaceScrollPosition(
  storage: WorkspaceScrollStorage,
  key: string,
  now = Date.now(),
): number | null {
  return readWorkspaceScrollEntry(storage, key, now)?.y ?? null;
}

export function readWorkspaceScrollEntry(
  storage: WorkspaceScrollStorage,
  key: string,
  now = Date.now(),
): WorkspaceScrollEntry | null {
  try {
    const rawValue = storage.getItem(key);
    const entry = parseWorkspaceScrollEntry(rawValue, now);
    if (!entry && rawValue !== null) storage.removeItem(key);
    return entry;
  } catch {
    return null;
  }
}

export function writeWorkspaceScrollPosition(
  storage: WorkspaceScrollStorage,
  key: string,
  scrollY: number,
  now = Date.now(),
): boolean {
  return writeWorkspaceScrollSnapshot(storage, key, { y: scrollY }, now);
}

export function writeWorkspaceScrollSnapshot(
  storage: WorkspaceScrollStorage,
  key: string,
  snapshot: WorkspaceScrollSnapshot,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(snapshot.y)) return false;

  const hasAnchor =
    typeof snapshot.anchorId === "string" &&
    snapshot.anchorId.length > 0 &&
    snapshot.anchorId.length <= MAX_ANCHOR_ID_LENGTH &&
    typeof snapshot.anchorOffset === "number" &&
    Number.isFinite(snapshot.anchorOffset) &&
    Math.abs(snapshot.anchorOffset) <= MAX_ANCHOR_OFFSET;

  const entry: WorkspaceScrollEntry = {
    version: WORKSPACE_SCROLL_STORAGE_VERSION,
    y: Math.min(MAX_SCROLL_POSITION, Math.max(0, Math.round(snapshot.y))),
    savedAt: now,
    ...(hasAnchor
      ? {
          anchorId: snapshot.anchorId,
          anchorOffset: Math.round(snapshot.anchorOffset as number),
        }
      : {}),
  };

  try {
    const isNewEntry = storage.getItem(key) === null;
    storage.setItem(key, JSON.stringify(entry));
    if (isNewEntry) pruneWorkspaceScrollEntries(storage, now);
    return true;
  } catch {
    return false;
  }
}

export function pruneWorkspaceScrollEntries(
  storage: WorkspaceScrollStorage,
  now = Date.now(),
  maxEntries = WORKSPACE_SCROLL_MAX_ENTRIES,
): void {
  const candidateKeys: string[] = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${WORKSPACE_SCROLL_STORAGE_PREFIX}:`)) {
        candidateKeys.push(key);
      }
    }

    const validEntries = candidateKeys.flatMap((key) => {
      const entry = parseWorkspaceScrollEntry(storage.getItem(key), now);
      if (!entry) {
        storage.removeItem(key);
        return [];
      }
      return [{ key, savedAt: entry.savedAt }];
    });

    validEntries
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(Math.max(0, maxEntries))
      .forEach(({ key }) => storage.removeItem(key));
  } catch {
    // sessionStorage can be unavailable in private or hardened browser modes.
  }
}
