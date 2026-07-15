/* global self, clients */

const DEFAULT_DESTINATION = "/filings";

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
  ];
  if (typeof payload.unreadCount === "number" && self.navigator && typeof self.navigator.setAppBadge === "function") {
    work.push(self.navigator.setAppBadge(payload.unreadCount));
  }
  event.waitUntil(Promise.all(work));
});

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
