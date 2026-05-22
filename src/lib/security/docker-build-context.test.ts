import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe(".dockerignore security exclusions", () => {
  it("keeps local secrets and automation state out of Docker build context", () => {
    const dockerignore = readFileSync(".dockerignore", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(dockerignore).toEqual(
      expect.arrayContaining([
        ".supabase-prod-db-password",
        ".codex/",
        ".playwright-cli/",
        ".playwright-mcp/",
        "output/",
        "/*.png",
      ]),
    );
  });
});
