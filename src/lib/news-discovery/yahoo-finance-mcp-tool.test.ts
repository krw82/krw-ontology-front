import { describe, expect, it, vi } from "vitest";
import { YAHOO_FINANCE_GET_STOCK_INFO_TOOL } from "./yahoo-finance-mcp-constants";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  fetchYahooFinanceNews: vi.fn(),
  fetchYahooFinanceStockInfo: vi.fn(),
  createSdkMcpServer: vi.fn((options: unknown) => options),
  tool: vi.fn(
    (
      name: string,
      description: string,
      schema: unknown,
      handler: (args: { ticker: string }) => Promise<unknown>,
    ) => ({
      name,
      description,
      schema,
      handler,
    }),
  ),
}));

vi.mock("@/lib/market-move/yahoo-finance-mcp-client", () => ({
  fetchYahooFinanceNews: mocks.fetchYahooFinanceNews,
  fetchYahooFinanceStockInfo: mocks.fetchYahooFinanceStockInfo,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: mocks.createSdkMcpServer,
  tool: mocks.tool,
}));

import { createYahooFinanceNewsMcpServer } from "./yahoo-finance-mcp-tool";

describe("createYahooFinanceNewsMcpServer", () => {
  it("filters valuation and consensus fields from get_stock_info output", async () => {
    mocks.fetchYahooFinanceStockInfo.mockResolvedValue({
      longName: "NVIDIA Corporation",
      currentPrice: 192.53,
      previousClose: 195.74,
      fiftyDayAverage: 210.086,
      forwardPE: 15.125293,
      pegRatio: 0.59,
      targetMeanPrice: 300.5862,
      recommendationKey: "strong_buy",
      numberOfAnalystOpinions: 58,
      earningsGrowth: 2.145,
      revenueGrowth: 0.852,
    });

    const server = createYahooFinanceNewsMcpServer() as unknown as {
      tools: Array<{
        name: string;
        description: string;
        handler: (args: { ticker: string }) => Promise<{
          content: Array<{ type: "text"; text: string }>;
          structuredContent: Record<string, unknown>;
        }>;
      }>;
    };
    const stockInfoTool = server.tools.find(
      (tool) => tool.name === YAHOO_FINANCE_GET_STOCK_INFO_TOOL,
    );

    expect(stockInfoTool?.description).toContain("Valuation");
    const result = await stockInfoTool?.handler({ ticker: "nvda" });
    const content = result?.content[0]?.text ?? "";
    const parsed = JSON.parse(content) as {
      ticker: string;
      stock_info: Record<string, unknown>;
    };
    const serializedStockInfo = JSON.stringify(parsed.stock_info);

    expect(parsed.ticker).toBe("NVDA");
    expect(parsed.stock_info).toMatchObject({
      schema_version: "safe-yahoo-stock-info/v1",
      identity: {
        longName: "NVIDIA Corporation",
      },
      quote: {
        currentPrice: 192.53,
        previousClose: 195.74,
      },
      technical: {
        fiftyDayAverage: 210.086,
      },
    });
    expect(serializedStockInfo).not.toContain("forwardPE");
    expect(serializedStockInfo).not.toContain("pegRatio");
    expect(serializedStockInfo).not.toContain("targetMeanPrice");
    expect(serializedStockInfo).not.toContain("recommendationKey");
    expect(serializedStockInfo).not.toContain("numberOfAnalystOpinions");
    expect(serializedStockInfo).not.toContain("earningsGrowth");
    expect(serializedStockInfo).not.toContain("revenueGrowth");
  });
});
