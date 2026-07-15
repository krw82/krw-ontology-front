import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

describe("Pulse no-LLM boundary", () => {
  it("does not import agent, model, gateway, or credit-reservation code", () => {
    const root = join(process.cwd(), "src/lib/pulse");
    const source = sourceFiles(root).map((path) => readFileSync(path, "utf8")).join("\n");
    for (const forbidden of [
      "@/lib/agent/",
      "llm-gateway",
      "anthropic",
      "openai",
      "reserveAnalysis",
      "reserveCredit",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("keeps the question CTA as a draft URL and never submits a run", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/pulse/sources/questions.ts"), "utf8");
    expect(source).toContain("/chat/new?");
    expect(source).not.toContain("/api/chat/run");
    expect(source).not.toContain("question_submitted");
  });
});
