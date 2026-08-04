import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULE_DIRECTORY = new URL(".", import.meta.url);

describe("agent_v1 product boundary", () => {
  it("does not reference the legacy Claude executor or runner", async () => {
    const files = (await readdir(MODULE_DIRECTORY))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => join(MODULE_DIRECTORY.pathname, name));
    files.push(
      new URL("../../worker/agent-v1-outbox-worker.ts", import.meta.url).pathname,
    );
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join(
      "\n",
    );

    expect(source.toLowerCase()).not.toContain("anthropic");
    expect(source.toLowerCase()).not.toContain("claude");
    expect(source).not.toContain("@/lib/agent/runner");
    expect(source).not.toContain("claim_agent_run");
  });
});
