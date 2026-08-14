import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolute));
    else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

describe("KRW-AI Agent SDK removal", () => {
  it("does not ship or declare the retired frontend SDK", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };
    const packageLock = JSON.parse(
      readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"),
    ) as {
      packages?: Record<
        string,
        {
          version?: string;
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        }
      >;
    };

    expect(packageJson.dependencies?.["@anthropic-ai/claude-agent-sdk"]).toBeUndefined();
    expect(packageLock.packages?.[""]?.dependencies?.["@anthropic-ai/claude-agent-sdk"]).toBeUndefined();
    expect(packageLock.packages?.["node_modules/@anthropic-ai/claude-agent-sdk"]).toBeUndefined();
    expect(
      Object.keys(packageLock.packages ?? {}).some((name) =>
        name.includes("@anthropic-ai/claude-agent-sdk"),
      ),
    ).toBe(false);
  });

  it("does not import the retired SDK from active frontend source", () => {
    const sdkImport = /(?:from\s+|import\s*\(|require\s*\()(['"])@anthropic-ai\/claude-agent-sdk\1/;
    for (const file of sourceFiles(path.join(repoRoot, "src"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(sdkImport);
    }
  });
});
