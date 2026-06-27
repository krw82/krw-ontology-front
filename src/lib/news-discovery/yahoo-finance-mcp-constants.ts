export const YAHOO_FINANCE_MCP_SERVER_NAME = "yahoo_finance";
export const YAHOO_FINANCE_GET_NEWS_TOOL = "get_yahoo_finance_news";
export const YAHOO_FINANCE_GET_STOCK_INFO_TOOL = "get_stock_info";
export const YAHOO_FINANCE_MCP_TOOLS = [
  YAHOO_FINANCE_GET_NEWS_TOOL,
  YAHOO_FINANCE_GET_STOCK_INFO_TOOL,
] as const;
export const YAHOO_FINANCE_SDK_ALLOWED_TOOLS = YAHOO_FINANCE_MCP_TOOLS.map(
  (toolName) => `mcp__${YAHOO_FINANCE_MCP_SERVER_NAME}__${toolName}`,
);
