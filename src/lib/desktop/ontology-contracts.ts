export const DESKTOP_PROTOCOL_VERSION = "desktop/v1";
export const DESKTOP_ONTOLOGY_API_VERSION = "ontology-search/v1";

export const DESKTOP_ONTOLOGY_TOOL_NAMES = [
  "krw_ontology_catalog",
  "krw_ontology_company_context",
  "krw_ontology_query_context",
  "krw_ontology_query",
  "krw_ontology_trace",
  "krw_ontology_chain",
  "krw_ontology_compare",
] as const;

export type DesktopOntologyToolName =
  (typeof DESKTOP_ONTOLOGY_TOOL_NAMES)[number];

export type DesktopErrorCode =
  | "authentication_error"
  | "entitlement_required"
  | "validation_error"
  | "not_found"
  | "resource_conflict"
  | "contract_mismatch"
  | "provider_unavailable"
  | "llm_job_token_unavailable"
  | "invalid_job_token"
  | "ontology_unavailable"
  | "tool_not_allowed"
  | "invalid_tool_arguments"
  | "result_too_large"
  | "rate_limited"
  | "internal_error";

export interface DesktopOntologyToolCallRequest {
  local_session_id: string;
  local_run_id: string;
  tool_call_id: string;
  tool_name: DesktopOntologyToolName;
  arguments: Record<string, unknown>;
  desktop_context: Record<string, unknown>;
}

export interface DesktopOntologyToolCallSuccess {
  ok: true;
  tool_call_id: string;
  tool_name: DesktopOntologyToolName;
  result_text: string;
  result_json: Record<string, unknown>;
  ontology_release: {
    release_id: string;
    api_version: string;
    index_generated_at?: string | null;
  };
  usage?: {
    tool_calls_consumed?: number;
    remaining_today?: number;
  };
  audit?: {
    server_tool_call_id?: string;
    latency_ms?: number;
  };
}

export interface DesktopOntologyErrorPayload {
  ok: false;
  error: {
    code: DesktopErrorCode;
    message: string;
    public_message: string;
    retryable: boolean;
  };
}

export type DesktopOntologyToolCallResponse =
  | DesktopOntologyToolCallSuccess
  | DesktopOntologyErrorPayload;

const TOOL_NAME_SET = new Set<string>(DESKTOP_ONTOLOGY_TOOL_NAMES);

export class DesktopContractError extends Error {
  code: DesktopErrorCode;
  publicMessage: string;
  status: number;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: DesktopErrorCode;
      publicMessage?: string;
      status?: number;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "DesktopContractError";
    this.code = options.code ?? "invalid_tool_arguments";
    this.publicMessage = options.publicMessage ?? message;
    this.status = options.status ?? 400;
    this.retryable = Boolean(options.retryable);
  }
}

export function isDesktopOntologyToolName(
  value: unknown,
): value is DesktopOntologyToolName {
  return typeof value === "string" && TOOL_NAME_SET.has(value);
}

export function validateDesktopOntologyToolCallRequest(
  input: unknown,
): DesktopOntologyToolCallRequest {
  const request = assertPlainObject(input, "request");
  const toolName = requireToolName(request.tool_name);
  const args = assertPlainObject(request.arguments ?? {}, "request.arguments");

  return {
    local_session_id: requireBoundedString(
      request.local_session_id,
      "local_session_id",
      160,
    ),
    local_run_id: requireBoundedString(request.local_run_id, "local_run_id", 160),
    tool_call_id: requireBoundedString(request.tool_call_id, "tool_call_id", 160),
    tool_name: toolName,
    arguments: validateToolArguments(toolName, args),
    desktop_context: validateDesktopContext(request.desktop_context ?? {}),
  };
}

export function desktopErrorResponse(
  code: DesktopErrorCode,
  publicMessage: string,
  options: {
    message?: string;
    retryable?: boolean;
  } = {},
): DesktopOntologyErrorPayload {
  return {
    ok: false,
    error: {
      code,
      message: options.message ?? publicMessage,
      public_message: publicMessage,
      retryable: Boolean(options.retryable),
    },
  };
}

function validateToolArguments(
  toolName: DesktopOntologyToolName,
  input: Record<string, unknown>,
): Record<string, unknown> {
  switch (toolName) {
    case "krw_ontology_catalog":
      return omitUndefined({
        query: optionalBoundedString(input.query, "query", 120),
        limit: optionalInt(input.limit, "limit", { min: 1, max: 20, fallback: 10 }),
      });
    case "krw_ontology_company_context":
      return {
        ticker: normalizeTicker(input.ticker, "ticker"),
      };
    case "krw_ontology_query_context":
      return omitUndefined({
        question: requireBoundedString(input.question, "question", 2_000),
        tickers: optionalTickerArray(input.tickers, "tickers", { max: 6 }),
        limit_results: optionalInt(input.limit_results, "limit_results", {
          min: 1,
          max: 5,
          fallback: 3,
        }),
        response_detail: optionalEnum(
          input.response_detail,
          "response_detail",
          ["compact", "summary"],
          "compact",
        ),
      });
    case "krw_ontology_query": {
      const topic = input.topic ?? input.question;
      return omitUndefined({
        ticker:
          input.ticker === undefined
            ? undefined
            : normalizeTicker(input.ticker, "ticker"),
        topic: requireBoundedString(topic, "topic", 1_000),
        limit: optionalInt(input.limit, "limit", { min: 1, max: 5, fallback: 3 }),
        response_detail: optionalEnum(
          input.response_detail,
          "response_detail",
          ["compact", "summary"],
          "compact",
        ),
      });
    }
    case "krw_ontology_trace":
      return {
        root_id: requireBoundedString(input.root_id, "root_id", 240),
        depth: optionalInt(input.depth, "depth", { min: 1, max: 3, fallback: 2 }),
      };
    case "krw_ontology_chain":
      return omitUndefined({
        root_id: requireBoundedString(input.root_id, "root_id", 240),
        relationship: optionalBoundedString(input.relationship, "relationship", 80),
        depth: optionalInt(input.depth, "depth", { min: 1, max: 3, fallback: 2 }),
      });
    case "krw_ontology_compare":
      return {
        tickers: requireTickerArray(input.tickers, "tickers", {
          min: 2,
          max: 6,
        }),
        question: requireBoundedString(input.question, "question", 1_500),
        limit_per_ticker: optionalInt(input.limit_per_ticker, "limit_per_ticker", {
          min: 1,
          max: 3,
          fallback: 2,
        }),
      };
  }
}

function validateDesktopContext(input: unknown): Record<string, unknown> {
  const context = assertPlainObject(input, "desktop_context");
  return omitUndefined({
    app_version: optionalBoundedString(context.app_version, "app_version", 40),
    protocol_version: optionalBoundedString(
      context.protocol_version,
      "protocol_version",
      40,
    ),
    analysis_mode: optionalBoundedString(context.analysis_mode, "analysis_mode", 40),
    research_mode: optionalBoundedString(context.research_mode, "research_mode", 40),
    run_kind: optionalBoundedString(context.run_kind, "run_kind", 60),
    agent_turn: optionalInt(context.agent_turn, "agent_turn", {
      min: 0,
      max: 200,
    }),
  });
}

function requireToolName(value: unknown): DesktopOntologyToolName {
  if (isDesktopOntologyToolName(value)) return value;
  throw new DesktopContractError(`Unsupported ontology tool: ${String(value)}`, {
    code: "tool_not_allowed",
    publicMessage: "허용되지 않은 온톨로지 도구입니다.",
    status: 403,
  });
}

function assertPlainObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new DesktopContractError(`${name} must be an object`);
}

function requireBoundedString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new DesktopContractError(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new DesktopContractError(`${name} is required`);
  if (trimmed.length > maxLength) {
    throw new DesktopContractError(`${name} is too long`);
  }
  return trimmed;
}

function optionalBoundedString(
  value: unknown,
  name: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireBoundedString(value, name, maxLength);
}

function optionalEnum<T extends string>(
  value: unknown,
  name: string,
  values: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" && values.includes(value as T)) return value as T;
  throw new DesktopContractError(`${name} must be one of: ${values.join(", ")}`);
}

function optionalInt(
  value: unknown,
  name: string,
  options: { min: number; max: number; fallback?: number },
): number {
  if (value === undefined || value === null || value === "") {
    return options.fallback ?? options.min;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new DesktopContractError(`${name} must be an integer`);
  }
  if (value < options.min || value > options.max) {
    throw new DesktopContractError(`${name} must be between ${options.min} and ${options.max}`);
  }
  return value;
}

function normalizeTicker(value: unknown, name: string): string {
  const ticker = requireBoundedString(value, name, 12).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,10}$/.test(ticker)) {
    throw new DesktopContractError(`${name} is invalid`);
  }
  return ticker;
}

function optionalTickerArray(
  value: unknown,
  name: string,
  options: { max: number },
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const values = requireTickerArray(value, name, { min: 0, max: options.max });
  return values.length ? values : undefined;
}

function requireTickerArray(
  value: unknown,
  name: string,
  options: { min: number; max: number },
): string[] {
  if (!Array.isArray(value)) {
    throw new DesktopContractError(`${name} must be an array`);
  }
  if (value.length < options.min || value.length > options.max) {
    throw new DesktopContractError(`${name} must have ${options.min}-${options.max} tickers`);
  }
  return Array.from(
    new Set(value.map((item, index) => normalizeTicker(item, `${name}[${index}]`))),
  );
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
