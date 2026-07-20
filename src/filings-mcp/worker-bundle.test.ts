import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("standalone filings MCP worker bundle", () => {
  it("does not import Next request APIs", async () => {
    const result = await build({
      absWorkingDir: process.cwd(),
      entryPoints: ["src/worker/filings-mcp-server.ts"],
      bundle: true,
      format: "esm",
      packages: "external",
      platform: "node",
      target: "node20",
      alias: {
        "server-only": "./src/worker/server-only-shim.ts",
      },
      write: false,
    });

    const bundle = result.outputFiles[0]?.text ?? "";
    expect(bundle).not.toContain("next/headers");
  });
});
