import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  authenticatePersonalFilingsMcpHeader,
  PERSONAL_FILINGS_MCP_AUTH_HEADER,
} from "@/filings-mcp/personal-auth";
import { createKrwFilingsMcpServer } from "@/filings-mcp/server";
import { readIntEnv } from "@/lib/env";

const PORT = readIntEnv("FILINGS_MCP_PORT", 8785, { min: 1, max: 65_535 });
const HOST = filingsMcpHost();
const MAX_REQUEST_BYTES = 1_000_000;

function filingsMcpEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(
    process.env.FILINGS_MCP_ENABLED?.trim().toLowerCase() ?? "",
  );
}

function filingsMcpHost(): string {
  const host = process.env.FILINGS_MCP_HOST?.trim() || "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0", "::1"].includes(host)) {
    throw new Error("FILINGS_MCP_HOST must be a loopback address or 0.0.0.0 for an isolated container");
  }
  return host;
}

function expectedToken(): string {
  return process.env.KRW_FILINGS_MCP_TOKEN?.trim()
    || process.env.FILINGS_MCP_AUTH_TOKEN?.trim()
    || "";
}

function isAuthorized(request: IncomingMessage): boolean {
  const token = expectedToken();
  if (!token) return false;
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
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
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!filingsMcpEnabled()) {
    sendJson(response, 503, { error: "filings_mcp_disabled" });
    return;
  }
  if (!expectedToken()) {
    sendJson(response, 503, { error: "filings_mcp_auth_not_configured" });
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  let personalUserId: string | null = null;
  try {
    const personalAuth = await authenticatePersonalFilingsMcpHeader(
      request.headers[PERSONAL_FILINGS_MCP_AUTH_HEADER],
    );
    personalUserId = personalAuth?.userId ?? null;
  } catch {
    sendJson(response, 401, { error: "personal_user_unauthorized" });
    return;
  }

  const server = createKrwFilingsMcpServer({ userId: personalUserId });
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
        error: { code: -32600, message: error instanceof Error ? error.message : "Invalid MCP request" },
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
      enabled: filingsMcpEnabled(),
      personal_auth_configured: Boolean(
        process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET?.trim(),
      ),
    });
    return;
  }
  if (pathname === "/readyz") {
    const ready = filingsMcpEnabled()
      && Boolean(expectedToken())
      && Boolean(process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET?.trim())
      && Boolean(process.env.SEC_USER_AGENT?.trim());
    sendJson(response, ready ? 200 : 503, { ok: ready });
    return;
  }
  if (pathname !== "/mcp" || request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  void handleMcpRequest(request, response);
});

app.listen(PORT, HOST, () => {
  console.info(`[filings-mcp] listening on ${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close(() => process.exit(0));
  });
}
