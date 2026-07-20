import { expect, test } from "@playwright/test";

test.describe("PWA lifecycle", () => {
  test.use({ serviceWorkers: "allow" });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/analytics/events", async (route) => {
      await route.fulfill({ status: 204, body: "" });
    });
  });

  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Chromium is the deterministic service-worker lifecycle gate in CI.",
  );

  test("serves an installable manifest and activates the versioned worker", async ({
    page,
    request,
  }) => {
    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    const manifest = (await manifestResponse.json()) as {
      start_url?: string;
      display?: string;
      icons?: Array<{ src?: string; sizes?: string }>;
    };
    expect(manifest.start_url).toBe("/app?source=pwa");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/icon-192.png" }),
        expect.objectContaining({ src: "/icons/icon-512.png" }),
      ]),
    );

    for (const iconPath of ["/icons/icon-192.png", "/icons/icon-512.png"]) {
      const iconResponse = await request.get(iconPath);
      expect(iconResponse.ok()).toBe(true);
      expect(iconResponse.headers()["content-type"]).toContain("image/png");
    }

    await page.goto("/pulse", { waitUntil: "domcontentloaded" });
    // `ready` may resolve while the active-slot worker is still running its
    // activate event. Wait for the real lifecycle transition instead of
    // treating the valid `activating` state as a product failure.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          return (
            navigator.serviceWorker.controller ?? registration.active
          )?.state ?? null;
        }),
      )
      .toBe("activated");
    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const active = navigator.serviceWorker.controller ?? registration.active;
      return { scriptURL: active?.scriptURL ?? null };
    });
    expect(worker.scriptURL).toContain("/sw.js?v=");
  });

  test("uses the offline shell and never caches private API responses", async ({
    context,
    page,
  }) => {
    await page.goto("/pulse", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const existing = await navigator.serviceWorker.getRegistration("/");
      if (!existing) {
        await navigator.serviceWorker.register("/sw.js?v=e2e", {
          scope: "/",
          updateViaCache: "none",
        });
      }
      await navigator.serviceWorker.ready;
    });
    if (
      !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    ) {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.evaluate(async () => {
      await fetch("/api/filings/unread-count", { cache: "no-store" }).catch(
        () => undefined,
      );
    });
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("krwo-offline-read-model", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("snapshots")) {
            request.result.createObjectStore("snapshots");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("snapshots", "readwrite");
        transaction.objectStore("snapshots").put(
          {
            version: 1,
            synchronized_at: "2026-07-17T09:30:00.000Z",
            items: [
              {
                ticker: "AAPL",
                eyebrow: "8-K 새 공시",
                title: "오프라인에서 확인할 공개 공시 요약",
                body: "마지막 온라인 동기화 때 저장된 공개 정보입니다.",
                occurred_at: "2026-07-17T09:00:00.000Z",
              },
            ],
          },
          "pulse-public",
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    });

    const cachedApiUrls = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const requests = (
        await Promise.all(
          cacheNames.map(async (cacheName) => {
            const cache = await caches.open(cacheName);
            return cache.keys();
          }),
        )
      ).flat();
      return requests
        .map((request) => request.url)
        .filter((url) => new URL(url).pathname.startsWith("/api/"));
    });
    expect(cachedApiUrls).toEqual([]);

    await context.setOffline(true);
    try {
      await page.goto("/pulse?source=offline_e2e", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", {
          name: "인터넷 연결을 확인해 주세요.",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "저장된 공개 공시 요약" }),
      ).toBeVisible();
      await expect(page.getByText("마지막 동기화:")).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "오프라인에서 확인할 공개 공시 요약",
        }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "다시 시도" })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
