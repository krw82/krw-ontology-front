import { describe, expect, it } from "vitest";
import {
  isExactCompanyPrompt,
  isFirstEvidenceEntry,
  onboardingCompaniesHref,
  startChatHref,
  startCompanyChatHref,
  startCompanyHref,
} from "./start-flow";

describe("start onboarding flow", () => {
  it("builds a localized company-first evidence route", () => {
    expect(startCompanyHref("ko", " aapl ")).toBe(
      "/ko/companies/AAPL?entry=onboarding_v2",
    );
    expect(startCompanyHref("en", "not a ticker")).toBeNull();
  });

  it("keeps a selected company on the question route", () => {
    expect(
      startChatHref({
        locale: "en",
        ticker: "MSFT",
        question: " What changed in the latest filing? ",
      }),
    ).toBe(
      "/chat/new?query=What+changed+in+the+latest+filing%3F&entry=onboarding_v2&ticker=MSFT&locale=en",
    );
  });

  it("opens a selected company directly in its chat context", () => {
    expect(startCompanyChatHref("ko", " aapl ")).toBe(
      "/chat/new?ticker=AAPL&entry=onboarding_v2",
    );
    expect(startCompanyChatHref("en", "msft")).toBe(
      "/chat/new?ticker=MSFT&entry=onboarding_v2&locale=en",
    );
    expect(onboardingCompaniesHref("ko")).toBe(
      "/ko/companies?entry=onboarding_v2",
    );
  });

  it("only treats an exact company label as company-only input", () => {
    const apple = { ticker: "AAPL", name: "Apple Inc.", companyNameKo: "애플" };
    expect(isExactCompanyPrompt("애플", apple)).toBe(true);
    expect(isExactCompanyPrompt("Apple Inc.", apple)).toBe(true);
    expect(isExactCompanyPrompt("애플 최근 실적", apple)).toBe(false);
  });

  it("keeps the previous first-value entry compatible", () => {
    expect(isFirstEvidenceEntry("first_value")).toBe(true);
    expect(isFirstEvidenceEntry("onboarding_v2")).toBe(true);
    expect(isFirstEvidenceEntry("other")).toBe(false);
  });
});
