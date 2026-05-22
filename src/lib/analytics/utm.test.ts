import { describe, expect, it } from "vitest";
import {
  ANALYTICS_ANONYMOUS_ID_COOKIE,
  ANALYTICS_UTM_COOKIE,
  extractUtmContext,
  getAnonymousIdFromCookieHeader,
  getUtmContextFromCookieHeader,
  mergeUtmContext,
  parseUtmContext,
  serializeUtmContext,
} from "@/lib/analytics/utm";

describe("UTM helpers", () => {
  it("extracts supported UTM parameters only", () => {
    const context = extractUtmContext(
      new URLSearchParams(
        "utm_source=naver&utm_medium=search&utm_campaign=launch&ignored=1",
      ),
    );

    expect(context).toEqual({
      utm_source: "naver",
      utm_medium: "search",
      utm_campaign: "launch",
    });
  });

  it("keeps first-touch UTM values when merging later visits", () => {
    expect(
      mergeUtmContext(
        { utm_source: "naver", utm_campaign: "first" },
        { utm_source: "google", utm_medium: "paid" },
      ),
    ).toEqual({
      utm_source: "naver",
      utm_campaign: "first",
      utm_medium: "paid",
    });
  });

  it("round-trips UTM context through the cookie representation", () => {
    const serialized = serializeUtmContext({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "beta launch",
    });

    expect(parseUtmContext(serialized)).toEqual({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "beta launch",
    });
  });

  it("reads anonymous and UTM context from a cookie header", () => {
    const cookieHeader = [
      `${ANALYTICS_ANONYMOUS_ID_COOKIE}=anon-123`,
      `${ANALYTICS_UTM_COOKIE}=utm_source%3Dnaver%26utm_medium%3Dsearch`,
    ].join("; ");

    expect(getAnonymousIdFromCookieHeader(cookieHeader)).toBe("anon-123");
    expect(getUtmContextFromCookieHeader(cookieHeader)).toEqual({
      utm_source: "naver",
      utm_medium: "search",
    });
  });
});
