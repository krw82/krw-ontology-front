import type {
  SessionSummary,
  PulseFeedResponse,
  WatchlistOverviewResponse,
} from "@/types/api-contracts";
import {
  createPulseDeviceProfile,
  isPulseDeviceProfile,
  type PulseDeviceProfile,
} from "@/lib/pulse/device-ranking";

export const DEVICE_CACHE_DB = "krwo-device-cache";
const DEVICE_CACHE_STORE = "records";
const DEVICE_CACHE_VERSION = 1;
// Coverage was collapsed from `interest | holding` to one active state. A
// schema bump prevents an old account-scoped snapshot from briefly rendering
// the removed label before the server refreshes it.
const DEVICE_CACHE_SCHEMA_VERSION = 2;
const PULSE_SNAPSHOT_VERSION = 3;
const PULSE_PROFILE_RECORD_VERSION = "6";
const MAX_CACHED_COMPANY_BROWSE_CARDS = 3_000;
const MAX_CACHED_PULSE_ITEMS = 50;
const MAX_CACHED_SESSIONS = 50;

type DeviceCacheRecord<T> = {
  key: string;
  schema_version: number;
  owner_id: string | null;
  resource: string;
  version: string;
  stored_at: string;
  value: T;
};

export interface DeviceCompanyBrowseCatalog<TCompany> {
  release_id: string;
  generated_at: string | null;
  locale: string;
  companies: TCompany[];
}

export interface DevicePulseSnapshot {
  version: typeof PULSE_SNAPSHOT_VERSION;
  synchronized_at: string;
  feed: PulseFeedResponse;
}

export interface DeviceCoverageOnboardingSnapshot {
  coverage_activated: boolean;
  synchronized_at: string;
}

export interface DeviceWatchlistSnapshot {
  overview: WatchlistOverviewResponse;
  synchronized_at: string;
}

function isBrowserDatabaseAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function publicKey(resource: string): string {
  return `public:${resource}`;
}

function userKey(ownerId: string, resource: string): string {
  return `user:${ownerId}:${resource}`;
}

/**
 * Public catalog entries are keyed by locale and carry the active release.
 * They may be used only as a local last-known-good view; the server release
 * remains the authoritative version on every connected navigation.
 */
export async function saveDeviceCompanyBrowseCatalog<TCompany>(
  snapshot: DeviceCompanyBrowseCatalog<TCompany>,
): Promise<void> {
  if (!snapshot.release_id || !snapshot.locale) return;
  await writeRecord({
    key: publicKey(`company-browse:${snapshot.locale}`),
    owner_id: null,
    resource: "company-browse",
    version: snapshot.release_id,
    value: {
      ...snapshot,
      companies: snapshot.companies.slice(0, MAX_CACHED_COMPANY_BROWSE_CARDS),
    },
  });
}

export async function readDeviceCompanyBrowseCatalog<TCompany>(
  locale: string,
): Promise<DeviceCompanyBrowseCatalog<TCompany> | null> {
  const record = await readRecord<DeviceCompanyBrowseCatalog<TCompany>>({
    key: publicKey(`company-browse:${locale}`),
    ownerId: null,
    resource: "company-browse",
  });
  if (!record || record.value.locale !== locale || !record.value.release_id) {
    return null;
  }
  return record.value;
}

/**
 * Keep a bounded, account-scoped Pulse snapshot. Analysis cards and active
 * run metadata are deliberately excluded so this cache never contains a
 * complete chat transcript or an in-flight research session.
 */
export function buildDevicePulseSnapshot(
  feed: PulseFeedResponse,
): DevicePulseSnapshot | null {
  const candidateItems = feed.candidate_items
    .filter((item) => item.kind !== "analysis")
    .slice(0, MAX_CACHED_PULSE_ITEMS);
  if (candidateItems.length === 0) return null;
  const retainedItemIds = new Set(candidateItems.map((item) => item.id));
  const itemVersions = Object.fromEntries(
    Object.entries(feed.item_versions).filter(([id]) => retainedItemIds.has(id)),
  );
  return {
    version: PULSE_SNAPSHOT_VERSION,
    synchronized_at: feed.generated_at,
    feed: {
      ...feed,
      // This is deliberately not a server revision: a privacy-filtered local
      // snapshot excludes active analysis cards and must force one delta read
      // before it can be treated as current.
      revision: "device-partial",
      active_analysis_items: [],
      candidate_items: candidateItems,
      item_versions: itemVersions,
      new_item_count: 0,
    },
  };
}

export async function saveDevicePulseSnapshot(
  ownerId: string,
  feed: PulseFeedResponse,
): Promise<void> {
  const snapshot = buildDevicePulseSnapshot(feed);
  if (!snapshot) return;
  await writeRecord({
    key: userKey(ownerId, "pulse"),
    owner_id: ownerId,
    resource: "pulse",
    version: String(PULSE_SNAPSHOT_VERSION),
    value: snapshot,
  });
}

export async function readDevicePulseSnapshot(
  ownerId: string,
): Promise<DevicePulseSnapshot | null> {
  const record = await readRecord<DevicePulseSnapshot>({
    key: userKey(ownerId, "pulse"),
    ownerId,
    resource: "pulse",
    version: String(PULSE_SNAPSHOT_VERSION),
  });
  if (!record || record.value.version !== PULSE_SNAPSHOT_VERSION) return null;
  return record.value;
}

/**
 * Soft Pulse affinity is account-scoped but intentionally never leaves the
 * browser. Losing it only returns the device to the deterministic base order.
 */
export async function saveDevicePulseProfile(
  ownerId: string,
  profile: PulseDeviceProfile,
): Promise<void> {
  await writeRecord({
    key: userKey(ownerId, "pulse-profile"),
    owner_id: ownerId,
    resource: "pulse-profile",
    version: PULSE_PROFILE_RECORD_VERSION,
    value: profile,
  });
}

export async function readDevicePulseProfile(
  ownerId: string,
): Promise<PulseDeviceProfile> {
  const record = await readRecord<PulseDeviceProfile>({
    key: userKey(ownerId, "pulse-profile"),
    ownerId,
    resource: "pulse-profile",
    version: PULSE_PROFILE_RECORD_VERSION,
  });
  return record && isPulseDeviceProfile(record.value)
    ? record.value
    : createPulseDeviceProfile();
}

export async function saveDeviceSessionList(
  ownerId: string,
  sessions: SessionSummary[],
): Promise<void> {
  await writeRecord({
    key: userKey(ownerId, "chat-sessions"),
    owner_id: ownerId,
    resource: "chat-sessions",
    version: "1",
    value: sessions.slice(0, MAX_CACHED_SESSIONS),
  });
}

export async function readDeviceSessionList(
  ownerId: string,
): Promise<SessionSummary[] | null> {
  const record = await readRecord<SessionSummary[]>({
    key: userKey(ownerId, "chat-sessions"),
    ownerId,
    resource: "chat-sessions",
    version: "1",
  });
  return record && Array.isArray(record.value) ? record.value : null;
}

export async function saveDeviceCoverageOnboarding(
  ownerId: string,
  coverageActivated: boolean,
): Promise<void> {
  await writeRecord({
    key: userKey(ownerId, "coverage-onboarding"),
    owner_id: ownerId,
    resource: "coverage-onboarding",
    version: "1",
    value: {
      coverage_activated: coverageActivated,
      synchronized_at: new Date().toISOString(),
    } satisfies DeviceCoverageOnboardingSnapshot,
  });
}

export async function readDeviceCoverageOnboarding(
  ownerId: string,
): Promise<DeviceCoverageOnboardingSnapshot | null> {
  const record = await readRecord<DeviceCoverageOnboardingSnapshot>({
    key: userKey(ownerId, "coverage-onboarding"),
    ownerId,
    resource: "coverage-onboarding",
    version: "1",
  });
  if (!record || typeof record.value.coverage_activated !== "boolean") {
    return null;
  }
  return record.value;
}

export async function saveDeviceWatchlistOverview(
  ownerId: string,
  overview: WatchlistOverviewResponse,
): Promise<void> {
  await writeRecord({
    key: userKey(ownerId, "watchlist-overview"),
    owner_id: ownerId,
    resource: "watchlist-overview",
    version: "1",
    value: {
      overview: {
        ...overview,
        companies: overview.companies.slice(0, 200),
        research_inbox: overview.research_inbox.slice(0, 100),
      },
      synchronized_at: new Date().toISOString(),
    } satisfies DeviceWatchlistSnapshot,
  });
}

export async function readDeviceWatchlistOverview(
  ownerId: string,
): Promise<DeviceWatchlistSnapshot | null> {
  const record = await readRecord<DeviceWatchlistSnapshot>({
    key: userKey(ownerId, "watchlist-overview"),
    ownerId,
    resource: "watchlist-overview",
    version: "1",
  });
  if (!record || !Array.isArray(record.value.overview?.companies)) return null;
  return record.value;
}

/** Clear every local read model when the account signs out. */
export async function clearDeviceCache(): Promise<void> {
  if (!isBrowserDatabaseAvailable()) return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DEVICE_CACHE_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function writeRecord<T>(input: {
  key: string;
  owner_id: string | null;
  resource: string;
  version: string;
  value: T;
}): Promise<void> {
  if (!isBrowserDatabaseAvailable()) return;
  let database: IDBDatabase | null = null;
  try {
    const openedDatabase = await openDatabase();
    database = openedDatabase;
    await new Promise<void>((resolve, reject) => {
      const transaction = openedDatabase.transaction(DEVICE_CACHE_STORE, "readwrite");
      transaction.objectStore(DEVICE_CACHE_STORE).put({
        ...input,
        schema_version: DEVICE_CACHE_SCHEMA_VERSION,
        stored_at: new Date().toISOString(),
      } satisfies DeviceCacheRecord<T>);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // A local read model is strictly optional. Browsers can deny IndexedDB in
    // private browsing or under storage pressure, which must never affect the
    // live server-backed experience.
    return;
  } finally {
    database?.close();
  }
}

async function readRecord<T>(input: {
  key: string;
  ownerId: string | null;
  resource: string;
  version?: string;
}): Promise<DeviceCacheRecord<T> | null> {
  if (!isBrowserDatabaseAvailable()) return null;
  let database: IDBDatabase | null = null;
  try {
    const openedDatabase = await openDatabase();
    database = openedDatabase;
    const record = await new Promise<DeviceCacheRecord<T> | undefined>((resolve, reject) => {
      const transaction = openedDatabase.transaction(DEVICE_CACHE_STORE, "readonly");
      const request = transaction.objectStore(DEVICE_CACHE_STORE).get(input.key);
      request.onsuccess = () => resolve(request.result as DeviceCacheRecord<T> | undefined);
      request.onerror = () => reject(request.error);
    });
    if (
      !record ||
      record.schema_version !== DEVICE_CACHE_SCHEMA_VERSION ||
      record.owner_id !== input.ownerId ||
      record.resource !== input.resource ||
      (input.version != null && record.version !== input.version)
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_CACHE_DB, DEVICE_CACHE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DEVICE_CACHE_STORE)) {
        database.createObjectStore(DEVICE_CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
