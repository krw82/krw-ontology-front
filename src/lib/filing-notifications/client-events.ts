export const FILING_UNREAD_CHANGED_EVENT = "krwo:filing-unread-changed";
export const FILING_UNREAD_SERVICE_WORKER_MESSAGE =
  "KRWO_FILING_UNREAD_CHANGED";

export function normalizeFilingUnreadCount(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return null;
  }
  return Math.min(value, 999);
}

export function filingUnreadBadgeText(unreadCount: number): string {
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

export function dispatchFilingUnreadChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FILING_UNREAD_CHANGED_EVENT));
}
