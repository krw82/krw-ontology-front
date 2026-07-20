import type { PulseFeedResponse } from "@/types/api-contracts";
import { clearDeviceCache } from "@/lib/pwa/device-cache";

export const OFFLINE_READ_MODEL_DB = "krwo-offline-read-model";
export const OFFLINE_READ_MODEL_STORE = "snapshots";
export const OFFLINE_PULSE_SNAPSHOT_KEY = "pulse-public";
const MAX_OFFLINE_FILING_ITEMS = 6;

export interface OfflineFilingSummary {
  ticker: string | null;
  eyebrow: string;
  title: string;
  body: string;
  occurred_at: string;
}

export interface OfflinePulseSnapshot {
  version: 1;
  synchronized_at: string;
  items: OfflineFilingSummary[];
}

export function buildOfflinePulseSnapshot(
  feed: Pick<PulseFeedResponse, "generated_at" | "items">,
): OfflinePulseSnapshot | null {
  const items = feed.items
    .filter((item) => item.kind === "filing")
    .slice(0, MAX_OFFLINE_FILING_ITEMS)
    .map((item) => ({
      ticker: item.ticker?.slice(0, 16) ?? null,
      eyebrow: compactText(item.eyebrow, 80),
      title: compactText(item.title, 180),
      body: compactText(item.body, 320),
      occurred_at: item.occurred_at,
    }))
    .filter((item) => item.title);

  if (items.length === 0) return null;
  return {
    version: 1,
    synchronized_at: feed.generated_at,
    items,
  };
}

export async function saveOfflinePulseSnapshot(
  feed: Pick<PulseFeedResponse, "generated_at" | "items">,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const snapshot = buildOfflinePulseSnapshot(feed);
  if (!snapshot) return;

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      OFFLINE_READ_MODEL_STORE,
      "readwrite",
    );
    transaction.objectStore(OFFLINE_READ_MODEL_STORE).put(
      snapshot,
      OFFLINE_PULSE_SNAPSHOT_KEY,
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

export async function clearOfflineReadModel(): Promise<void> {
  await Promise.all([
    clearDeviceCache(),
    clearPublicPulseReadModel(),
  ]);
}

async function clearPublicPulseReadModel(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(OFFLINE_READ_MODEL_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.slice(0, maxLength);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_READ_MODEL_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OFFLINE_READ_MODEL_STORE)) {
        database.createObjectStore(OFFLINE_READ_MODEL_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
