import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const personalReaderMocks = vi.hoisted(() => ({
  listOpenQuestions: vi.fn(),
}));

vi.mock("./personal-filing-reader", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    listOpenQuestions: personalReaderMocks.listOpenQuestions,
  };
});

import {
  createKrwFilingsMcpServer,
  KRW_FILINGS_MCP_TOOL_NAMES,
  KRW_PERSONAL_FILINGS_MCP_TOOL_NAMES,
} from "./server";
import {
  PERSONAL_MCP_LIST_MAX_LIMIT,
  PERSONAL_MCP_MAX_RESPONSE_BYTES,
  PERSONAL_MCP_MAX_RESPONSE_CHARS,
  PERSONAL_MCP_TIMELINE_MAX_LIMIT,
} from "./personal-filing-reader";

const closeCallbacks: Array<() => Promise<void>> = [];

beforeEach(() => {
  personalReaderMocks.listOpenQuestions.mockReset();
});

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

describe("KRW filings MCP tool boundary", () => {
  it("exposes only public/global filing tools without a user identity", async () => {
    const names = await listedToolNames(createKrwFilingsMcpServer());
    expect(names).toEqual([...KRW_FILINGS_MCP_TOOL_NAMES].sort());
  });

  it("adds private read tools only for an authenticated user context", async () => {
    const names = await listedToolNames(createKrwFilingsMcpServer({ userId: "user-1" }));
    expect(names).toEqual([
      ...KRW_FILINGS_MCP_TOOL_NAMES,
      ...KRW_PERSONAL_FILINGS_MCP_TOOL_NAMES,
    ].sort());
  });

  it("publishes the conservative personal list and timeline maxima", async () => {
    const client = await connectedClient(
      createKrwFilingsMcpServer({ userId: "user-1" }),
    );
    const result = await client.listTools();

    expect(limitMaximum(result.tools, "list_filing_judgments")).toBe(
      PERSONAL_MCP_LIST_MAX_LIMIT,
    );
    expect(limitMaximum(result.tools, "list_open_questions")).toBe(
      PERSONAL_MCP_LIST_MAX_LIMIT,
    );
    expect(limitMaximum(result.tools, "get_decision_timeline")).toBe(
      PERSONAL_MCP_TIMELINE_MAX_LIMIT,
    );
  });

  it("routes every personal success through the shared serialized response cap", async () => {
    personalReaderMocks.listOpenQuestions.mockResolvedValue({
      scope: "personal",
      ticker: null,
      items: Array.from({ length: 12 }, (_, index) => ({
        id: `question-${index}`,
        question: "한".repeat(12_000),
      })),
      pagination: { limit: 12, returned_count: 12, has_more: false },
      truncation: {
        fields_truncated: false,
        truncated_field_count: 0,
        response_truncated: false,
        dropped_item_count: 0,
        max_response_chars: PERSONAL_MCP_MAX_RESPONSE_CHARS,
        max_response_bytes: PERSONAL_MCP_MAX_RESPONSE_BYTES,
      },
    });
    const client = await connectedClient(
      createKrwFilingsMcpServer({ userId: "user-1" }),
    );

    const result = await client.callTool({
      name: "list_open_questions",
      arguments: { limit: PERSONAL_MCP_LIST_MAX_LIMIT },
    });
    const content = result.content as Array<{ type?: string; text?: string }>;
    const textContent = content.find((item) => item.type === "text");
    if (!textContent || typeof textContent.text !== "string") {
      throw new Error("Expected a text MCP result");
    }
    const parsed = JSON.parse(textContent.text) as {
      items: unknown[];
      pagination: { returned_count: number; has_more: boolean };
      truncation: { response_truncated: boolean; dropped_item_count: number };
    };

    expect(textContent.text.length).toBeLessThanOrEqual(
      PERSONAL_MCP_MAX_RESPONSE_CHARS,
    );
    expect(Buffer.byteLength(textContent.text, "utf8")).toBeLessThanOrEqual(
      PERSONAL_MCP_MAX_RESPONSE_BYTES,
    );
    expect(parsed.items.length).toBeLessThan(12);
    expect(parsed.pagination.returned_count).toBe(parsed.items.length);
    expect(parsed.pagination.has_more).toBe(true);
    expect(parsed.truncation.response_truncated).toBe(true);
    expect(parsed.truncation.dropped_item_count).toBeGreaterThan(0);
  });
});

async function listedToolNames(
  server: ReturnType<typeof createKrwFilingsMcpServer>,
): Promise<string[]> {
  const client = await connectedClient(server);
  const result = await client.listTools();
  return result.tools.map((tool) => tool.name).sort();
}

async function connectedClient(
  server: ReturnType<typeof createKrwFilingsMcpServer>,
): Promise<Client> {
  const client = new Client({ name: "filings-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function limitMaximum(
  tools: Array<{ name: string; inputSchema: unknown }>,
  name: string,
): number | null {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool || !isRecord(tool.inputSchema)) return null;
  const properties = tool.inputSchema.properties;
  if (!isRecord(properties) || !isRecord(properties.limit)) return null;
  return typeof properties.limit.maximum === "number"
    ? properties.limit.maximum
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
