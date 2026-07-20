export const DEVICE_CACHE_OWNER_CHANGED_EVENT = "krwo:device-cache-owner-changed";
const OWNER_DATASET_KEY = "krwDeviceCacheOwner";

export function setDeviceCacheOwner(ownerId: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset[OWNER_DATASET_KEY] = ownerId;
  window.dispatchEvent(new Event(DEVICE_CACHE_OWNER_CHANGED_EVENT));
}

export function clearDeviceCacheOwner(ownerId?: string): void {
  if (typeof document === "undefined") return;
  const current = document.documentElement.dataset[OWNER_DATASET_KEY];
  if (ownerId && current !== ownerId) return;
  delete document.documentElement.dataset[OWNER_DATASET_KEY];
  window.dispatchEvent(new Event(DEVICE_CACHE_OWNER_CHANGED_EVENT));
}

export function getDeviceCacheOwner(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.dataset[OWNER_DATASET_KEY] ?? null;
}
