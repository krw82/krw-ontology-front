import { afterEach, describe, expect, it, vi } from "vitest";
import { getStockNewsMcpUrl } from "./stock-news-client";

describe("getStockNewsMcpUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the configured Stock News MCP URL", () => {
    vi.stubEnv("STOCK_NEWS_MCP_URL", "http://127.0.0.1:9999/mcp");

    expect(getStockNewsMcpUrl()).toBe("http://127.0.0.1:9999/mcp");
  });

  it("uses the dev port by default outside production", () => {
    vi.stubEnv("STOCK_NEWS_MCP_URL", undefined);
    vi.stubEnv("NODE_ENV", "development");

    expect(getStockNewsMcpUrl()).toBe("http://127.0.0.1:8776/mcp");
  });

  it("uses the production port by default in production", () => {
    vi.stubEnv("STOCK_NEWS_MCP_URL", undefined);
    vi.stubEnv("NODE_ENV", "production");

    expect(getStockNewsMcpUrl()).toBe("http://127.0.0.1:8775/mcp");
  });
});
