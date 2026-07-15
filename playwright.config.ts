import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3210);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  // All projects share one cold Next.js webpack dev server. Serial execution
  // avoids concurrent route compilation corrupting transient manifest reads.
  workers: 1,
  // Next.js streams the shell before cold dev-route compilation completes.
  // Keep assertions web-first while allowing the first route in a project to
  // finish compiling on slower local and CI runners.
  timeout: 90_000,
  expect: {
    timeout: 20_000,
  },
  reporter: [["list"], ["html", { outputFolder: "output/playwright-report", open: "never" }]],
  outputDir: "output/playwright-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: `rm -rf .next-e2e && DEV_AUTH_BYPASS=1 KRW_E2E_STATIC_CATALOG=1 NEXT_DIST_DIR=.next-e2e npm run dev:web -- --hostname 127.0.0.1 --port ${port} --webpack`,
        // Use the first protected page as the readiness probe so both its
        // server and client bundles are compiled before the test clock starts.
        url: `${baseURL}/companies`,
        reuseExistingServer,
        timeout: 180_000,
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
