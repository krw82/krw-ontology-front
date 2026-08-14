import "server-only";

/**
 * Yahoo data is now requested by the Rust research engine's capability
 * boundary. This compatibility export deliberately does not create an SDK
 * MCP server in the Next.js process.
 */
export function createYahooFinanceNewsMcpServer(): never {
  throw new Error("yahoo_finance_capability_owned_by_krw_agent");
}
