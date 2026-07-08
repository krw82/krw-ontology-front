import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

function makeGuruPluginSource() {
  const root = mkdtempSync(path.join(tmpdir(), "krw-guru-plugin-source-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(path.join(root, "skills", "krw-guru-buffett-advisor"), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "krw-guru-advisor" }),
  );
  writeFileSync(
    path.join(root, "skills", "krw-guru-buffett-advisor", "SKILL.md"),
    "# KRW Guru Buffett Advisor\n",
  );
  return root;
}

function makeOntologySource() {
  const root = mkdtempSync(path.join(tmpdir(), "krw-ontology-source-"));
  tempRoots.push(root);
  writeFileSync(path.join(root, "pyproject.toml"), "[project]\nname='test'\n");
  return root;
}

describe("materialize-guru-advisor-plugin", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) rmSync(root, { force: true, recursive: true });
    }
  });

  it("writes a guru-only MCP config that points at the selected release", () => {
    const source = makeGuruPluginSource();
    const ontologySource = makeOntologySource();
    const out = mkdtempSync(path.join(tmpdir(), "krw-guru-plugin-out-"));
    tempRoots.push(out);

    const stdout = execFileSync(
      process.execPath,
      [
        "scripts/materialize-guru-advisor-plugin.mjs",
        "--env",
        "prod",
        "--source",
        source,
        "--out",
        out,
        "--ontology-source-dir",
        ontologySource,
        "--guru-data-root",
        "/guru-data",
        "--guru-release-root",
        "/guru-data/releases/prod/current",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      },
    );

    const mcpConfig = JSON.parse(
      readFileSync(path.join(out, ".mcp.json"), "utf8"),
    ) as {
      mcpServers: Record<
        string,
        {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          type?: string;
          url?: string;
        }
      >;
    };

    expect(mcpConfig.mcpServers["krw-guru-advisor"]).toEqual({
      command: "uv",
      args: [
        "--directory",
        ontologySource,
        "run",
        "krw-guru-advisor-mcp",
      ],
      env: {
        KRW_GURU_ENV: "prod",
        KRW_GURU_DATA_ROOT: "/guru-data",
        KRW_GURU_RELEASE_ROOT: "/guru-data/releases/prod/current",
      },
    });
    expect(mcpConfig.mcpServers["krw-ontology-company"]).toBeUndefined();
    expect(stdout).toContain("Materialized prod KRW Guru Advisor plugin");
  });
});
