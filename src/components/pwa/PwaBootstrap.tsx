"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  APP_VERSION,
  SERVICE_WORKER_VERSION_DATASET_KEY,
} from "@/lib/app-version";
import PwaInstallToast, {
  type PwaInstallToastMode,
} from "./PwaInstallToast";
import {
  type DeferredInstallPromptEvent,
  PWA_BEFORE_UPDATE_EVENT,
  PWA_INSTALL_ENGAGEMENT_EVENT,
  PWA_INSTALL_STORAGE_KEYS,
  isAppleMobileBrowser,
  isDeferredInstallPromptEvent,
  isMeaningfulReturnVisit,
  isPwaInstallEngagementDetail,
  isPwaProductRoute,
  isStandalonePwa,
  parseStoredTimestamp,
  shouldOfferServiceWorkerUpdate,
  shouldOfferPwaInstall,
  shouldReloadForControllerChange,
} from "./lifecycle";

type UpdateState = "idle" | "ready" | "blocked" | "updating" | "failed";

const UPDATE_TIMEOUT_MS = 12_000;
const VERSION_REQUEST_TIMEOUT_MS = 2_000;
const IS_PWA_DEVELOPMENT_RUNTIME =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ENABLE_PWA_IN_DEV === "1";
const IS_PWA_RUNTIME_ENABLED =
  process.env.NODE_ENV === "production" || IS_PWA_DEVELOPMENT_RUNTIME;
const IS_DEVELOPMENT_INSTALL_PREVIEW =
  process.env.NODE_ENV === "development" && !IS_PWA_DEVELOPMENT_RUNTIME;

function serviceWorkerScriptUrl() {
  return `/sw.js?v=${encodeURIComponent(APP_VERSION)}`;
}

async function syncServiceWorkerVersion(
  worker: ServiceWorker | null,
): Promise<void> {
  if (!worker || typeof MessageChannel === "undefined") return;

  const version = await new Promise<string | null>((resolve) => {
    const channel = new MessageChannel();
    const timeoutId = window.setTimeout(() => {
      channel.port1.close();
      channel.port2.close();
      resolve(null);
    }, VERSION_REQUEST_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeoutId);
      const nextVersion =
        typeof event.data?.version === "string" ? event.data.version : null;
      channel.port1.close();
      channel.port2.close();
      resolve(nextVersion);
    };
    try {
      worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
    } catch {
      window.clearTimeout(timeoutId);
      channel.port1.close();
      channel.port2.close();
      resolve(null);
    }
  });

  if (version) {
    document.documentElement.dataset[SERVICE_WORKER_VERSION_DATASET_KEY] =
      version;
  }
}

export default function PwaBootstrap() {
  const [isOffline, setIsOffline] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [controllerReloadPending, setControllerReloadPending] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [installEnvironmentReady, setInstallEnvironmentReady] = useState(false);
  const [isAppleMobile, setIsAppleMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hasInstallEngagement, setHasInstallEngagement] = useState(false);
  const [installDismissedAt, setInstallDismissedAt] = useState<number | null>(null);
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<DeferredInstallPromptEvent | null>(null);
  const [installMode, setInstallMode] =
    useState<PwaInstallToastMode>("offer");
  const [installEvaluationTime, setInstallEvaluationTime] = useState(0);
  const [isDevelopmentInstallPreviewDismissed, setIsDevelopmentInstallPreviewDismissed] =
    useState(false);
  const updateRequestedRef = useRef(false);
  const hadControllerRef = useRef(false);
  const reloadedRef = useRef(false);
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const installOfferTrackedRef = useRef(false);
  const installCompletedTrackedRef = useRef(false);
  const installSurfaceRef = useRef("global_value_moment");

  useEffect(() => {
    const syncConnectionState = () => setIsOffline(!navigator.onLine);
    syncConnectionState();
    window.addEventListener("online", syncConnectionState);
    window.addEventListener("offline", syncConnectionState);

    return () => {
      window.removeEventListener("online", syncConnectionState);
      window.removeEventListener("offline", syncConnectionState);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const now = Date.now();
    const appleMobile = isAppleMobileBrowser({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    const standalone = isStandalonePwa({
      displayModeStandalone:
        typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: (navigator as Navigator & { standalone?: boolean })
        .standalone,
    });
    let engagedAt = readLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.engagedAt);

    // The dedicated PWA development server uses the browser's real install
    // event. Seed only the engagement gate there so the complete flow can be
    // tested without performing a production-only value action first.
    if (IS_PWA_DEVELOPMENT_RUNTIME) {
      engagedAt = engagedAt ?? now;
      writeLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.engagedAt, engagedAt);
      installSurfaceRef.current = "development_pwa_test";
    }

    if (
      isPwaProductRoute(window.location.pathname) &&
      !readSessionFlag(PWA_INSTALL_STORAGE_KEYS.productVisitSession)
    ) {
      const previousVisitAt = readLocalTimestamp(
        PWA_INSTALL_STORAGE_KEYS.lastProductVisitAt,
      );
      writeSessionFlag(PWA_INSTALL_STORAGE_KEYS.productVisitSession);
      writeLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.lastProductVisitAt, now);
      if (isMeaningfulReturnVisit({ previousVisitAt, now })) {
        engagedAt = engagedAt ?? now;
        writeLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.engagedAt, engagedAt);
        installSurfaceRef.current = "return_visit";
      }
    }

    queueMicrotask(() => {
      if (disposed) return;
      setIsAppleMobile(appleMobile);
      setIsStandalone(standalone);
      setIsInstalled(
        readLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.installedAt) !== null,
      );
      setInstallDismissedAt(
        readLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.dismissedAt),
      );
      setHasInstallEngagement(
        readLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.engagedAt) !== null,
      );
      setInstallEvaluationTime(now);
      setInstallEnvironmentReady(true);
    });

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!isDeferredInstallPromptEvent(event)) return;

      // A fresh browser install event proves that a stale installed marker no
      // longer reflects this browser (for example, after an uninstall).
      removeLocalValue(PWA_INSTALL_STORAGE_KEYS.installedAt);
      setIsInstalled(false);
      setDeferredInstallPrompt(event);
      setInstallMode("offer");
      setInstallEvaluationTime(Date.now());
    };

    const handleAppInstalled = () => {
      const installedAt = Date.now();
      writeLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.installedAt, installedAt);
      removeLocalValue(PWA_INSTALL_STORAGE_KEYS.dismissedAt);
      setDeferredInstallPrompt(null);
      setInstallDismissedAt(null);
      setIsInstalled(true);
      setInstallMode("offer");
      setInstallEvaluationTime(installedAt);
      if (!installCompletedTrackedRef.current) {
        installCompletedTrackedRef.current = true;
        trackClientEventSilently("pwa_installed", {
          surface: "global_pwa_lifecycle",
          method: "appinstalled_event",
        });
      }
    };

    const handleInstallEngagement = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isPwaInstallEngagementDetail(detail)) return;

      const engagedAtTimestamp = Date.now();
      if (detail.kind === "install_requested") {
        removeLocalValue(PWA_INSTALL_STORAGE_KEYS.dismissedAt);
        setInstallDismissedAt(null);
        // A direct request from the account menu should reopen the local
        // development preview even when its dismiss control was used earlier.
        setIsDevelopmentInstallPreviewDismissed(false);
      }
      writeLocalTimestamp(
        PWA_INSTALL_STORAGE_KEYS.engagedAt,
        engagedAtTimestamp,
      );
      installSurfaceRef.current = detail.surface ?? detail.kind;
      setHasInstallEngagement(true);
      setInstallMode("offer");
      setInstallEvaluationTime(engagedAtTimestamp);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    window.addEventListener(
      PWA_INSTALL_ENGAGEMENT_EVENT,
      handleInstallEngagement,
    );

    return () => {
      disposed = true;
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener(
        PWA_INSTALL_ENGAGEMENT_EVENT,
        handleInstallEngagement,
      );
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // A service worker must not control the standard Next.js development
    // server. `dev:pwa` explicitly opts into a separate PWA test runtime;
    // otherwise Turbopack's changing HMR chunks can mix module graphs from
    // different refreshes and produce a client-only "module factory is not
    // available" error. Remove registrations left by an earlier local run so
    // the fix also repairs an already-controlled development tab.
    if (!IS_PWA_RUNTIME_ENABLED) {
      let disposed = false;
      void navigator.serviceWorker
        .getRegistrations()
        .then(async (registrations) => {
          if (disposed) return;

          await Promise.all(
            registrations
              .filter((registration) => {
                try {
                  const workers = [
                    registration.active,
                    registration.waiting,
                    registration.installing,
                  ];
                  return workers.some((worker) => {
                    if (!worker) return false;
                    const scriptUrl = new URL(worker.scriptURL);
                    return (
                      scriptUrl.origin === window.location.origin &&
                      scriptUrl.pathname === "/sw.js"
                    );
                  });
                } catch {
                  return false;
                }
              })
              .map((registration) => registration.unregister()),
          );

          if (!("caches" in window)) return;
          const cacheNames = await window.caches.keys();
          await Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith("krwo-pwa:"))
              .map((cacheName) => window.caches.delete(cacheName)),
          );
        })
        .catch(() => {
          // A browser may expose serviceWorker without allowing cleanup.
        });

      return () => {
        disposed = true;
      };
    }

    const standalone = isStandalonePwa({
      displayModeStandalone:
        typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: (navigator as Navigator & { standalone?: boolean })
        .standalone,
    });
    hadControllerRef.current = Boolean(navigator.serviceWorker.controller);
    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let trackedInstallingWorker: ServiceWorker | null = null;

    const offerUpdate = (worker: ServiceWorker | null | undefined) => {
      if (
        disposed ||
        !shouldOfferServiceWorkerUpdate(
          worker,
          Boolean(navigator.serviceWorker.controller),
          standalone,
        )
      ) {
        return;
      }
      setWaitingWorker(worker);
      setUpdateState("ready");
    };

    const handleInstallingStateChange = () => {
      if (!registration || !trackedInstallingWorker) return;
      if (trackedInstallingWorker.state === "installed") {
        offerUpdate(registration.waiting ?? trackedInstallingWorker);
      }
    };

    const trackInstallingWorker = () => {
      if (!registration?.installing) return;
      trackedInstallingWorker?.removeEventListener(
        "statechange",
        handleInstallingStateChange,
      );
      trackedInstallingWorker = registration.installing;
      trackedInstallingWorker.addEventListener(
        "statechange",
        handleInstallingStateChange,
      );
    };

    const handleControllerChange = () => {
      const hadController = hadControllerRef.current;
      hadControllerRef.current = true;
      setWaitingWorker(null);
      void syncServiceWorkerVersion(navigator.serviceWorker.controller);
      if (
        !shouldReloadForControllerChange({
          hadController,
          alreadyReloaded: reloadedRef.current,
        })
      ) {
        return;
      }
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);

      // The tab that initiated the update already passed the unsaved-work
      // guard. Other open tabs receive the same controller change, so they
      // must either reload safely now or retain a direct-reload prompt; the
      // old waiting worker no longer exists after activation.
      if (!updateRequestedRef.current) {
        const beforeUpdate = new Event(PWA_BEFORE_UPDATE_EVENT, {
          cancelable: true,
        });
        if (!window.dispatchEvent(beforeUpdate)) {
          setControllerReloadPending(true);
          setUpdateState("blocked");
          return;
        }
      }

      reloadedRef.current = true;
      setControllerReloadPending(false);
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    void navigator.serviceWorker
      .register(serviceWorkerScriptUrl(), {
        scope: "/",
        updateViaCache: "none",
      })
      .then((nextRegistration) => {
        if (disposed) return;
        registration = nextRegistration;
        offerUpdate(registration.waiting);
        registration.addEventListener("updatefound", trackInstallingWorker);
        trackInstallingWorker();
        void navigator.serviceWorker.ready.then((readyRegistration) => {
          if (disposed) return;
          void syncServiceWorkerVersion(
            navigator.serviceWorker.controller ?? readyRegistration.active,
          );
        });
      })
      .catch(() => {
        // The web app remains fully usable when service workers are unavailable.
      });

    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", trackInstallingWorker);
      trackedInstallingWorker?.removeEventListener(
        "statechange",
        handleInstallingStateChange,
      );
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (
      (!waitingWorker && !controllerReloadPending) ||
      updateState === "updating" ||
      isOffline
    ) {
      return;
    }

    const beforeUpdate = new Event(PWA_BEFORE_UPDATE_EVENT, {
      cancelable: true,
    });
    if (!window.dispatchEvent(beforeUpdate)) {
      setUpdateState("blocked");
      return;
    }

    if (controllerReloadPending) {
      reloadedRef.current = true;
      setControllerReloadPending(false);
      setUpdateState("updating");
      window.location.reload();
      return;
    }

    if (!waitingWorker) return;
    updateRequestedRef.current = true;
    setUpdateState("updating");
    try {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } catch {
      updateRequestedRef.current = false;
      setUpdateState("failed");
      return;
    }
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    updateTimeoutRef.current = setTimeout(() => {
      updateRequestedRef.current = false;
      setUpdateState("failed");
    }, UPDATE_TIMEOUT_MS);
  }, [controllerReloadPending, isOffline, updateState, waitingWorker]);

  const dismissUpdate = useCallback(() => {
    if (updateState === "updating" || controllerReloadPending) return;
    setWaitingWorker(null);
    setUpdateState("idle");
  }, [controllerReloadPending, updateState]);

  const dismissInstall = useCallback(() => {
    if (installMode === "prompting") return;

    // Development intentionally renders the install surface without waiting
    // for an installable browser event, so it can be reviewed with `npm run
    // dev`. Keep the close control useful for the current page, but reset the
    // preview on the next reload instead of persisting a real dismissal.
    if (IS_DEVELOPMENT_INSTALL_PREVIEW) {
      setIsDevelopmentInstallPreviewDismissed(true);
      return;
    }

    const dismissedAt = Date.now();
    writeLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.dismissedAt, dismissedAt);
    setInstallDismissedAt(dismissedAt);
    setInstallMode("offer");
    setInstallEvaluationTime(dismissedAt);
  }, [installMode]);

  const beginInstall = useCallback(async () => {
    if (isAppleMobile) {
      setInstallMode("ios-instructions");
      return;
    }
    if (!deferredInstallPrompt || installMode === "prompting") return;

    setInstallMode("prompting");
    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      setDeferredInstallPrompt(null);
      if (choice.outcome === "accepted") {
        const installedAt = Date.now();
        writeLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.installedAt, installedAt);
        removeLocalValue(PWA_INSTALL_STORAGE_KEYS.dismissedAt);
        setInstallDismissedAt(null);
        setIsInstalled(true);
        setInstallMode("offer");
        setInstallEvaluationTime(installedAt);
        if (!installCompletedTrackedRef.current) {
          installCompletedTrackedRef.current = true;
          trackClientEventSilently("pwa_installed", {
            surface: installSurfaceRef.current,
            method: "browser_prompt",
          });
        }
        return;
      }

      const dismissedAt = Date.now();
      writeLocalTimestamp(PWA_INSTALL_STORAGE_KEYS.dismissedAt, dismissedAt);
      setInstallDismissedAt(dismissedAt);
      setInstallMode("offer");
      setInstallEvaluationTime(dismissedAt);
    } catch {
      setInstallMode("failed");
    }
  }, [deferredInstallPrompt, installMode, isAppleMobile]);

  const showInstallOffer =
    installEnvironmentReady &&
    !waitingWorker &&
    !controllerReloadPending &&
    !isOffline &&
    !isDevelopmentInstallPreviewDismissed &&
    (IS_DEVELOPMENT_INSTALL_PREVIEW ||
      shouldOfferPwaInstall({
        hasDeferredPrompt: deferredInstallPrompt !== null,
        isAppleMobile,
        isStandalone,
        isInstalled,
        hasEngagement: hasInstallEngagement,
        dismissedAt: installDismissedAt,
        now: installEvaluationTime,
      }));

  useEffect(() => {
    if (
      IS_DEVELOPMENT_INSTALL_PREVIEW ||
      !showInstallOffer ||
      installOfferTrackedRef.current
    ) {
      return;
    }
    installOfferTrackedRef.current = true;
    trackClientEventSilently("pwa_install_prompt_seen", {
      surface: installSurfaceRef.current,
      prompt_type: isAppleMobile ? "ios_instructions" : "browser_install",
    });
  }, [isAppleMobile, showInstallOffer]);

  return (
    <>
      {isOffline ? (
        <div className="pwa-offline-safe-top pointer-events-none fixed inset-x-0 top-0 z-[180] flex justify-center px-base">
          <div
            className="rounded-full border border-[#f3d8a5] bg-[#fff8e9] px-base py-xs text-center text-[12px] font-bold leading-5 text-[#76510e] shadow-sm"
            role="status"
            aria-live="polite"
          >
            인터넷 연결이 끊겼습니다. 리서치·공시 업데이트는 연결 후 다시 시작됩니다.
          </div>
        </div>
      ) : null}

      {waitingWorker || controllerReloadPending ? (
        <div className="pwa-update-safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-[180] flex justify-center px-base">
          <div
            className="pointer-events-auto flex w-full max-w-[520px] items-center gap-sm rounded-[14px] border border-hairline bg-ink px-base py-sm text-white shadow-[0_16px_48px_rgba(10,11,13,0.24)]"
            role="status"
            aria-live="polite"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-black leading-5">
                {updateState === "updating"
                  ? "새 버전을 적용하는 중입니다."
                  : "새 버전이 준비되었습니다."}
              </p>
              {updateState === "blocked" ? (
                <p className="mt-xxs text-[11px] leading-4 text-on-dark-soft">
                  진행 중인 작업을 마친 뒤 다시 시도해 주세요.
                </p>
              ) : updateState === "failed" ? (
                <p className="mt-xxs text-[11px] leading-4 text-on-dark-soft">
                  업데이트를 시작하지 못했습니다. 다시 시도해 주세요.
                </p>
              ) : isOffline ? (
                <p className="mt-xxs text-[11px] leading-4 text-on-dark-soft">
                  인터넷에 연결하면 업데이트할 수 있습니다.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={applyUpdate}
              disabled={updateState === "updating" || isOffline}
              className="min-h-11 shrink-0 rounded-[10px] bg-white px-sm text-[12px] font-black text-ink transition-[transform,opacity] duration-100 active:scale-[0.975] disabled:cursor-wait disabled:opacity-55 disabled:active:scale-100"
            >
              {updateState === "updating" ? "적용 중" : "업데이트"}
            </button>
            {!controllerReloadPending ? (
              <button
                type="button"
                onClick={dismissUpdate}
                disabled={updateState === "updating"}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-on-dark-soft transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                aria-label="업데이트 알림 닫기"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  close
                </span>
              </button>
            ) : null}
          </div>
        </div>
      ) : showInstallOffer ? (
        <PwaInstallToast
          isAppleMobile={isAppleMobile}
          mode={installMode}
          onInstall={() => void beginInstall()}
          onDismiss={dismissInstall}
        />
      ) : null}
    </>
  );
}

function readLocalTimestamp(key: string): number | null {
  try {
    return parseStoredTimestamp(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeLocalTimestamp(key: string, timestamp: number): void {
  try {
    window.localStorage.setItem(key, String(timestamp));
  } catch {
    // Storage may be unavailable in private browsing. The in-memory state still
    // prevents repeated prompts during the current page lifetime.
  }
}

function removeLocalValue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage; install behavior remains progressively enhanced.
  }
}

function readSessionFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(key: string): void {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Session storage is an optimization for return-visit detection only.
  }
}
