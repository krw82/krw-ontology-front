import { describe, expect, it } from "vitest";
import {
  buildAnalyticsPageProperties,
  isPublicMarketingPath,
  pageTypeFromPath,
  tickerFromPathOrSearch,
} from "@/lib/analytics/page-context";

describe("analytics page context", () => {
  it("classifies marketing and app routes with stable page types", () => {
    expect(pageTypeFromPath("/")).toBe("home");
    expect(pageTypeFromPath("/companies")).toBe("companies_index");
    expect(pageTypeFromPath("/companies/AAPL")).toBe("company_detail");
    expect(pageTypeFromPath("/questions")).toBe("questions_index");
    expect(pageTypeFromPath("/questions/margin")).toBe("question_detail");
    expect(pageTypeFromPath("/chat/new", "?ticker=AAPL")).toBe("chat_new");
    expect(pageTypeFromPath("/chat", "?sessionId=session-1")).toBe(
      "chat_session",
    );
  });

  it("marks public SEO routes without exposing authenticated app pages", () => {
    expect(isPublicMarketingPath("/companies/AAPL")).toBe(true);
    expect(isPublicMarketingPath("/pricing")).toBe(true);
    expect(isPublicMarketingPath("/chat/new")).toBe(false);
    expect(isPublicMarketingPath("/settings")).toBe(false);
  });

  it("extracts ticker from company paths and chat query params", () => {
    expect(tickerFromPathOrSearch("/companies/aapl")).toBe("AAPL");
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
      page_search: "?ticker=AAPL&query=test",
      page_type: "chat_new",
      is_public: false,
      ticker: "AAPL",
    });
  });
});
