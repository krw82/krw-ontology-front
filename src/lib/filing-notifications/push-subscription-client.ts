import {
  serializePushSubscription,
  urlBase64ToUint8Array,
} from "@/lib/filing-notifications/client";

const SERVICE_WORKER_READY_TIMEOUT_MS = 4_000;

export async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing?.active) return existing;

    return await new Promise<ServiceWorkerRegistration | null>((resolve) => {
      const timeoutId = window.setTimeout(
        () => resolve(null),
        SERVICE_WORKER_READY_TIMEOUT_MS,
      );
      void navigator.serviceWorker.ready.then(
        (registration) => {
          window.clearTimeout(timeoutId);
          resolve(registration);
        },
        () => {
          window.clearTimeout(timeoutId);
          resolve(null);
        },
      );
    });
  } catch {
    return null;
  }
}

export async function getCurrentDevicePushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration ? await registration.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

export async function savePushSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializePushSubscription(subscription)),
  });
  if (!response.ok) throw new Error("subscription_save_failed");
}

export async function subscribeCurrentDevice(
  vapidPublicKey: string,
): Promise<NotificationPermission> {
  const registration = await getReadyServiceWorkerRegistration();
  if (!registration) throw new Error("service_worker_unavailable");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  await savePushSubscription(subscription);
  return permission;
}
