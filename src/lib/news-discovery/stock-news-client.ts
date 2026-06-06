import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StockNewsMCPToolName } from "@/types/api-contracts";

export type StockNewsToolArguments = Record<string, unknown>;

export function getStockNewsMcpUrl(): string {
  return (
    process.env.STOCK_NEWS_MCP_URL ??
    (process.env.NODE_ENV === "production"
      ? "http://127.0.0.1:8775/mcp"
      : "http://127.0.0.1:8776/mcp")
  );
}

export async function callStockNewsTool<T = unknown>(
  toolName: StockNewsMCPToolName,
  args: StockNewsToolArguments,
): Promise<T> {
  const client = new Client({
    name: "krw-ontology-web-news-discovery",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(getStockNewsMcpUrl()),
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return parseToolResult<T>(result);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function resolveNewsEntities(args: {
  question?: string;
  tickers?: string[];
  companies?: string[];
}) {
  return callStockNewsTool<Record<string, unknown>>("resolve_news_entities", args);
}

export async function searchCompanyNewsEvents(args: {
  question?: string;
  ticker?: string;
  company?: string;
  lookback_hours?: number;
  max_events?: number;
  mode?: "market_narrative_discovery";
  exclude_official_sources?: boolean;
  price_move_direction?: "down" | "up" | "unknown";
}) {
  return callStockNewsTool<Record<string, unknown>>(
    "search_company_news_events",
    args,
  );
}

export async function searchMarketNewsEvents(args: {
  question: string;
  lookback_hours?: number;
  max_events?: number;
  mode?: "market_narrative_discovery";
  exclude_official_sources?: boolean;
  price_move_direction?: "down" | "up" | "unknown";
}) {
  return callStockNewsTool<Record<string, unknown>>(
    "search_market_news_events",
    args,
  );
}

export async function readNewsSources(args: { urls: string[] }) {
  return callStockNewsTool<Record<string, unknown>>("read_news_sources", args);
}

function parseToolResult<T>(result: unknown): T {
  if (isRecord(result) && isRecord(result.structuredContent)) {
    return result.structuredContent as T;
  }

  if (isRecord(result) && "toolResult" in result) {
    return result.toolResult as T;
  }

  if (isRecord(result) && Array.isArray(result.content)) {
    const text = result.content
      .map((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("\n")
      .trim();
    if (text) {
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }
  }

  return result as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
