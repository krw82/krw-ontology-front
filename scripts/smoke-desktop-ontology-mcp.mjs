#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const args = parseArgs(process.argv.slice(2));
const mcpUrl =
  args.url ??
  process.env.KRW_ONTOLOGY_MCP_URL ??
  "http://127.0.0.1:8765/mcp";
const ticker = (args.ticker ?? "AAPL").toUpperCase();
const question =
  args.question ?? `${ticker} demand, margin, and risk evidence`;
const normalizedQuestion = question.trim().slice(0, 900);
const retrievalQuery = `${ticker} ${normalizedQuestion}`.trim();
const requiredConcept = normalizedQuestion.slice(0, 150).trim();
const timeoutMs = positiveInt(args.timeoutMs, 30_000);
const maxResultBytes = positiveInt(
  process.env.DESKTOP_ONTOLOGY_MAX_RESULT_BYTES,
  60_000,
);

const healthUrl = new URL(mcpUrl);
healthUrl.pathname = "/health";
healthUrl.search = "";
healthUrl.hash = "";

const health = await fetchJson(healthUrl, timeoutMs);
if (!health.response.ok || health.payload?.ok !== true) {
  fail(`MCP health failed: HTTP ${health.response.status}`);
}
if (
  process.env.EXPECTED_ONTOLOGY_RELEASE_ID &&
  health.payload.release_id !== process.env.EXPECTED_ONTOLOGY_RELEASE_ID
) {
  fail(
    `MCP release mismatch: expected ${process.env.EXPECTED_ONTOLOGY_RELEASE_ID}, got ${health.payload.release_id ?? "unknown"}`,
  );
}

const client = new Client({
  name: "krw-desktop-ontology-smoke",
  version: "0.1.0",
});
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));

try {
  await client.connect(transport, { timeout: timeoutMs });
  const result = await client.callTool(
    {
      name: "krw_ontology_query_context",
      arguments: {
        search_plan: {
          question,
          intent: "smoke_test",
          tickers: [ticker],
          clauses: [
            {
              clause_id: "smoke",
              retrieval_query: retrievalQuery,
              required_concepts: [requiredConcept],
              directness: "any",
            },
          ],
          limit_results: 2,
        },
      },
    },
    undefined,
    { timeout: timeoutMs, maxTotalTimeout: timeoutMs },
  );
  if (result.isError) fail("query_context returned an MCP error");

  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) fail("query_context returned no text content");

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxResultBytes) {
    fail(`query_context result exceeds Desktop limit: ${bytes} > ${maxResultBytes}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail("query_context result is not JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("query_context result is not a JSON object");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mcp_url: mcpUrl,
        release_id: health.payload.release_id ?? null,
        index_generated_at: health.payload.index_generated_at ?? null,
        tool_count: Array.isArray(health.payload.tools)
          ? health.payload.tools.length
          : null,
        ticker,
        result_bytes: bytes,
        research_status:
          payload.answerability?.status ?? payload.research_status ?? null,
        result_keys: Object.keys(payload).sort(),
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => undefined);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--url") parsed.url = values[++index];
    else if (value === "--ticker") parsed.ticker = values[++index];
    else if (value === "--question") parsed.question = values[++index];
    else if (value === "--timeout-ms") parsed.timeoutMs = values[++index];
    else if (value === "--help" || value === "-h") {
      console.log(
        "Usage: node scripts/smoke-desktop-ontology-mcp.mjs [--url URL] [--ticker TICKER] [--question TEXT] [--timeout-ms MS]",
      );
      process.exit(0);
    } else {
      fail(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    return { response, payload: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : fallback;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
