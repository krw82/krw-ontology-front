import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("standalone KRW feed MCP worker bundle", () => {
  it("does not import Next request APIs", async () => {
    const result = await build({
      absWorkingDir: process.cwd(),
      entryPoints: ["src/worker/krw-feed-mcp-server.ts"],
      bundle: true,
      format: "esm",
      packages: "external",
      platform: "node",
      target: "node20",
      alias: { "server-only": "./src/worker/server-only-shim.ts" },
      write: false,
    });

    expect(result.outputFiles[0]?.text ?? "").not.toContain("next/headers");
  });
});
