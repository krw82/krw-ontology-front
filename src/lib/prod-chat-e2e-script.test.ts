import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("production chat E2E script", () => {
  it("prints a dry-run plan without authenticating or calling production", async () => {
    const { stdout } = await execFileAsync(
      "node",
      [
        "scripts/run-prod-chat-e2e.mjs",
        "--dry-run",
        "--base-url",
        "https://krwontology.com",
        "--supabase-url",
        "https://example.supabase.co",
        "--supabase-anon-key",
        "test-anon-key",
        "--email",
        "e2e@example.com",
        "--password",
        "not-a-real-password",
        "--suite",
        "3q",
      ],
      { cwd: process.cwd() },
    );

    const parsed = JSON.parse(stdout);
    expect(parsed.message).toContain("Dry run");
    expect(parsed.plan.dry_run).toBe(true);
    expect(parsed.plan.cases).toHaveLength(3);
    expect(parsed.plan.email).toBe("e2e@example.com");
    expect(parsed.plan.password).not.toBe("not-a-real-password");
  });

  it("fails fast for unknown suites in dry-run mode", async () => {
    await expect(
      execFileAsync(
        "node",
        [
          "scripts/run-prod-chat-e2e.mjs",
          "--dry-run",
          "--suite",
          "unknown-suite",
        ],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Unknown suite"),
    });
  }, 20_000);
});
