import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const deployWebPath = join(repoRoot, "scripts", "deploy-web-production.sh");

describe("sealed prepared-release publication lifecycle", () => {
  it("requires an explicit sealed lifecycle mode before any external command", () => {
    const result = spawnSync("/bin/sh", [deployWebPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "Choose one explicit sealed prepared-release deployment mode.",
    );
  });

  it("separates release-local preparation from global publication and abandonment", () => {
    const source = readFileSync(deployWebPath, "utf8");
    const lifecycleBranch = source.indexOf(
      'if is_prepared_lifecycle_mode; then',
    );
    const publishMutation = source.indexOf("GLOBAL_MARKER_TMP=", lifecycleBranch);
    const localPrepareBranch = source.lastIndexOf(
      "if [ '$DEPLOY_MODE' = 'prepare-only' ]; then",
    );
    const localPrepareComplete = source.indexOf(
      "Prepared release-local web image registry:",
      localPrepareBranch,
    );

    expect(lifecycleBranch).toBeGreaterThan(-1);
    expect(publishMutation).toBeGreaterThan(lifecycleBranch);
    expect(localPrepareBranch).toBeGreaterThan(publishMutation);
    expect(localPrepareComplete).toBeGreaterThan(localPrepareBranch);
    expect(
      source.slice(localPrepareBranch, localPrepareComplete),
    ).not.toContain("GLOBAL_MARKER_TMP");
    expect(source).toContain("--publish-prepared");
    expect(source).toContain("--abandon-prepared");
    expect(source).toContain(
      '"\\$PREPARED_MARKER" "\\$RELEASE_ABANDONED_MARKER" "\\$MARKER_SHA256" 400',
    );
    expect(source).toContain("An activated release cannot be abandoned.");
    expect(source).toContain(
      "sealed durability input must be a regular file",
    );
    expect(source).toContain('"\\$REMOTE_FRONT_DIR/.deploy"');
    expect(source).toContain("const bottomUp = [...directories].sort");
    expect(source).toContain(
      "sealed durability ancestor must be a regular directory",
    );
    expect(source).toContain(
      "Reverse proxy must bind the exact live Caddyfile read-only at /etc/caddy/Caddyfile.",
    );
    expect(source).toContain(
      "Archived rollback Caddyfile differs from the exact live bind source.",
    );
    expect(source).toContain("CADDYFILE_SHA256");
    expect(source).toContain(
      "Archived rollback Caddyfile no longer matches its sealed identity.",
    );
  });
});
