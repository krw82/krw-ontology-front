import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  MarketMoveEventCandidate,
  YahooFinanceSnapshot,
} from "@/lib/market-move/types";

export const DEFAULT_YAHOO_FINANCE_MCP_ARGS = [
  "--from",
  "git+https://github.com/Alex2Yang97/yahoo-finance-mcp",
  "yahoo-finance-mcp",
];
export const DEFAULT_YAHOO_FINANCE_MCP_TIMEOUT_MS = 20_000;

export async function fetchYahooFinanceSnapshot(
  ticker: string,
): Promise<YahooFinanceSnapshot> {
  const client = new Client({
    name: "krw-ontology-market-move-provider",
    version: "0.1.0",
  });
  const transport = createYahooFinanceTransport();

  try {
    await client.connect(transport);
    const stockInfo = parseJsonObject(
      await callYahooTool(client, "get_stock_info", { ticker }),
    );
    const historicalPrices = parseJsonArray(
      await callYahooTool(client, "get_historical_stock_prices", {
        ticker,
        period: "5d",
        interval: "1d",
      }),
    );
    const newsText = stringFromToolResult(
      await callYahooTool(client, "get_yahoo_finance_news", { ticker }),
    );

    return {
      stockInfo,
      historicalPrices,
      news: parseYahooNewsText(newsText),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function fetchYahooFinanceNews(
  ticker: string,
): Promise<MarketMoveEventCandidate[]> {
  const client = new Client({
    name: "krw-ontology-news-provider",
    version: "0.1.0",
  });
  const transport = createYahooFinanceTransport();

  try {
    await client.connect(transport);
    const newsText = stringFromToolResult(
      await callYahooTool(client, "get_yahoo_finance_news", { ticker }),
    );
    return parseYahooNewsText(newsText);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function fetchYahooFinanceStockInfo(
  ticker: string,
): Promise<Record<string, unknown>> {
  const client = new Client({
    name: "krw-ontology-news-provider",
    version: "0.1.0",
  });
  const transport = createYahooFinanceTransport();

  try {
    await client.connect(transport);
    return parseJsonObject(
      await callYahooTool(client, "get_stock_info", { ticker }),
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

function createYahooFinanceTransport(): Transport {
  const url = process.env.YAHOO_FINANCE_MCP_URL?.trim();
  if (url) {
    return new StreamableHTTPClientTransport(new URL(url));
  }

  return new StdioClientTransport({
    command: process.env.YAHOO_FINANCE_MCP_COMMAND?.trim() || "uvx",
    args: getYahooFinanceMcpArgs(),
    stderr: "pipe",
  });
}

export function getYahooFinanceMcpArgs(): string[] {
  const raw = process.env.YAHOO_FINANCE_MCP_ARGS?.trim();
  if (!raw) return DEFAULT_YAHOO_FINANCE_MCP_ARGS;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to shell-like splitting for simple env overrides.
  }

  return raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) =>
    part.replace(/^["']|["']$/g, ""),
  ) ?? DEFAULT_YAHOO_FINANCE_MCP_ARGS;
}

async function callYahooTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const timeout = Number(process.env.YAHOO_FINANCE_MCP_TIMEOUT_MS);
  return client.callTool(
    {
      name,
      arguments: args,
    },
    undefined,
    {
      timeout: Number.isFinite(timeout) && timeout > 0
        ? timeout
        : DEFAULT_YAHOO_FINANCE_MCP_TIMEOUT_MS,
    },
  );
}

function parseJsonObject(result: unknown): Record<string, unknown> {
  const text = stringFromToolResult(result);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(result: unknown): Array<Record<string, unknown>> {
  const text = stringFromToolResult(result);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
  } catch {
    return [];
  }
}

function stringFromToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (isRecord(result) && Array.isArray(result.content)) {
    return result.content
      .map((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("\n")
      .trim();
  }
  if (isRecord(result) && typeof result.structuredContent === "string") {
    return result.structuredContent;
  }
  return "";
}

function parseYahooNewsText(text: string): MarketMoveEventCandidate[] {
  if (!text || /^no news found/i.test(text) || /^error:/i.test(text)) return [];

  return text
    .split(/\n\s*\n/g)
    .map((block) => parseYahooNewsBlock(block))
    .filter((item): item is MarketMoveEventCandidate => Boolean(item))
    .slice(0, 8);
}

function parseYahooNewsBlock(block: string): MarketMoveEventCandidate | null {
  const title = lineValue(block, "Title");
  if (!title) return null;
  const summary = lineValue(block, "Summary");
  const description = lineValue(block, "Description");
  const url = lineValue(block, "URL");

  return {
    title,
    summary,
    description,
    url,
    source_domain: url ? safeDomain(url) : null,
    published_at: null,
    relevance_note:
      "Yahoo Finance recent ticker news candidate for explaining the observed share-price move.",
  };
}

function lineValue(block: string, label: string): string | null {
  const match = block.match(new RegExp(`^${label}:\\s*(.*)$`, "im"));
  const value = match?.[1]?.trim();
  return value || null;
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
