import "server-only";

import {
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import {
  fetchYahooFinanceNews,
  fetchYahooFinanceStockInfo,
} from "@/lib/market-move/yahoo-finance-mcp-client";
import { normalizeTicker } from "@/lib/ontology/ticker";
import {
  YAHOO_FINANCE_GET_NEWS_TOOL,
  YAHOO_FINANCE_GET_STOCK_INFO_TOOL,
  YAHOO_FINANCE_MCP_SERVER_NAME,
} from "@/lib/news-discovery/yahoo-finance-mcp-constants";
import { buildSafeYahooStockInfo } from "@/lib/news-discovery/safe-yahoo-stock-info";

const TICKER_SCHEMA = z
  .string()
  .min(1)
  .max(16)
  .describe("US-listed ticker symbol, for example AAPL, NVDA, GOOGL.");

export function createYahooFinanceNewsMcpServer() {
  return createSdkMcpServer({
    name: YAHOO_FINANCE_MCP_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      tool(
        YAHOO_FINANCE_GET_NEWS_TOOL,
        [
          "Read recent Yahoo Finance news candidates for one ticker.",
          "Use this for first-pass current market-news and stock-move questions.",
          "Treat returned news as market reporting, not company-confirmed disclosure.",
        ].join(" "),
        {
          ticker: TICKER_SCHEMA,
        },
        async (args) => {
          const ticker = normalizeTicker(args.ticker);
          if (!ticker) return toolError("Invalid ticker.");

          try {
            const news = await fetchYahooFinanceNews(ticker);
            return toolJson({
              provider: "yahoo-finance-mcp",
              tool: YAHOO_FINANCE_GET_NEWS_TOOL,
              ticker,
              status: "ok",
              news,
            });
          } catch (error) {
            return toolJson({
              provider: "yahoo-finance-mcp",
              tool: YAHOO_FINANCE_GET_NEWS_TOOL,
              ticker,
              status: "unavailable",
              error: error instanceof Error ? error.message : String(error),
              news: [],
            });
          }
        },
        { alwaysLoad: true },
      ),
      tool(
        YAHOO_FINANCE_GET_STOCK_INFO_TOOL,
        [
          "Read safe Yahoo Finance stock metadata for one ticker.",
          "Use only to verify company/ticker context, quote context, trading range, moving averages, and broad size for first-pass news or stock-move answers.",
          "Valuation, analyst consensus, target price, recommendation, forward PE, PEG, and growth-estimate fields are intentionally excluded.",
        ].join(" "),
        {
          ticker: TICKER_SCHEMA,
        },
        async (args) => {
          const ticker = normalizeTicker(args.ticker);
          if (!ticker) return toolError("Invalid ticker.");

          try {
            const stockInfo = buildSafeYahooStockInfo(
              await fetchYahooFinanceStockInfo(ticker),
            );
            return toolJson({
              provider: "yahoo-finance-mcp",
              tool: YAHOO_FINANCE_GET_STOCK_INFO_TOOL,
              ticker,
              status: "ok",
              stock_info: stockInfo,
            });
          } catch (error) {
            return toolJson({
              provider: "yahoo-finance-mcp",
              tool: YAHOO_FINANCE_GET_STOCK_INFO_TOOL,
              ticker,
              status: "unavailable",
              error: error instanceof Error ? error.message : String(error),
              stock_info: {},
            });
          }
        },
        { alwaysLoad: true },
      ),
    ],
  });
}

function toolJson(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
