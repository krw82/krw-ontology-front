import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const feedReader = vi.hoisted(() => ({
  getFeedItems: vi.fn(),
  listFeedItems: vi.fn(),
  getFeedContext: vi.fn(),
}));

vi.mock("./feed-reader", () => ({
  ...feedReader,
  KrwFeedReaderError: class KrwFeedReaderError extends Error {},
}));

import { KRW_FEED_MCP_TOOL_NAMES, createKrwFeedMcpServer } from "./server";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

describe("KRW feed MCP tool boundary", () => {
  it("exposes only the read-only feed tools", async () => {
    const client = await connectedClient();
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual(
      [...KRW_FEED_MCP_TOOL_NAMES].sort(),
    );
  });

  it("keeps selected issue order when building a feed context", async () => {
    feedReader.getFeedContext.mockResolvedValue({
      version: "krw-feed-context/v1",
      requested_issue_ids: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
      items: [],
      gaps: [],
    });
    const client = await connectedClient();
    const issueIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];

    const result = await client.callTool({
      name: "get_feed_context",
      arguments: { issue_ids: issueIds, tickers: ["NVDA", "AMD"] },
    });

    expect(feedReader.getFeedContext).toHaveBeenCalledWith({
      issueIds,
      tickers: ["NVDA", "AMD"],
      maxPostsPerIssue: undefined,
    });
    expect(readToolJson(result)).toMatchObject({ requested_issue_ids: issueIds });
  });

  it("enforces the bounded multi-issue input schema", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "get_feed_items",
      arguments: {
        issue_ids: Array.from({ length: 9 }, (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      },
    });

    expect(result.isError).toBe(true);
    expect(feedReader.getFeedItems).not.toHaveBeenCalled();
  });
});

async function connectedClient(): Promise<Client> {
  const server = createKrwFeedMcpServer();
  const client = new Client({ name: "krw-feed-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function readToolJson(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    throw new Error("Expected MCP content");
  }
  const text = (result.content as Array<{ type?: string; text?: string }>)
    .find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Expected JSON text MCP content");
  return JSON.parse(text) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
