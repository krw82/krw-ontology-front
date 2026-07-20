import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const scriptPath = join(repoRoot, "scripts", "desktop-live-stack.mjs");
const packageJsonPath = join(repoRoot, "package.json");

describe("desktop live stack script", () => {
  it("is wired into package scripts and starts with preflight checks", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const script = readFileSync(scriptPath, "utf8");

    expect(packageJson.scripts["desktop:live:stack"]).toBe(
      "node scripts/desktop-live-stack.mjs",
    );
    expect(script).toContain("scripts/desktop-live-preflight.mjs");
    expect(script).toContain("npm");
    expect(script).toContain("build:llm-gateway");
    expect(script).toContain(".services/llm-gateway.mjs");
  });

  it("passes preflight-only mode without printing secret values", () => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--preflight-only",
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
    expect(result.stdout).toContain("\"service\": \"krw-desktop-live-preflight\"");
    expect(result.stdout).not.toContain("service-role-secret");
    expect(result.stdout).not.toContain("deepseek-secret");
    expect(result.stdout).not.toContain("0123456789abcdef0123456789abcdef");
  }, 20_000);

  it("fails before startup when DeepSeek credentials are missing", () => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--preflight-only",
        "--skip-ontology-mcp",
        "--no-next-env",
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
        } as NodeJS.ProcessEnv,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Missing required env: DEEPSEEK_API_KEY");
  });

  it("documents the Desktop stack flags", () => {
    const result = spawnSync(process.execPath, [scriptPath, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("desktop-live-stack.mjs");
    expect(result.stdout).toContain("--gateway-port PORT");
    expect(result.stdout).toContain("--require-ontology-mcp");
    expect(result.stdout).toContain("--preflight-only");
  });
});
