import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const scriptPath = join(repoRoot, "scripts", "desktop-live-preflight.mjs");
const packageJsonPath = join(repoRoot, "package.json");

describe("desktop live preflight script", () => {
  it("is wired into package scripts", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const script = readFileSync(scriptPath, "utf8");

    expect(packageJson.scripts["desktop:live:preflight"]).toBe(
      "node scripts/desktop-live-preflight.mjs",
    );
    expect(script).toContain("KRW_LLM_JOB_TOKEN_SECRET");
    expect(script).toContain("DEEPSEEK_API_KEY");
    expect(script).toContain("DESKTOP_LLM_GATEWAY_BASE_URL");
  });

  it("passes env-only checks without printing secret values", () => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--skip-gateway-health",
        "--skip-ontology-mcp",
        "--no-next-env",
        "--gateway-base-url",
        "http://127.0.0.1:8787/anthropic",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          NODE_ENV: "test",
          SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
          KRW_LLM_JOB_TOKEN_SECRET:
            "0123456789abcdef0123456789abcdef",
          DEEPSEEK_API_KEY: "deepseek-secret",
        } as NodeJS.ProcessEnv,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("\"ok\": true");
    expect(result.stdout).toContain("\"configured\": true");
    expect(result.stdout).not.toContain("service-role-secret");
    expect(result.stdout).not.toContain("deepseek-secret");
    expect(result.stdout).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("fails when required Desktop LLM gateway env is missing", () => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--skip-gateway-health",
        "--skip-ontology-mcp",
        "--no-next-env",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          NODE_ENV: "test",
        } as NodeJS.ProcessEnv,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Missing required env");
    expect(result.stdout).toContain("\"failed\": 4");
  });
});
