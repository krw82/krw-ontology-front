import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./src/worker/server-only-shim.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "services/**/*.test.ts"],
    // The production gate runs from an isolated npm-ci checkout on a
    // many-core Mac Studio. Letting Vitest fork one worker per available core
    // can exhaust the process/memory envelope while shell-heavy cutover tests
    // are running, which presents as unrelated workers exiting during
    // teardown. Four workers keeps the gate deterministic without serializing
    // the suite.
    maxWorkers: 4,
  },
});
