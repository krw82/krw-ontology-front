import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("production canary provisioner", () => {
  it("plans an operator-owned canary account without calling Supabase", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "krw-canary-provisioner-"));
    const envFile = path.join(directory, "operator.env");
    await writeFile(envFile, [
      "SUPABASE_URL=https://example.supabase.co",
      "SUPABASE_ANON_KEY=anon-key",
      "SUPABASE_SERVICE_ROLE_KEY=service-role-key",
      "NEXT_PUBLIC_APP_URL=https://krwontology.com",
      "read_env_value() { python3 -; }",
      "export UNUSED_RUNTIME_KEY=ignored-by-provisioner",
      "",
    ].join("\n"));
    const { stdout } = await execFileAsync("node", [
      "scripts/provision-krw-agent-production-canary.mjs",
      "--dry-run",
      "--env-file", envFile,
      "--email", "agent-canary@krwontology.com",
      "--state-file", path.join(directory, "state.json"),
      "--e2e-env-file", path.join(directory, "e2e.env"),
    ], { cwd: process.cwd() });
    const value = JSON.parse(stdout);
    expect(value.status).toBe("planned");
    expect(value.will_create_or_reuse_tagged_account).toBe(true);
    expect(value.will_provision_internal_entitlement).toBe(true);
  });
});
