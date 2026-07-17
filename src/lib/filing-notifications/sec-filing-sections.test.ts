import { describe, expect, it } from "vitest";

import { parseSecFilingSections } from "./sec-filing-sections";

describe("parseSecFilingSections", () => {
  it("extracts 8-K Item sections and drops a duplicate table-of-contents item", () => {
    const parsed = parseSecFilingSections(
      `
        <html><body>
          <p>TABLE OF CONTENTS</p>
          <p>Item 2.02 Results of Operations and Financial Condition</p>
          <p>Item 5.02 Departure of Directors</p>
          <h2>Item 2.02 Results of Operations and Financial Condition</h2>
          <p>The company furnished its earnings release.</p>
          <p>Further detail for the actual filing body.</p>
          <h2>Item 5.02 Departure of Directors</h2>
          <p>A director resigned effective today.</p>
          <script>this must not appear</script>
        </body></html>
      `,
      { form: "8-K" },
    );

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]).toMatchObject({
      key: "item:2.02",
      kind: "sec_item",
      confidence: "exact",
    });
    expect(parsed.sections[0]?.text).toContain("actual filing body");
    expect(parsed.sections[1]?.key).toBe("item:5.02");
    expect(parsed.sections[1]?.text).not.toContain("this must not appear");
  });

  it("uses a primary-document fallback when an 8-K has no machine-readable Item heading", () => {
    const parsed = parseSecFilingSections("<p>A short filing without structured headings.</p>", { form: "8-K" });

    expect(parsed.sections).toEqual([
      expect.objectContaining({
        key: "document:primary",
        confidence: "fallback",
        text: "A short filing without structured headings.",
      }),
    ]);
  });

  it("extracts conservative uppercase 6-K document sections", () => {
    const parsed = parseSecFilingSections(
      `
        <h1>FINANCIAL RESULTS</h1>
        <p>Revenue increased year over year.</p>
        <h1>FORWARD-LOOKING STATEMENTS</h1>
        <p>Risks and uncertainties remain.</p>
      `,
      { form: "6-K" },
    );

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]).toMatchObject({
      kind: "document_section",
      heading: "FINANCIAL RESULTS",
      confidence: "heuristic",
    });
    expect(parsed.sections[1]?.heading).toBe("FORWARD-LOOKING STATEMENTS");
  });
});
