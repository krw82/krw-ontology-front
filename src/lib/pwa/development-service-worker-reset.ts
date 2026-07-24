/**
 * This script runs before the Next.js client bundle in local development.
 *
 * A service worker that cached Turbopack chunks can prevent the application
 * from booting, which means a React cleanup component would never get a
 * chance to unregister it. Keep the reset inline and nonce-protected so an
 * already-controlled localhost tab can recover on its next navigation.
 */
export const DEVELOPMENT_SERVICE_WORKER_RESET_SCRIPT = `(() => {
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return;
  if (!("serviceWorker" in navigator)) return;

  const reloadMarker = "krwo:dev-service-worker-reset:v1";
  let canReload = true;
  try {
    canReload = window.sessionStorage.getItem(reloadMarker) !== "1";
    if (canReload) window.sessionStorage.setItem(reloadMarker, "1");
  } catch {
    // Private browsing can deny sessionStorage; cleanup still remains useful.
  }

  const isKrwoWorker = (registration) => {
    const workers = [
      registration.active,
      registration.waiting,
      registration.installing,
    ];
    return workers.some((worker) => {
      if (!worker) return false;
      try {
        const scriptUrl = new URL(worker.scriptURL);
        return scriptUrl.origin === window.location.origin && scriptUrl.pathname === "/sw.js";
      } catch {
        return false;
      }
    });
  };

  const hadController = Boolean(navigator.serviceWorker.controller);
  void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    await Promise.all(
      registrations
        .filter(isKrwoWorker)
        .map((registration) => registration.unregister()),
    );

    if ("caches" in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("krwo-pwa:"))
          .map((cacheName) => window.caches.delete(cacheName)),
      );
    }

    if (hadController && canReload) window.location.reload();
  }).catch(() => {
    // The app remains usable when browser storage cleanup is unavailable.
  });
})();`;
