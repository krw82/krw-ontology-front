import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Desktop contract validator", () => {
  it("rejects a fixture that violates its matching schema", () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "desktop-contracts-invalid-"),
    );
    temporaryRoots.push(temporaryRoot);
    const contractRoot = path.join(temporaryRoot, "v1");
    cpSync("contracts/desktop/v1", contractRoot, { recursive: true });

    const fixturePath = path.join(
      contractRoot,
      "fixtures",
      "company-catalog.success.json",
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      data: { companies: Array<Record<string, unknown>> };
    };
    fixture.data.companies[0].unexpected_field = true;
    writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

    const result = spawnSync(
      process.execPath,
      ["scripts/verify-desktop-contracts.mjs"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKTOP_CONTRACTS_ROOT: contractRoot,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("schema validation failed");
    expect(result.stderr).toContain("must NOT have unevaluated properties");
  });
});
