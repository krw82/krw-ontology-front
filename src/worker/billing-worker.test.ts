import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/worker/billing-worker.ts"),
  "utf8",
);

describe("billing worker coverage reconciliation", () => {
  it("sweeps time-expired coverage after provider renewal or grace resolution", () => {
    expect(source).toContain('"sweep_expired_company_coverage_limits"');
    const sweepCall = source.indexOf(
      "await reconcileExpiredCoverageLimits()",
    );
    const renewalCall = source.indexOf("await renewDueTossSubscriptions");
    expect(sweepCall).toBeGreaterThan(-1);
    expect(sweepCall).toBeGreaterThan(renewalCall);
  });
});
