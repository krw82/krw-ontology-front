/**
 * A deliberately pseudonymous, first-party identifier for a browser/device.
 * It is used only to keep the local Pulse profile stable on that device; it
 * is never sent as a feed-ranking input or used to join accounts server-side.
 */
export const PULSE_DEVICE_COOKIE_NAME = "krwo_pulse_device";
const PULSE_DEVICE_STORAGE_KEY = "krwo:pulse-device:v1";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function getOrCreatePulseDeviceId(): string | null {
  if (typeof window === "undefined") return null;

  const stored = safeLocalStorageRead();
  const cookie = readCookie(PULSE_DEVICE_COOKIE_NAME);
  const deviceId = isPulseDeviceId(stored)
    ? stored
    : isPulseDeviceId(cookie)
      ? cookie
      : createPulseDeviceId();

  if (!deviceId) return null;
  safeLocalStorageWrite(deviceId);
  writeDeviceCookie(deviceId);
  return deviceId;
}

export function isPulseDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
}

function createPulseDeviceId(): string | null {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  // A modern browser should always have randomUUID. Returning null is safer
  // than emitting a predictable identifier when privacy storage is disabled.
  return null;
}

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const entry of document.cookie.split(";")) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

function writeDeviceCookie(deviceId: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(PULSE_DEVICE_COOKIE_NAME)}=${encodeURIComponent(deviceId)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

function safeLocalStorageRead(): string | null {
  try {
    return window.localStorage.getItem(PULSE_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeLocalStorageWrite(deviceId: string): void {
  try {
    window.localStorage.setItem(PULSE_DEVICE_STORAGE_KEY, deviceId);
  } catch {
    // Cookie storage may still succeed (or neither can be used in a private
    // browsing mode); the ranking then deterministically falls back to base.
  }
}
