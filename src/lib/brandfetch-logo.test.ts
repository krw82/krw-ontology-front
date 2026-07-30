import { describe, expect, it } from "vitest";
import {
  buildBrandfetchTickerLogoUrl,
  buildCompanyTickerLogoUrl,
} from "./brandfetch-logo";

describe("brandfetch logo URL", () => {
  it("builds an explicit ticker logo URL", () => {
    expect(
      buildBrandfetchTickerLogoUrl("aapl", {
        clientId: "client id",
        size: 80,
      }),
    ).toBe(
      "https://cdn.brandfetch.io/ticker/AAPL/w/80/h/80/fallback/404/type/icon?c=client%20id",
    );
  });

  it("does not build a URL without a client id or safe ticker", () => {
    expect(
      buildBrandfetchTickerLogoUrl("AAPL", {
        clientId: "",
      }),
    ).toBeNull();
    expect(
      buildBrandfetchTickerLogoUrl("../AAPL", {
        clientId: "client-id",
      }),
    ).toBeNull();
  });

  it("prefers a verified project asset when one is available", () => {
    const tickers = [
      "aapl",
      "amzn",
      "cvx",
      "jnj",
      "meta",
      "msft",
      "nvda",
      "tsla",
      "xom",
    ] as const;
    const expected = {
      aapl: "/company-logos/AAPL.png",
      amzn: "/company-logos/AMZN.png",
      cvx: "/company-logos/CVX.png",
      jnj: "/company-logos/JNJ.png",
      meta: "/company-logos/META.png",
      msft: "/company-logos/MSFT.png",
      nvda: "/company-logos/nvda.svg",
      tsla: "/company-logos/TSLA.png",
      xom: "/company-logos/XOM.png",
    } as const;

    tickers.forEach((ticker) => {
      expect(buildCompanyTickerLogoUrl(ticker, { clientId: "client-id", size: 80 })).toBe(
        expected[ticker],
      );
    });
  });
});
