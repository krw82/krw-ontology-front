import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerHandler = (event: Record<string, unknown>) => void;

function createWorkerHarness() {
  const handlers = new Map<string, WorkerHandler[]>();
  const put = vi.fn(async () => undefined);
  const cacheKeys = vi.fn(async () => [] as Request[]);
  const cacheDelete = vi.fn(async () => true);
  const addAll = vi.fn(async () => undefined);
  const cacheMatch = vi.fn(async () => undefined);
  const offlineResponse = new Response("offline-shell", {
    headers: { "Content-Type": "text/html" },
  });
  const caches = {
    open: vi.fn(async () => ({
      addAll,
      match: cacheMatch,
      put,
      keys: cacheKeys,
      delete: cacheDelete,
    })),
    keys: vi.fn(async () => [] as string[]),
    delete: vi.fn(async () => true),
    match: vi.fn(async (request: RequestInfo | URL) => (
      request === "/offline.html" ? offlineResponse.clone() : undefined
    )),
  };
  const skipWaiting = vi.fn(async () => undefined);
  const networkResponse = new Response("network", { status: 200 });
  Object.defineProperty(networkResponse, "type", { value: "basic" });
  const fetch = vi.fn(async () => networkResponse);
  const clients = {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => []),
    openWindow: vi.fn(async () => undefined),
  };
  const self = {
    location: { origin: "https://krwontology.com" },
    navigator: {},
    registration: {
      showNotification: vi.fn(async () => undefined),
      pushManager: { subscribe: vi.fn() },
    },
    addEventListener(type: string, handler: WorkerHandler) {
      const current = handlers.get(type) ?? [];
      current.push(handler);
      handlers.set(type, current);
    },
    skipWaiting,
    atob,
  };

  const source = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
  vm.runInNewContext(source, {
    self,
    clients,
    caches,
    fetch,
    Response,
    Request,
    URL,
    Uint8Array,
    Promise,
    Set,
  });

  return {
    handlers,
    addAll,
    put,
    cacheMatch,
    caches,
    fetch,
    clients,
    skipWaiting,
  };
}

function singleHandler(harness: ReturnType<typeof createWorkerHarness>, type: string) {
  const handlers = harness.handlers.get(type);
  expect(handlers).toHaveLength(1);
  return handlers?.[0] as WorkerHandler;
}

describe("service worker cache and update policy", () => {
  it("preserves push behavior and waits for explicit update activation", async () => {
    const harness = createWorkerHarness();
    expect(harness.handlers.has("push")).toBe(true);
    expect(harness.handlers.has("pushsubscriptionchange")).toBe(true);
    expect(harness.handlers.has("notificationclick")).toBe(true);

    let installWork: Promise<unknown> | undefined;
    singleHandler(harness, "install")({
      waitUntil(work: Promise<unknown>) {
        installWork = work;
      },
    });
    await installWork;
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.addAll).toHaveBeenCalledWith(expect.arrayContaining([
      "/offline.html",
      "/offline-shell.js",
      "/icons/icon-192.png",
    ]));

    let updateWork: Promise<unknown> | undefined;
    singleHandler(harness, "message")({
      data: { type: "SKIP_WAITING" },
      waitUntil(work: Promise<unknown>) {
        updateWork = work;
      },
    });
    await updateWork;
    expect(harness.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("never intercepts authenticated or API data requests", () => {
    const harness = createWorkerHarness();
    const respondWith = vi.fn();
    const fetchHandler = singleHandler(harness, "fetch");

    for (const url of [
      "https://krwontology.com/api/chat/run",
      "https://krwontology.com/pulse?_rsc=abc",
      "https://krwontology.com/settings/billing",
    ]) {
      fetchHandler({
        request: new Request(url, { method: "GET" }),
        respondWith,
      });
    }

    expect(respondWith).not.toHaveBeenCalled();
    expect(harness.put).not.toHaveBeenCalled();
  });

  it("caches only allowlisted same-origin static assets", async () => {
    const harness = createWorkerHarness();
    let responseWork: Promise<Response> | undefined;
    singleHandler(harness, "fetch")({
      request: {
        method: "GET",
        url: "https://krwontology.com/_next/static/chunks/app.abc123.js",
        mode: "cors",
        destination: "script",
      },
      respondWith(work: Promise<Response>) {
        responseWork = work;
      },
    });

    await responseWork;
    expect(harness.fetch).toHaveBeenCalledTimes(1);
    expect(harness.put).toHaveBeenCalledTimes(1);
  });

  it("falls back to the offline shell without storing navigation HTML", async () => {
    const harness = createWorkerHarness();
    harness.fetch.mockRejectedValueOnce(new TypeError("offline"));
    let responseWork: Promise<Response> | undefined;
    singleHandler(harness, "fetch")({
      request: {
        method: "GET",
        url: "https://krwontology.com/pulse",
        mode: "navigate",
        destination: "document",
      },
      respondWith(work: Promise<Response>) {
        responseWork = work;
      },
    });

    const response = await responseWork;
    expect(await response?.text()).toBe("offline-shell");
    expect(harness.put).not.toHaveBeenCalled();
  });
});
