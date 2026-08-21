import { describe, expect, it } from "vitest";
import { CONSOLE_SOURCES, consoleScript } from "./ResearchConsole";

describe("research console script", () => {
  it("runs three distinct scenarios per locale", () => {
    for (const locale of ["ko", "en"] as const) {
      const scenarios = consoleScript(locale);
      expect(scenarios).toHaveLength(3);
      const questions = scenarios.map((scenario) => scenario.question);
      expect(new Set(questions).size).toBe(3);
      for (const scenario of scenarios) {
        expect(scenario.question.length).toBeGreaterThan(4);
        expect(scenario.lines).toHaveLength(3);
        expect(scenario.verdict.length).toBeGreaterThan(2);
        for (const line of scenario.lines) expect(line.length).toBeGreaterThan(4);
      }
    }
  });

  it("uses the four product data sources as chips", () => {
    expect(CONSOLE_SOURCES).toHaveLength(4);
    for (const source of CONSOLE_SOURCES) {
      expect(source.labelKo.length).toBeGreaterThan(1);
      expect(source.labelEn.length).toBeGreaterThan(1);
      expect(source.icon.length).toBeGreaterThan(1);
    }
  });
});
