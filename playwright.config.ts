import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3210);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  // Run release gates serially against an optimized build. Next development
  // compilation is intentionally excluded because route-on-demand manifests
  // and HMR are not part of the deployed product lifecycle.
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 20_000,
  },
  reporter: [["list"], ["html", { outputFolder: "output/playwright-report", open: "never" }]],
  outputDir: "output/playwright-results",
  use: {
    baseURL,
    // App-flow tests do not need a service worker. Keeping it blocked avoids
    // update/reload work leaking into unrelated hydration assertions; the PWA
    // lifecycle spec opts back in explicitly.
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: "node scripts/run-e2e-production-server.mjs",
        url: `${baseURL}/api/healthz`,
        reuseExistingServer,
        timeout: 240_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
