import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_NODE_SDK = "0.3.204";
const EXPECTED_PYTHON_SDK = "0.2.85";
const repoRoot = process.cwd();

describe("KRW-AI Agent SDK freeze", () => {
  it("pins the frontend SDK exactly instead of using semver ranges", () => {
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

    expect(packageJson.dependencies?.["@anthropic-ai/claude-agent-sdk"]).toBe(
      EXPECTED_NODE_SDK,
    );
    expect(
      packageLock.packages?.[""]?.dependencies?.[
        "@anthropic-ai/claude-agent-sdk"
      ],
    ).toBe(EXPECTED_NODE_SDK);
    expect(
      packageLock.packages?.["node_modules/@anthropic-ai/claude-agent-sdk"]
        ?.version,
    ).toBe(EXPECTED_NODE_SDK);

    const nativePackageVersions = Object.entries(
      packageLock.packages?.["node_modules/@anthropic-ai/claude-agent-sdk"]
        ?.optionalDependencies ?? {},
    )
      .filter(([name]) => name.startsWith("@anthropic-ai/claude-agent-sdk-"))
      .map(([, version]) => version);

    expect(nativePackageVersions.length).toBeGreaterThan(0);
    expect(new Set(nativePackageVersions)).toEqual(new Set([EXPECTED_NODE_SDK]));
  });

  it("pins the ontology Python SDK used by production MCP builds", () => {
    const ontologyPyproject = readFileSync(
      path.join(repoRoot, "krw-ontology", "pyproject.toml"),
      "utf8",
    );

    expect(ontologyPyproject).toContain(
      `"claude-agent-sdk==${EXPECTED_PYTHON_SDK}"`,
    );
  });
});
