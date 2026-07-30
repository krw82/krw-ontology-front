import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import {
  KrwFeedReaderError,
  getFeedContext,
  getFeedItems,
  listFeedItems,
} from "./feed-reader";

const ISSUE_ID_SCHEMA = z.string().uuid().describe("UUID of a published KRW market-feed issue.");
const TICKER_SCHEMA = z.string().min(1).max(16).describe("US ticker symbol, for example NVDA or BRK.B.");

export const KRW_FEED_MCP_TOOL_NAMES = [
  "get_feed_items",
  "list_feed_items",
  "get_feed_context",
] as const;

export type KrwFeedMcpToolName = typeof KRW_FEED_MCP_TOOL_NAMES[number];

export function createKrwFeedMcpServer(): McpServer {
  const server = new McpServer({
    name: "krw-feed",
    version: process.env.npm_package_version ?? "0.1.0",
  });

  server.registerTool("get_feed_items", {
    title: "Get published KRW feed items",
    description: "Returns exact published X-based market-feed items by issue ID. It reads only the reviewed public feed and never records user activity.",
    inputSchema: {
      issue_ids: z.array(ISSUE_ID_SCHEMA).min(1).max(8).describe("One to eight issue IDs selected from the KRW feed."),
      include_sources: z.boolean().optional().describe("Include up to two bounded source posts for each returned issue. Defaults to false."),
    },
  }, async ({ issue_ids, include_sources }) => toolResult(() => getFeedItems({
    issueIds: issue_ids,
    includeSources: include_sources,
  })));

  server.registerTool("list_feed_items", {
    title: "List published KRW feed items",
    description: "Lists reviewed X-based market-feed items, optionally limited to up to five tickers. This is database retrieval, not a web or X search.",
    inputSchema: {
      tickers: z.array(TICKER_SCHEMA).max(5).optional().describe("Optional ticker filter. Matching issues may include multiple companies."),
      published_after: z.string().datetime().optional().describe("Optional ISO-8601 lower bound for publication time."),
      limit: z.number().int().min(1).max(20).optional().describe("Maximum item count. Defaults to 10."),
      cursor: z.string().regex(/^\d{1,6}$/).optional().describe("Opaque offset cursor returned by a previous call."),
    },
  }, async ({ tickers, published_after, limit, cursor }) => toolResult(() => listFeedItems({
    tickers,
    publishedAfter: published_after,
    limit,
    cursor,
  })));

  server.registerTool("get_feed_context", {
    title: "Build a multi-issue feed research context",
    description: "Builds one deterministic context from up to eight selected published feed issues and up to five tickers. It preserves the requested issue order and reports unavailable items explicitly.",
    inputSchema: {
      issue_ids: z.array(ISSUE_ID_SCHEMA).min(1).max(8).describe("Selected feed issue IDs in the order the user chose them."),
      tickers: z.array(TICKER_SCHEMA).max(5).optional().describe("Optional companies to emphasize in the context."),
      max_posts_per_issue: z.number().int().min(1).max(3).optional().describe("Bounded X source posts per issue. Defaults to two."),
    },
  }, async ({ issue_ids, tickers, max_posts_per_issue }) => toolResult(() => getFeedContext({
    issueIds: issue_ids,
    tickers,
    maxPostsPerIssue: max_posts_per_issue,
  })));

  return server;
}

async function toolResult<T>(operation: () => Promise<T>) {
  try {
    const result = await operation();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (error) {
    const code = error instanceof KrwFeedReaderError ? error.code : "feed_tool_failed";
    const message = error instanceof Error ? error.message : "Feed tool failed";
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
      isError: true,
    };
  }
}
