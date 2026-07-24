/* global self, clients */

const DEFAULT_DESTINATION = "/filings";
const CACHE_PREFIX = "krwo-pwa";
const WORKER_SCRIPT_URL = new URL(
  self.location.href || self.location.origin,
  self.location.origin,
);
const SW_VERSION =
  WORKER_SCRIPT_URL.searchParams.get("v") || "2026-07-17-v1";
const APP_SHELL_CACHE = `${CACHE_PREFIX}:shell:${SW_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}:static:${SW_VERSION}`;
const STATIC_CACHE_ENTRY_LIMIT = 96;
const OFFLINE_URL = "/offline.html";
const FILING_UNREAD_SERVICE_WORKER_MESSAGE = "KRWO_FILING_UNREAD_CHANGED";
const APP_SHELL_URLS = [
  OFFLINE_URL,
  "/offline-shell.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-icon.png",
  "/krw-logo.svg",
  "/fonts/material-symbols-outlined.woff2",
];
const SAFE_PUBLIC_ASSET_PATHS = new Set([
  "/offline-shell.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-icon.png",
  "/krw-logo.svg",
  "/krw-logo-120.png",
  "/fonts/material-symbols-outlined.woff2",
]);
const NETWORK_ONLY_PATH_PREFIXES = [
  "/api",
  "/app",
  "/auth",
  "/chat",
  "/companies",
  "/desktop",
  "/discover",
  "/filings",
  "/guru",
  "/institutional-holdings",
  "/login",
  "/pulse",
  "/settings",
  "/share",
  "/watchlist",
];

// The worker intentionally waits after installation. A visible in-app prompt
// asks the user before sending SKIP_WAITING, so an active research session is
// never reloaded merely because a deployment completed.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => (
            cacheName.startsWith(`${CACHE_PREFIX}:`) &&
            cacheName !== APP_SHELL_CACHE &&
            cacheName !== STATIC_CACHE
          ))
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === "GET_VERSION") {
    event.ports?.[0]?.postMessage({ version: SW_VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.protocol.startsWith("http")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkNavigationWithOfflineFallback(request));
    return;
  }

  // Authenticated app data, RSC payloads, chat, billing, and every API request
  // remain browser-managed network requests. They are never written to Cache
  // Storage by this worker.
  if (isNetworkOnlyPath(url.pathname)) return;

  if (isSafeStaticAsset(request, url.pathname)) {
    event.respondWith(cacheFirstStaticAsset(request));
  }
});

function isNetworkOnlyPath(pathname) {
  return NETWORK_ONLY_PATH_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ));
}

function isSafeStaticAsset(request, pathname) {
  // Next.js owns the cache lifecycle for its build/HMR chunks. A service
  // worker cache can outlive the module graph that produced those chunks and
  // make a development tab fail before React can boot. Only cache the small,
  // explicitly allowlisted PWA shell assets here.
  if (!SAFE_PUBLIC_ASSET_PATHS.has(pathname)) return false;
  return ["font", "image", "script", "style"].includes(request.destination);
}

async function cacheFirstStaticAsset(request) {
  const precached = await caches.match(request);
  if (precached) return precached;

  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    await trimCache(cache, STATIC_CACHE_ENTRY_LIMIT);
  }
  return response;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  const overflow = keys.length - maxEntries;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}

async function networkNavigationWithOfflineFallback(request) {
  try {
    // Deliberately do not cache HTML. Product routes can contain authenticated
    // data and an obsolete financial screen is more dangerous than no screen.
    return await fetch(request);
  } catch {
    const cachedOfflinePage = await caches.match(OFFLINE_URL);
    return cachedOfflinePage ?? new Response(
      "Internet connection required.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  if (!payload) return;

  const options = {
    body: payload.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag,
    renotify: false,
    data: {
      destinationPath: payload.destinationPath,
      notificationId: payload.notificationId,
    },
  };
  const receivedType = payload.notificationId.startsWith("test-") ? "test_push_received" : "sw_push_received";
  const work = [
    reportReceipt(payload.notificationId, receivedType),
    self.registration.showNotification(payload.title, options)
      .then(() => reportReceipt(payload.notificationId, "notification_show_called")),
    notifyVisibleClientsOfFiling(payload.unreadCount),
  ];
  if (typeof payload.unreadCount === "number" && self.navigator && typeof self.navigator.setAppBadge === "function") {
    work.push(self.navigator.setAppBadge(payload.unreadCount));
  }
  event.waitUntil(Promise.all(work));
});

async function notifyVisibleClientsOfFiling(unreadCount) {
  const windows = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  windows.forEach((client) => {
    client.postMessage({
      type: FILING_UNREAD_SERVICE_WORKER_MESSAGE,
      unreadCount,
    });
  });
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = self.atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function renewPushSubscription() {
  const keyResponse = await fetch("/api/push/vapid", { cache: "no-store" });
  if (!keyResponse.ok) return;
  const { publicKey } = await keyResponse.json();
  if (typeof publicKey !== "string" || !publicKey) return;

  const subscription = await self.registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) return;

  await fetch("/api/push/subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: serialized.endpoint,
      expirationTime: serialized.expirationTime ?? null,
      keys: serialized.keys,
    }),
  });
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    renewPushSubscription().catch(() => {
      // The user may be signed out or notifications may have been disabled.
      // The settings screen will reconcile the subscription on the next visit.
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destinationPath = withNotificationId(
    safeDestinationPath(event.notification?.data?.destinationPath),
    event.notification?.data?.notificationId,
  );
  const notificationId = event.notification?.data?.notificationId;
  event.waitUntil(Promise.all([
    reportReceipt(notificationId, "notification_clicked"),
    openDestination(destinationPath),
  ]));
});

async function reportReceipt(notificationId, receiptType) {
  if (typeof notificationId !== "string" || !notificationId) return;
  try {
    await fetch("/api/push/receipts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: notificationId, receipt_type: receiptType }),
    });
  } catch {
    // A receipt is observability only; the user-visible notification still wins.
  }
}

function readPayload(event) {
  if (!event.data) return null;
  try {
    const value = event.data.json();
    if (
      !value ||
      value.schemaVersion !== 1 ||
      typeof value.title !== "string" ||
      typeof value.body !== "string" ||
      typeof value.notificationId !== "string"
    ) {
      return null;
    }
    return {
      title: value.title.slice(0, 160),
      body: value.body.slice(0, 500),
      tag: typeof value.tag === "string" ? value.tag.slice(0, 180) : `filing:${value.notificationId}`,
      notificationId: value.notificationId,
      destinationPath: safeDestinationPath(value.destinationPath),
      unreadCount: typeof value.unreadCount === "number" && Number.isInteger(value.unreadCount) && value.unreadCount >= 0 ? value.unreadCount : null,
    };
  } catch {
    return null;
  }
}

function safeDestinationPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_DESTINATION;
  }
  return value;
}

function withNotificationId(path, notificationId) {
  if (typeof notificationId !== "string" || !notificationId) return path;
  const url = new URL(path, self.location.origin);
  url.searchParams.set("notification", notificationId);
  return `${url.pathname}${url.search}`;
}

async function openDestination(path) {
  const target = new URL(path, self.location.origin).href;
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows[0];
  if (existing) {
    await existing.navigate(target);
    return existing.focus();
  }
  return clients.openWindow(target);
}
