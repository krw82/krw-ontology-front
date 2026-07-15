import { describe, expect, it } from "vitest";

import { buildGuruLensHref } from "./guru-lenses";

describe("buildGuruLensHref", () => {
  it("preserves company context after an explicit guru is selected", () => {
    expect(buildGuruLensHref("buffett", "ko", "aapl")).toBe(
      "/guru?guru=buffett&ticker=AAPL",
    );
  });

  it("preserves both company context and a non-default locale", () => {
    expect(buildGuruLensHref("marks", "en", "MSFT")).toBe(
      "/guru?guru=marks&ticker=MSFT&locale=en",
    );
  });
});
