export const PWA_BEFORE_UPDATE_EVENT = "krwo:pwa-before-update";
export const PWA_INSTALL_ENGAGEMENT_EVENT = "krwo:pwa-install-engagement";

export const PWA_INSTALL_DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1_000;
export const PWA_RETURN_VISIT_MIN_INTERVAL_MS = 12 * 60 * 60 * 1_000;

export const PWA_INSTALL_STORAGE_KEYS = {
  engagedAt: "krwo:pwa-install:engaged-at:v1",
  dismissedAt: "krwo:pwa-install:dismissed-at:v1",
  installedAt: "krwo:pwa-install:installed-at:v1",
  lastProductVisitAt: "krwo:pwa-install:last-product-visit-at:v1",
  productVisitSession: "krwo:pwa-install:product-visit-session:v1",
} as const;

export type PwaInstallEngagementKind =
  | "analysis_completed"
  | "watch_added"
  | "filing_subscription_created"
  | "research_saved"
  | "return_visit"
  | "install_requested";

export type PwaInstallEngagementDetail = {
  kind: PwaInstallEngagementKind;
  surface?: string;
};

export type DeferredInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

const INSTALL_ENGAGEMENT_KINDS = new Set<PwaInstallEngagementKind>([
  "analysis_completed",
  "watch_added",
  "filing_subscription_created",
  "research_saved",
  "return_visit",
  "install_requested",
]);

const PRODUCT_ROUTE_ROOTS = new Set([
  "app",
  "chat",
  "companies",
  "discover",
  "filings",
  "guru",
  "institutional-holdings",
  "pulse",
  "settings",
  "watchlist",
]);

export function shouldOfferServiceWorkerUpdate(
  worker: ServiceWorker | null | undefined,
  hasActiveController: boolean,
): worker is ServiceWorker {
  return Boolean(worker && hasActiveController && worker.state === "installed");
}

export function shouldReloadForControllerChange({
  hadController,
  alreadyReloaded,
}: {
  hadController: boolean;
  alreadyReloaded: boolean;
}): boolean {
  // A first install can claim an uncontrolled page and emit controllerchange;
  // only a page that already had a controller is crossing app versions.
  return hadController && !alreadyReloaded;
}

export function parseStoredTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function isInstallDismissalCoolingDown({
  dismissedAt,
  now,
  cooldownMs = PWA_INSTALL_DISMISS_COOLDOWN_MS,
}: {
  dismissedAt: number | null;
  now: number;
  cooldownMs?: number;
}): boolean {
  if (dismissedAt === null) return false;
  const elapsed = now - dismissedAt;
  return elapsed < 0 || elapsed < cooldownMs;
}

export function isMeaningfulReturnVisit({
  previousVisitAt,
  now,
  minimumIntervalMs = PWA_RETURN_VISIT_MIN_INTERVAL_MS,
}: {
  previousVisitAt: number | null;
  now: number;
  minimumIntervalMs?: number;
}): boolean {
  if (previousVisitAt === null) return false;
  return now - previousVisitAt >= minimumIntervalMs;
}

export function isPwaProductRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return false;

  const firstSegment = segments[0]?.toLowerCase() ?? "";
  if (PRODUCT_ROUTE_ROOTS.has(firstSegment)) return true;

  const secondSegment = segments[1]?.toLowerCase() ?? "";
  const firstLooksLikeLocale = /^[a-z]{2}(?:-[a-z]{2})?$/.test(firstSegment);
  return firstLooksLikeLocale && PRODUCT_ROUTE_ROOTS.has(secondSegment);
}

export function isAppleMobileBrowser({
  userAgent,
  platform,
  maxTouchPoints,
}: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && (maxTouchPoints ?? 0) > 1)
  );
}

export function isStandalonePwa({
  displayModeStandalone,
  navigatorStandalone,
}: {
  displayModeStandalone: boolean;
  navigatorStandalone?: boolean;
}): boolean {
  return displayModeStandalone || navigatorStandalone === true;
}

export function isDeferredInstallPromptEvent(
  event: Event,
): event is DeferredInstallPromptEvent {
  const candidate = event as Partial<DeferredInstallPromptEvent>;
  return (
    typeof candidate.prompt === "function" &&
    typeof candidate.userChoice?.then === "function"
  );
}

export function isPwaInstallEngagementDetail(
  value: unknown,
): value is PwaInstallEngagementDetail {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PwaInstallEngagementDetail>;
  return (
    typeof candidate.kind === "string" &&
    INSTALL_ENGAGEMENT_KINDS.has(candidate.kind as PwaInstallEngagementKind) &&
    (candidate.surface === undefined || typeof candidate.surface === "string")
  );
}

export function shouldOfferPwaInstall({
  hasDeferredPrompt,
  isAppleMobile,
  isStandalone,
  isInstalled,
  hasEngagement,
  dismissedAt,
  now,
}: {
  hasDeferredPrompt: boolean;
  isAppleMobile: boolean;
  isStandalone: boolean;
  isInstalled: boolean;
  hasEngagement: boolean;
  dismissedAt: number | null;
  now: number;
}): boolean {
  if (isStandalone || isInstalled || !hasEngagement) return false;
  if (
    isInstallDismissalCoolingDown({
      dismissedAt,
      now,
    })
  ) {
    return false;
  }
  return hasDeferredPrompt || isAppleMobile;
}

export function signalPwaInstallEngagement(
  kind: PwaInstallEngagementKind,
  surface?: string,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PwaInstallEngagementDetail>(
      PWA_INSTALL_ENGAGEMENT_EVENT,
      { detail: { kind, ...(surface ? { surface } : {}) } },
    ),
  );
}
