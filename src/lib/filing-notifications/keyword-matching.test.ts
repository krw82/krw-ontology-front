import { describe, expect, it } from "vitest";
import { findFilingKeywordMatches, toSearchableText } from "./keyword-matching";

describe("filing keyword matching", () => {
  it("matches case-insensitively and saves only short, text-safe context", () => {
    const matches = findFilingKeywordMatches("<article><script>ignore guidance</script><p>Our revised GUIDANCE now reflects liquidity needs.</p></article>", [{ id: "rule", userId: "user", phrase: "guidance" }]);
    expect(matches).toEqual([{ id: "rule", userId: "user", phrase: "guidance", matchedContext: "Our revised GUIDANCE now reflects liquidity needs." }]);
  });

  it("removes markup before matching", () => {
    expect(toSearchableText("<h1>Going <em>Concern</em></h1>")).toBe("Going Concern");
  });
});
