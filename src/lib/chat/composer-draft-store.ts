const COMPOSER_DRAFT_DB_NAME = "krw-ontology-client";
const COMPOSER_DRAFT_DB_VERSION = 1;
const COMPOSER_DRAFT_STORE_NAME = "composer-drafts";
const COMPOSER_DRAFT_SESSION_KEY = "krw:composer-drafts:v1";
const COMPOSER_DRAFT_KEY_PREFIX = "krw:composer-draft:v1";

export const COMPOSER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const COMPOSER_DRAFT_MAX_ENTRIES = 20;

const MAX_STORED_DRAFT_CHARS = 100_000;
const MAX_STORED_URLS = 3;

export interface ComposerDraftKeyParts {
  ownerId: string | null;
  workspace: string;
  sessionId?: string | null;
  ticker?: string | null;
  runKind?: string | null;
  locale?: string | null;
}

export interface ComposerDraftRecord {
  key: string;
  text: string;
  urls: string[];
  updatedAt: number;
  expiresAt: number;
}

interface SaveComposerDraftInput {
  key: string;
  text: string;
  urls: string[];
  now?: number;
}

function normalizeKeyPart(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim().toLowerCase();
  return encodeURIComponent(normalized || fallback);
}

export function buildComposerDraftKey(parts: ComposerDraftKeyParts): string {
  return [
    COMPOSER_DRAFT_KEY_PREFIX,
    normalizeKeyPart(parts.ownerId, "anonymous"),
    normalizeKeyPart(parts.workspace, "chat"),
    normalizeKeyPart(parts.sessionId, "new"),
    normalizeKeyPart(parts.ticker, "global"),
    normalizeKeyPart(parts.runKind, "default"),
    normalizeKeyPart(parts.locale, "ko"),
  ].join(":");
}

const draftMutationQueues = new Map<string, Promise<void>>();

function enqueueDraftMutation(
  key: string,
  mutation: () => Promise<void>,
): Promise<void> {
  const previous = draftMutationQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(mutation);
  draftMutationQueues.set(key, next);
  const cleanup = () => {
    if (draftMutationQueues.get(key) === next) {
      draftMutationQueues.delete(key);
    }
  };
  void next.then(cleanup, cleanup);
  return next;
}

function normalizeStoredUrls(urls: string[]): string[] {
  const unique = new Set<string>();

  for (const value of urls) {
    if (unique.size >= MAX_STORED_URLS) break;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      unique.add(url.href);
    } catch {
      // Invalid or non-web URLs never enter durable composer state.
    }
  }

  return [...unique];
}

export function createComposerDraftRecord({
  key,
  text,
  urls,
  now = Date.now(),
}: SaveComposerDraftInput): ComposerDraftRecord {
  return {
    key,
    text: text.slice(0, MAX_STORED_DRAFT_CHARS),
    urls: normalizeStoredUrls(urls),
    updatedAt: now,
    expiresAt: now + COMPOSER_DRAFT_TTL_MS,
  };
}

export function isComposerDraftRecord(
  value: unknown,
  now = Date.now(),
): value is ComposerDraftRecord {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<ComposerDraftRecord>;
  return (
    typeof candidate.key === "string" &&
    candidate.key.startsWith(`${COMPOSER_DRAFT_KEY_PREFIX}:`) &&
    typeof candidate.text === "string" &&
    candidate.text.length <= MAX_STORED_DRAFT_CHARS &&
    Array.isArray(candidate.urls) &&
    candidate.urls.length <= MAX_STORED_URLS &&
    candidate.urls.every(
      (url) =>
        typeof url === "string" && normalizeStoredUrls([url]).length === 1,
    ) &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt) &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > now
  );
}

export function pruneComposerDraftRecords(
  records: unknown[],
  now = Date.now(),
  maxEntries = COMPOSER_DRAFT_MAX_ENTRIES,
): ComposerDraftRecord[] {
  const safeMaximum = Math.max(0, Math.floor(maxEntries));
  const newestByKey = new Map<string, ComposerDraftRecord>();

  for (const value of records) {
    if (!isComposerDraftRecord(value, now)) continue;
    const current = newestByKey.get(value.key);
    if (!current || value.updatedAt > current.updatedAt) {
      newestByKey.set(value.key, value);
    }
  }

  return [...newestByKey.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, safeMaximum);
}

function hasIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openComposerDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }

    const request = window.indexedDB.open(
      COMPOSER_DRAFT_DB_NAME,
      COMPOSER_DRAFT_DB_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(COMPOSER_DRAFT_STORE_NAME)) {
        database.createObjectStore(COMPOSER_DRAFT_STORE_NAME, {
          keyPath: "key",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed."));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function readFromIndexedDb(
  key: string,
  now: number,
): Promise<ComposerDraftRecord | null> {
  const database = await openComposerDraftDb();
  try {
    const transaction = database.transaction(COMPOSER_DRAFT_STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const result = await requestResult(
      transaction.objectStore(COMPOSER_DRAFT_STORE_NAME).get(key),
    );
    await completion;
    return isComposerDraftRecord(result, now) ? result : null;
  } finally {
    database.close();
  }
}

async function deleteFromIndexedDb(key: string): Promise<void> {
  const database = await openComposerDraftDb();
  try {
    const transaction = database.transaction(COMPOSER_DRAFT_STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    transaction.objectStore(COMPOSER_DRAFT_STORE_NAME).delete(key);
    await completion;
  } finally {
    database.close();
  }
}

async function clearIndexedDbDrafts(): Promise<void> {
  const database = await openComposerDraftDb();
  try {
    const transaction = database.transaction(
      COMPOSER_DRAFT_STORE_NAME,
      "readwrite",
    );
    const completion = transactionComplete(transaction);
    transaction.objectStore(COMPOSER_DRAFT_STORE_NAME).clear();
    await completion;
  } finally {
    database.close();
  }
}

async function writeToIndexedDb(record: ComposerDraftRecord): Promise<void> {
  const database = await openComposerDraftDb();
  try {
    const writeTransaction = database.transaction(
      COMPOSER_DRAFT_STORE_NAME,
      "readwrite",
    );
    const writeCompletion = transactionComplete(writeTransaction);
    writeTransaction.objectStore(COMPOSER_DRAFT_STORE_NAME).put(record);
    await writeCompletion;

    const readTransaction = database.transaction(COMPOSER_DRAFT_STORE_NAME, "readonly");
    const readCompletion = transactionComplete(readTransaction);
    const allRecords = await requestResult(
      readTransaction.objectStore(COMPOSER_DRAFT_STORE_NAME).getAll(),
    );
    await readCompletion;

    const retainedKeys = new Set(
      pruneComposerDraftRecords(allRecords, record.updatedAt).map((item) => item.key),
    );
    const staleKeys = allRecords
      .filter(
        (value): value is ComposerDraftRecord =>
          Boolean(value) &&
          typeof value === "object" &&
          typeof (value as Partial<ComposerDraftRecord>).key === "string",
      )
      .map((value) => value.key)
      .filter((key) => !retainedKeys.has(key));

    if (staleKeys.length > 0) {
      const pruneTransaction = database.transaction(
        COMPOSER_DRAFT_STORE_NAME,
        "readwrite",
      );
      const pruneCompletion = transactionComplete(pruneTransaction);
      const store = pruneTransaction.objectStore(COMPOSER_DRAFT_STORE_NAME);
      staleKeys.forEach((key) => store.delete(key));
      await pruneCompletion;
    }
  } finally {
    database.close();
  }
}

function readSessionRecords(now: number): ComposerDraftRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(COMPOSER_DRAFT_SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return pruneComposerDraftRecords(Array.isArray(parsed) ? parsed : [], now);
  } catch {
    return [];
  }
}

function writeSessionRecords(records: ComposerDraftRecord[], now: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      COMPOSER_DRAFT_SESSION_KEY,
      JSON.stringify(pruneComposerDraftRecords(records, now)),
    );
  } catch {
    // Private browsing and strict storage policies can reject writes.
  }
}

function readFromSessionStorage(key: string, now: number) {
  const records = readSessionRecords(now);
  writeSessionRecords(records, now);
  return records.find((record) => record.key === key) ?? null;
}

function writeToSessionStorage(record: ComposerDraftRecord) {
  const current = readSessionRecords(record.updatedAt).filter(
    (item) => item.key !== record.key,
  );
  writeSessionRecords([record, ...current], record.updatedAt);
}

function deleteFromSessionStorage(key: string) {
  const now = Date.now();
  writeSessionRecords(
    readSessionRecords(now).filter((record) => record.key !== key),
    now,
  );
}

export async function loadComposerDraft(
  key: string,
  now = Date.now(),
): Promise<ComposerDraftRecord | null> {
  try {
    const record = await readFromIndexedDb(key, now);
    if (record) return record;
    await deleteFromIndexedDb(key).catch(() => undefined);
    return readFromSessionStorage(key, now);
  } catch {
    return readFromSessionStorage(key, now);
  }
}

export async function saveComposerDraft({
  key,
  text,
  urls,
  now = Date.now(),
}: SaveComposerDraftInput): Promise<void> {
  const record = createComposerDraftRecord({ key, text, urls, now });
  await enqueueDraftMutation(key, async () => {
    if (!record.text.trim() && record.urls.length === 0) {
      await deleteComposerDraftStorage(key);
      return;
    }

    try {
      await writeToIndexedDb(record);
      deleteFromSessionStorage(key);
    } catch {
      writeToSessionStorage(record);
    }
  });
}

export async function clearComposerDraft(key: string): Promise<void> {
  await enqueueDraftMutation(key, () => deleteComposerDraftStorage(key));
}

async function deleteComposerDraftStorage(key: string): Promise<void> {
  try {
    await deleteFromIndexedDb(key);
  } catch {
    // The session fallback is still cleared below.
  }
  deleteFromSessionStorage(key);
}

export async function clearAllComposerDrafts(): Promise<void> {
  // Let already-started writes finish, then clear them. User-scoped keys keep
  // any later write from a still-unmounting prior account inaccessible to the
  // next account.
  await Promise.allSettled([...draftMutationQueues.values()]);
  try {
    await clearIndexedDbDrafts();
  } catch {
    // IndexedDB can be unavailable or blocked; clear the fallback regardless.
  }
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(COMPOSER_DRAFT_SESSION_KEY);
  } catch {
    // Storage may be unavailable in private or hardened browser modes.
  }
}
