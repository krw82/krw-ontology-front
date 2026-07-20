import { describe, expect, it } from "vitest";
import {
  PWA_BEFORE_UPDATE_EVENT,
  PWA_INSTALL_DISMISS_COOLDOWN_MS,
  PWA_INSTALL_ENGAGEMENT_EVENT,
  isAppleMobileBrowser,
  isDeferredInstallPromptEvent,
  isInstallDismissalCoolingDown,
  isMeaningfulReturnVisit,
  isPwaInstallEngagementDetail,
  isPwaProductRoute,
  isStandalonePwa,
  parseStoredTimestamp,
  shouldOfferServiceWorkerUpdate,
  shouldOfferPwaInstall,
  shouldReloadForControllerChange,
} from "./lifecycle";

function workerWithState(state: ServiceWorkerState): ServiceWorker {
  return { state } as ServiceWorker;
}

describe("PWA lifecycle guards", () => {
  it("offers only an installed worker when an older controller exists", () => {
    expect(
      shouldOfferServiceWorkerUpdate(workerWithState("installed"), true, true),
    ).toBe(true);
    expect(
      shouldOfferServiceWorkerUpdate(workerWithState("installing"), true, true),
    ).toBe(false);
    expect(
      shouldOfferServiceWorkerUpdate(workerWithState("installed"), false, true),
    ).toBe(false);
    expect(
      shouldOfferServiceWorkerUpdate(workerWithState("installed"), true, false),
    ).toBe(false);
    expect(shouldOfferServiceWorkerUpdate(null, true, true)).toBe(false);
  });

  it("reloads every previously controlled tab exactly once after activation", () => {
    expect(shouldReloadForControllerChange({ hadController: true, alreadyReloaded: false })).toBe(true);
    expect(shouldReloadForControllerChange({ hadController: false, alreadyReloaded: false })).toBe(false);
    expect(shouldReloadForControllerChange({ hadController: true, alreadyReloaded: true })).toBe(false);
  });

  it("exposes a stable cancelable update-guard event name", () => {
    expect(PWA_BEFORE_UPDATE_EVENT).toBe("krwo:pwa-before-update");
  });
});

describe("PWA install discovery", () => {
  it("keeps the engagement event contract stable", () => {
    expect(PWA_INSTALL_ENGAGEMENT_EVENT).toBe("krwo:pwa-install-engagement");
    expect(
      isPwaInstallEngagementDetail({
        kind: "analysis_completed",
        surface: "chat",
      }),
    ).toBe(true);
    expect(
      isPwaInstallEngagementDetail({ kind: "filing_subscription_created" }),
    ).toBe(true);
    expect(isPwaInstallEngagementDetail({ kind: "page_viewed" })).toBe(false);
    expect(isPwaInstallEngagementDetail(null)).toBe(false);
  });

  it("parses only finite positive storage timestamps", () => {
    expect(parseStoredTimestamp("1234")).toBe(1234);
    expect(parseStoredTimestamp(null)).toBeNull();
    expect(parseStoredTimestamp("0")).toBeNull();
    expect(parseStoredTimestamp("not-a-number")).toBeNull();
    expect(parseStoredTimestamp("Infinity")).toBeNull();
  });

  it("respects the full dismissal cooldown", () => {
    const dismissedAt = 1_000;
    expect(
      isInstallDismissalCoolingDown({
        dismissedAt,
        now: dismissedAt + PWA_INSTALL_DISMISS_COOLDOWN_MS - 1,
      }),
    ).toBe(true);
    expect(
      isInstallDismissalCoolingDown({
        dismissedAt,
        now: dismissedAt + PWA_INSTALL_DISMISS_COOLDOWN_MS,
      }),
    ).toBe(false);
    expect(
      isInstallDismissalCoolingDown({ dismissedAt: 2_000, now: 1_000 }),
    ).toBe(true);
    expect(
      isInstallDismissalCoolingDown({ dismissedAt: null, now: 1_000 }),
    ).toBe(false);
  });

  it("counts a separated product return, not a reload, as engagement", () => {
    expect(
      isMeaningfulReturnVisit({
        previousVisitAt: 1_000,
        now: 2_000,
        minimumIntervalMs: 1_000,
      }),
    ).toBe(true);
    expect(
      isMeaningfulReturnVisit({
        previousVisitAt: 1_000,
        now: 1_999,
        minimumIntervalMs: 1_000,
      }),
    ).toBe(false);
    expect(
      isMeaningfulReturnVisit({
        previousVisitAt: null,
        now: 2_000,
        minimumIntervalMs: 1_000,
      }),
    ).toBe(false);
  });

  it("recognizes product routes without treating marketing pages as value", () => {
    expect(isPwaProductRoute("/pulse")).toBe(true);
    expect(isPwaProductRoute("/ko/companies/AAPL")).toBe(true);
    expect(isPwaProductRoute("/en-US/watchlist")).toBe(true);
    expect(isPwaProductRoute("/pricing")).toBe(false);
    expect(isPwaProductRoute("/ko/privacy")).toBe(false);
    expect(isPwaProductRoute("/")).toBe(false);
  });

  it("detects iOS and touch-based iPadOS without classifying desktop Macs", () => {
    expect(
      isAppleMobileBrowser({ userAgent: "Mozilla/5.0 (iPhone)" }),
    ).toBe(true);
    expect(
      isAppleMobileBrowser({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isAppleMobileBrowser({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });

  it("honors both display-mode and legacy iOS standalone signals", () => {
    expect(
      isStandalonePwa({
        displayModeStandalone: true,
        navigatorStandalone: false,
      }),
    ).toBe(true);
    expect(
      isStandalonePwa({
        displayModeStandalone: false,
        navigatorStandalone: true,
      }),
    ).toBe(true);
    expect(
      isStandalonePwa({
        displayModeStandalone: false,
        navigatorStandalone: false,
      }),
    ).toBe(false);
  });

  it("recognizes only usable deferred install prompt events", () => {
    const usable = Object.assign(new Event("beforeinstallprompt"), {
      prompt: async () => undefined,
      userChoice: Promise.resolve({
        outcome: "accepted" as const,
        platform: "web",
      }),
    });
    expect(isDeferredInstallPromptEvent(usable)).toBe(true);
    expect(
      isDeferredInstallPromptEvent(new Event("beforeinstallprompt")),
    ).toBe(false);
  });

  it("requires value, install capability, and no installed or cooldown state", () => {
    const base = {
      hasDeferredPrompt: true,
      isAppleMobile: false,
      isStandalone: false,
      isInstalled: false,
      hasEngagement: true,
      dismissedAt: null,
      now: 10_000,
    };
    expect(shouldOfferPwaInstall(base)).toBe(true);
    expect(
      shouldOfferPwaInstall({ ...base, hasDeferredPrompt: false }),
    ).toBe(false);
    expect(
      shouldOfferPwaInstall({
        ...base,
        hasDeferredPrompt: false,
        isAppleMobile: true,
      }),
    ).toBe(true);
    expect(
      shouldOfferPwaInstall({ ...base, hasEngagement: false }),
    ).toBe(false);
    expect(shouldOfferPwaInstall({ ...base, isStandalone: true })).toBe(false);
    expect(shouldOfferPwaInstall({ ...base, isInstalled: true })).toBe(false);
    expect(
      shouldOfferPwaInstall({ ...base, dismissedAt: base.now - 1 }),
    ).toBe(false);
  });
});
