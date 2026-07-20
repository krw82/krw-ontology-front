import { describe, expect, it } from "vitest";
import {
  buildAnalyticsPageProperties,
  isPublicMarketingPath,
  pageTypeFromPath,
  sanitizeAnalyticsLocationKey,
  sanitizeAnalyticsPath,
  sanitizeAnalyticsPathname,
  sanitizeAnalyticsReferrer,
  sanitizeAnalyticsSearchParams,
  tickerFromPathOrSearch,
} from "@/lib/analytics/page-context";

describe("analytics page context", () => {
  it("classifies marketing and app routes with stable page types", () => {
    expect(pageTypeFromPath("/")).toBe("home");
    expect(pageTypeFromPath("/companies")).toBe("companies_index");
    expect(pageTypeFromPath("/companies/AAPL")).toBe("company_detail");
    expect(pageTypeFromPath("/ko/companies")).toBe("companies_index");
    expect(pageTypeFromPath("/en/companies/AAPL")).toBe("company_detail");
    expect(pageTypeFromPath("/questions")).toBe("questions_index");
    expect(pageTypeFromPath("/questions/margin")).toBe("question_detail");
    expect(pageTypeFromPath("/refund")).toBe("legal");
    expect(pageTypeFromPath("/chat/new", "?ticker=AAPL")).toBe("chat_new");
    expect(pageTypeFromPath("/chat", "?sessionId=session-1")).toBe(
      "chat_session",
    );
  });

  it("marks public SEO routes without exposing authenticated app pages", () => {
    expect(isPublicMarketingPath("/companies/AAPL")).toBe(true);
    expect(isPublicMarketingPath("/ko/companies/AAPL")).toBe(true);
    expect(isPublicMarketingPath("/pricing")).toBe(true);
    expect(isPublicMarketingPath("/refund")).toBe(true);
    expect(isPublicMarketingPath("/chat/new")).toBe(false);
    expect(isPublicMarketingPath("/settings")).toBe(false);
  });

  it("extracts ticker from company paths and chat query params", () => {
    expect(tickerFromPathOrSearch("/companies/aapl")).toBe("AAPL");
    expect(tickerFromPathOrSearch("/ko/companies/aapl")).toBe("AAPL");
    expect(tickerFromPathOrSearch("/chat/new", "?ticker=msft")).toBe("MSFT");
    expect(tickerFromPathOrSearch("/chat/new", "?ticker=bad ticker")).toBeNull();
    expect(tickerFromPathOrSearch("/companies/UNKNOWN")).toBeNull();
    expect(tickerFromPathOrSearch("/chat/new", "?ticker=unknown")).toBeNull();
  });

  it("builds standard page analytics properties", () => {
    expect(
      buildAnalyticsPageProperties("/chat/new", "?ticker=AAPL&query=test"),
    ).toEqual({
      page_path: "/chat/new",
      page_search: "?ticker=AAPL",
      page_type: "chat_new",
      is_public: false,
      ticker: "AAPL",
    });
  });

  it("redacts prompts, searches, identifiers, and tokens from analytics", () => {
    const raw = new URLSearchParams({
      ticker: "aapl",
      q: "private thesis search",
      query: "summarize my confidential note",
      sessionId: "session-secret",
      shareToken: "share-secret",
      filing_event_id: "event-secret",
      source: "bottom_tab",
    });

    expect(sanitizeAnalyticsSearchParams(raw).toString()).toBe(
      "ticker=AAPL&source=bottom_tab",
    );
    expect(
      sanitizeAnalyticsLocationKey(`/chat/new?${raw.toString()}`),
    ).toBe("/chat/new?ticker=AAPL&source=bottom_tab");
  });

  it("drops arbitrary values even from categorical keys", () => {
    expect(
      sanitizeAnalyticsSearchParams(
        "?source=private%20free-form%20text&entry=onboarding",
      ).toString(),
    ).toBe("entry=onboarding");
  });

  it("redacts raw paths and keeps only safe same-origin referrer state", () => {
    expect(
      sanitizeAnalyticsPath(
        "/chat/new?ticker=AAPL&query=private&sessionId=secret",
      ),
    ).toBe("/chat/new?ticker=AAPL");
    expect(
      sanitizeAnalyticsReferrer(
        "https://krwontology.com/chat/new?ticker=AAPL&query=private",
        "https://krwontology.com",
      ),
    ).toBe("/chat/new?ticker=AAPL");
    expect(
      sanitizeAnalyticsReferrer(
        "https://www.google.com/search?q=confidential+company",
        "https://krwontology.com",
      ),
    ).toBe("https://www.google.com");
  });

  it("redacts bearer credentials embedded in share paths everywhere", () => {
    const token = "a-private-share-token-1234567890";

    expect(sanitizeAnalyticsPathname(`/share/${token}`)).toBe(
      "/share/:token",
    );
    expect(sanitizeAnalyticsLocationKey(`/en/share/${token}?source=email`)).toBe(
      "/en/share/:token?source=email",
    );
    expect(
      sanitizeAnalyticsReferrer(
        `https://krwontology.com/share/${token}`,
        "https://krwontology.com",
      ),
    ).toBe("/share/:token");
    expect(buildAnalyticsPageProperties(`/share/${token}`, null)).toMatchObject({
      page_path: "/share/:token",
      page_type: "shared_answer",
    });
  });
});
