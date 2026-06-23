import { describe, expect, it } from "vitest";
import { buildBrandfetchTickerLogoUrl } from "./brandfetch-logo";

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
});
