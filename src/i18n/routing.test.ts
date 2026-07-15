import { describe, expect, it } from "vitest";
import {
  localeSwitchHref,
  queryLocalizedPath,
  resolveRouteLocale,
} from "./routing";

describe("locale-aware routing", () => {
  it("uses the path locale before a conflicting query locale", () => {
    expect(resolveRouteLocale("/en/companies", "ko")).toBe("en");
  });

  it("uses the locale query for unprefixed app routes", () => {
    expect(resolveRouteLocale("/guru", "en")).toBe("en");
  });

  it("switches public pages with a locale path prefix", () => {
    expect(
      localeSwitchHref("en", "/ko/companies/AAPL", "tab=filings&locale=ko"),
    ).toBe("/en/companies/AAPL?tab=filings");
  });

  it("switches app pages with a locale query without inventing a route", () => {
    expect(
      localeSwitchHref("en", "/guru", "guru=buffett&ticker=AAPL"),
    ).toBe("/guru?guru=buffett&ticker=AAPL&locale=en");
    expect(
      localeSwitchHref(
        "ko",
        "/guru",
        "guru=buffett&ticker=AAPL&locale=en",
      ),
    ).toBe("/guru?guru=buffett&ticker=AAPL");
  });

  it("preserves the locale when navigating between app sections", () => {
    expect(queryLocalizedPath("en", "/watchlist")).toBe(
      "/watchlist?locale=en",
    );
    expect(queryLocalizedPath("ko", "/watchlist")).toBe("/watchlist");
  });
});
