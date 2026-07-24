import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import {
  FilingReaderError,
  getFilingBrief,
  getFilingMetadata,
  getForm4InsiderTransactions,
  listFilingDocuments,
  listFilingSections,
  readFilingDocument,
  readFilingSection,
  searchCatalogFilings,
} from "./on-demand-filing-reader";
import {
  getCoverageState,
  getDecisionTimeline,
  listFilingJudgments,
  listOpenQuestions,
  PERSONAL_MCP_LIST_DEFAULT_LIMIT,
  PERSONAL_MCP_LIST_MAX_LIMIT,
  PERSONAL_MCP_TIMELINE_DEFAULT_LIMIT,
  PERSONAL_MCP_TIMELINE_MAX_LIMIT,
  serializePersonalMcpResult,
} from "./personal-filing-reader";

const FILING_EVENT_ID_SCHEMA = z.string().uuid().describe("UUID of a filing event already present in the KRW catalog.");
const FORM_TYPE_SCHEMA = z.enum(["8-K", "8-K/A", "6-K", "6-K/A", "4", "4/A"]);

export const KRW_FILINGS_MCP_TOOL_NAMES = [
  "get_filing",
  "get_filing_brief",
  "search_catalog_filings",
  "list_filing_sections",
  "read_filing_section",
  "list_filing_documents",
  "read_filing_document",
  "get_form4_insider_transactions",
] as const;

export type KrwFilingsMcpToolName = typeof KRW_FILINGS_MCP_TOOL_NAMES[number];

export const KRW_PERSONAL_FILINGS_MCP_TOOL_NAMES = [
  "get_coverage_state",
  "list_filing_judgments",
  "get_decision_timeline",
  "list_open_questions",
] as const;

export type KrwPersonalFilingsMcpToolName =
  typeof KRW_PERSONAL_FILINGS_MCP_TOOL_NAMES[number];

export interface KrwFilingsMcpServerOptions {
  userId?: string | null;
}

export function createKrwFilingsMcpServer(
  options: KrwFilingsMcpServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: "krw-filings",
    version: process.env.npm_package_version ?? "0.1.0",
  });

  server.registerTool("get_filing", {
    title: "Get catalog filing metadata",
    description: "Returns verified metadata and SEC URLs for one filing event. It never fetches or stores a document body.",
    inputSchema: { filing_event_id: FILING_EVENT_ID_SCHEMA },
  }, async ({ filing_event_id }) => toolResult(() => getFilingMetadata(filing_event_id)));

  server.registerTool("get_filing_brief", {
    title: "Get a source-grounded filing brief",
    description: "Returns a validated Korean automatic brief for a catalog 8-K or 6-K if it is ready. It is not investment advice; use read_filing_section to re-read SEC source context before answering follow-up questions.",
    inputSchema: { filing_event_id: FILING_EVENT_ID_SCHEMA },
  }, async ({ filing_event_id }) => toolResult(() => getFilingBrief(filing_event_id)));

  server.registerTool("search_catalog_filings", {
    title: "Search catalog filing metadata",
    description: "Searches recent 8-K, 6-K, and Form 4 metadata for one ticker in the active KRW ontology catalog. It does not fetch filing bodies.",
    inputSchema: {
      ticker: z.string().min(1).max(20).describe("Ticker from the active KRW ontology catalog."),
      form_type: FORM_TYPE_SCHEMA.optional().describe("Optional exact SEC form type."),
      limit: z.number().int().min(1).max(25).optional().describe("Maximum number of recent filings; defaults to 10."),
    },
  }, async ({ ticker, form_type, limit }) => toolResult(() => searchCatalogFilings({
    ticker,
    formType: form_type,
    limit,
  })));

  server.registerTool("list_filing_sections", {
    title: "List on-demand filing sections",
    description: "Fetches the verified primary 8-K or 6-K document from SEC EDGAR on demand, then lists deterministic Item or document-section boundaries. The document is held only in short-lived process memory.",
    inputSchema: { filing_event_id: FILING_EVENT_ID_SCHEMA },
  }, async ({ filing_event_id }) => toolResult(() => listFilingSections(filing_event_id)));

  server.registerTool("read_filing_section", {
    title: "Read an on-demand filing section",
    description: "Reads a bounded slice of a verified SEC primary 8-K or 6-K document. Call list_filing_sections first; use document:primary only when a section is unavailable. Every result includes SEC citations.",
    inputSchema: {
      filing_event_id: FILING_EVENT_ID_SCHEMA,
      section_key: z.string().min(1).max(120).describe("A key returned by list_filing_sections, such as item:2.02."),
      offset: z.number().int().min(0).optional().describe("Character offset for pagination; defaults to 0."),
      max_chars: z.number().int().min(1_000).max(120_000).optional().describe("Maximum returned characters; defaults to 24,000."),
    },
  }, async ({ filing_event_id, section_key, offset, max_chars }) => toolResult(() => readFilingSection({
    filingEventId: filing_event_id,
    sectionKey: section_key,
    offset,
    maxChars: max_chars,
  })));

  server.registerTool("list_filing_documents", {
    title: "List verified SEC filing documents",
    description: "Fetches the selected 8-K or 6-K filing's SEC submission index on demand and lists primary and Exhibit metadata. It never persists the document list or a document body.",
    inputSchema: { filing_event_id: FILING_EVENT_ID_SCHEMA },
  }, async ({ filing_event_id }) => toolResult(() => listFilingDocuments(filing_event_id)));

  server.registerTool("read_filing_document", {
    title: "Read a verified SEC filing attachment",
    description: "Reads a bounded text slice from one HTML, XML, or text Exhibit returned by list_filing_documents. A raw URL is never accepted; the document_key must belong to the selected SEC filing.",
    inputSchema: {
      filing_event_id: FILING_EVENT_ID_SCHEMA,
      document_key: z.string().min(12).max(120).describe("A document_key returned by list_filing_documents for this same filing."),
      offset: z.number().int().min(0).optional().describe("Character offset for pagination; defaults to 0."),
      max_chars: z.number().int().min(1_000).max(120_000).optional().describe("Maximum returned characters; defaults to 24,000."),
    },
  }, async ({ filing_event_id, document_key, offset, max_chars }) => toolResult(() => readFilingDocument({
    filingEventId: filing_event_id,
    documentKey: document_key,
    offset,
    maxChars: max_chars,
  })));

  server.registerTool("get_form4_insider_transactions", {
    title: "Get structured Form 4 insider transactions",
    description: "Returns already-stored deterministic Form 4 owners, transactions, and summary facts for a catalog filing. It does not refetch or store the XML body.",
    inputSchema: { filing_event_id: FILING_EVENT_ID_SCHEMA },
  }, async ({ filing_event_id }) => toolResult(() => getForm4InsiderTransactions(filing_event_id)));

  const userId = options.userId?.trim() || null;
  if (userId) registerPersonalTools(server, userId);

  return server;
}

function registerPersonalTools(server: McpServer, userId: string): void {
  server.registerTool("get_coverage_state", {
    title: "Get my company coverage state",
    description: "Returns only the authenticated user's coverage status, active monitoring rules, and open-question count for one ticker. This private state is separate from global filing briefs.",
    inputSchema: {
      ticker: z.string().min(1).max(16).describe("Ticker in the user's research coverage."),
    },
  }, async ({ ticker }) => personalToolResult(() => getCoverageState(userId, { ticker })));

  server.registerTool("list_filing_judgments", {
    title: "List my filing judgments",
    description: "Lists the authenticated user's current filing judgments and rationale. It never returns another user's notes and must not be treated as a public or global filing brief.",
    inputSchema: {
      ticker: z.string().min(1).max(16).optional().describe("Optional ticker filter."),
      filing_event_id: FILING_EVENT_ID_SCHEMA.optional().describe("Optional filing-event filter."),
      limit: z.number().int().min(1).max(PERSONAL_MCP_LIST_MAX_LIMIT).optional().describe(
        `Maximum results; defaults to ${PERSONAL_MCP_LIST_DEFAULT_LIMIT}. Responses include pagination and explicit truncation metadata.`,
      ),
    },
  }, async ({ ticker, filing_event_id, limit }) => personalToolResult(() => listFilingJudgments(userId, {
    ticker,
    filingEventId: filing_event_id,
    limit,
  })));

  server.registerTool("get_decision_timeline", {
    title: "Get my company decision timeline",
    description: "Combines only the authenticated user's filing-judgment revisions, company questions, and thesis checks for one ticker, newest first.",
    inputSchema: {
      ticker: z.string().min(1).max(16).describe("Ticker in the user's research coverage."),
      limit: z.number().int().min(1).max(PERSONAL_MCP_TIMELINE_MAX_LIMIT).optional().describe(
        `Maximum combined timeline items; defaults to ${PERSONAL_MCP_TIMELINE_DEFAULT_LIMIT}. Responses include pagination and explicit truncation metadata.`,
      ),
    },
  }, async ({ ticker, limit }) => personalToolResult(() => getDecisionTimeline(userId, { ticker, limit })));

  server.registerTool("list_open_questions", {
    title: "List my open company questions",
    description: "Lists only currently visible, open questions owned by the authenticated user. The optional ticker filter never widens the user boundary.",
    inputSchema: {
      ticker: z.string().min(1).max(16).optional().describe("Optional ticker filter."),
      limit: z.number().int().min(1).max(PERSONAL_MCP_LIST_MAX_LIMIT).optional().describe(
        `Maximum results; defaults to ${PERSONAL_MCP_LIST_DEFAULT_LIMIT}. Responses include pagination and explicit truncation metadata.`,
      ),
    },
  }, async ({ ticker, limit }) => personalToolResult(() => listOpenQuestions(userId, { ticker, limit })));
}

async function personalToolResult<T>(operation: () => Promise<T>) {
  try {
    const result = await operation();
    return {
      content: [{ type: "text" as const, text: serializePersonalMcpResult(result) }],
    };
  } catch (error) {
    return toolErrorResult(error);
  }
}

async function toolResult<T>(operation: () => Promise<T>) {
  try {
    const result = await operation();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  } catch (error) {
    return toolErrorResult(error);
  }
}

function toolErrorResult(error: unknown) {
  const message = error instanceof FilingReaderError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : "Filing tool failed";
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}
