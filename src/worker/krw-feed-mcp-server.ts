import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { KRW_FEED_MCP_TOOL_NAMES, createKrwFeedMcpServer } from "@/krw-feed-mcp/server";
import { checkKrwFeedReadiness } from "@/krw-feed-mcp/feed-reader";
import { marketIssueEnvironment } from "@/lib/market-issues/config";
import { readIntEnv } from "@/lib/env";

const PORT = readIntEnv("KRW_FEED_MCP_PORT", 8795, { min: 1, max: 65_535 });
const HOST = feedMcpHost();
const MAX_REQUEST_BYTES = 1_000_000;

function feedMcpEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(
    process.env.KRW_FEED_MCP_ENABLED?.trim().toLowerCase() ?? "",
  );
}

function feedMcpHost(): string {
  const host = process.env.KRW_FEED_MCP_HOST?.trim() || "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0", "::1"].includes(host)) {
    throw new Error("KRW_FEED_MCP_HOST must be a loopback address or 0.0.0.0 for an isolated container");
  }
  return host;
}

function expectedToken(): string {
  return process.env.KRW_FEED_MCP_TOKEN?.trim()
    || process.env.FEED_MCP_AUTH_TOKEN?.trim()
    || "";
}

function isAuthorized(request: IncomingMessage): boolean {
  const token = expectedToken();
  const authorization = request.headers.authorization;
  if (!token || !authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("MCP request body is too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) throw new Error("MCP request body is required");
  return JSON.parse(raw) as unknown;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!feedMcpEnabled()) {
    sendJson(response, 503, { error: "krw_feed_mcp_disabled" });
    return;
  }
  if (!expectedToken()) {
    sendJson(response, 503, { error: "krw_feed_mcp_auth_not_configured" });
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  const server = createKrwFeedMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    const body = await readJsonBody(request);
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
    response.once("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 400, {
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: error instanceof Error ? error.message : "Invalid MCP request",
        },
        id: null,
      });
    }
    await transport.close();
    await server.close();
  }
}

const app = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      name: "krw-feed-mcp",
      enabled: feedMcpEnabled(),
      auth_configured: Boolean(expectedToken()),
      environment: marketIssueEnvironment(),
      tools: KRW_FEED_MCP_TOOL_NAMES,
    });
    return;
  }
  if (pathname === "/readyz") {
    void checkKrwFeedReadiness().then((database_ready) => {
      const ready = feedMcpEnabled() && Boolean(expectedToken()) && database_ready;
      sendJson(response, ready ? 200 : 503, {
        ok: ready,
        database_ready,
      });
    });
    return;
  }
  if (pathname !== "/mcp" || request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  void handleMcpRequest(request, response);
});

app.listen(PORT, HOST, () => {
  console.info(`[krw-feed-mcp] listening on ${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close(() => process.exit(0));
  });
}
