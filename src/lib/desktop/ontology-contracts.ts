export const DESKTOP_PROTOCOL_VERSION = "desktop/v1";
export const DESKTOP_ONTOLOGY_API_VERSION = "ontology-search/v2";
export const SEARCH_PLAN_CONTRACT_VERSION = "search-plan/v2";
export const RESEARCH_STATE_CONTRACT_VERSION = "research-state/v2";

export type EvidenceRequirement =
  "any" | "direct_preferred" | "direct_required";
export type MetricScope = "company_total" | "dimensioned" | "any";
export type CalculationWindow = "period_over_period" | "year_over_year";
export type ComparisonAxis =
  | "value"
  | "absolute_change"
  | "growth_rate"
  | "value_difference"
  | "directness"
  | "evidence_grade";

export interface SearchPlanClauseV2 {
  clause_id: string;
  retrieval_query: string;
  required_concepts: string[];
  required_predicates: string[];
  required: boolean;
  tickers: string[];
  directness: EvidenceRequirement;
  object_types: string[];
  metrics: string[];
  metric_dimensions: string[];
  metric_scope: MetricScope;
  calculation_window: CalculationWindow | null;
}

export interface SearchPlanV2 {
  question: string;
  intent: string;
  clauses: SearchPlanClauseV2[];
  tickers: string[];
  document_types: string[];
  periods: string[];
  universe: "covered" | null;
  comparison_axes: ComparisonAxis[];
  answer_scope: "direct" | "supporting_context_only";
  uncertainty: "low" | "medium" | "high";
  limit_results: number;
  limit_tickers: number;
}

export interface ResearchStateV2 extends Record<string, unknown> {
  contract_version: typeof RESEARCH_STATE_CONTRACT_VERSION;
  release_id: string | null;
  plan: SearchPlanV2;
  resolved_scope: Record<string, unknown>;
  source_anchors: unknown[];
  answerability: Record<string, unknown>;
  clause_coverage: unknown[];
  evidence_units: unknown[];
  computed_values: unknown[];
  calculation_coverage: unknown[];
  missing_parts: unknown[];
  recommended_actions: unknown[];
  continuation: Record<string, unknown> | null;
  warnings: unknown[];
}

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
  DesktopOntologyToolCallSuccess | DesktopOntologyErrorPayload;

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
    local_run_id: requireBoundedString(
      request.local_run_id,
      "local_run_id",
      160,
    ),
    tool_call_id: requireBoundedString(
      request.tool_call_id,
      "tool_call_id",
      160,
    ),
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
        limit: optionalInt(input.limit, "limit", {
          min: 1,
          max: 20,
          fallback: 10,
        }),
      });
    case "krw_ontology_company_context":
      return {
        ticker: normalizeTicker(input.ticker, "ticker"),
      };
    case "krw_ontology_query_context":
      assertAllowedKeys(input, "query_context arguments", ["search_plan"]);
      return {
        search_plan: validateSearchPlanV2(input.search_plan),
      };
    case "krw_ontology_query": {
      const topic = input.topic ?? input.question;
      return omitUndefined({
        ticker:
          input.ticker === undefined
            ? undefined
            : normalizeTicker(input.ticker, "ticker"),
        topic: requireBoundedString(topic, "topic", 1_000),
        limit: optionalInt(input.limit, "limit", {
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
    }
    case "krw_ontology_trace":
      return {
        root_id: requireBoundedString(input.root_id, "root_id", 240),
        depth: optionalInt(input.depth, "depth", {
          min: 1,
          max: 3,
          fallback: 2,
        }),
      };
    case "krw_ontology_chain":
      return omitUndefined({
        root_id: requireBoundedString(input.root_id, "root_id", 240),
        relationship: optionalBoundedString(
          input.relationship,
          "relationship",
          80,
        ),
        depth: optionalInt(input.depth, "depth", {
          min: 1,
          max: 3,
          fallback: 2,
        }),
      });
    case "krw_ontology_compare":
      return {
        tickers: requireTickerArray(input.tickers, "tickers", {
          min: 2,
          max: 6,
        }),
        question: requireBoundedString(input.question, "question", 1_500),
        limit_per_ticker: optionalInt(
          input.limit_per_ticker,
          "limit_per_ticker",
          {
            min: 1,
            max: 3,
            fallback: 2,
          },
        ),
      };
  }
}

export function validateSearchPlanV2(input: unknown): SearchPlanV2 {
  const plan = assertPlainObject(input, "search_plan");
  assertAllowedKeys(plan, "search_plan", [
    "question",
    "intent",
    "clauses",
    "tickers",
    "document_types",
    "periods",
    "universe",
    "comparison_axes",
    "answer_scope",
    "uncertainty",
    "limit_results",
    "limit_tickers",
  ]);

  const clauses = requireObjectArray(plan.clauses, "search_plan.clauses", {
    min: 1,
    max: 12,
  }).map((value, index) => validateSearchPlanClause(value, index));
  const clauseIds = clauses.map((clause) => clause.clause_id.toLowerCase());
  if (new Set(clauseIds).size !== clauseIds.length) {
    throw new DesktopContractError(
      "search_plan clause_id values must be unique",
    );
  }
  const requiredClauseCount = clauses.filter(
    (clause) => clause.required,
  ).length;
  if (requiredClauseCount === 0) {
    throw new DesktopContractError(
      "search_plan must contain at least one required clause",
    );
  }

  const tickers =
    optionalTickerArray(plan.tickers, "search_plan.tickers", {
      max: 50,
    }) ?? [];
  const universe = optionalNullableEnum(plan.universe, "search_plan.universe", [
    "covered",
  ]);
  if (tickers.length > 0 && universe) {
    throw new DesktopContractError(
      "search_plan must use explicit tickers or universe, not both",
    );
  }
  const planTickerSet = new Set(tickers);
  for (const clause of clauses) {
    if (clause.tickers.length > 0 && tickers.length === 0) {
      throw new DesktopContractError(
        "search_plan clause tickers require explicit search_plan.tickers",
      );
    }
    const outsideScope = clause.tickers.filter(
      (ticker) => !planTickerSet.has(ticker),
    );
    if (outsideScope.length > 0) {
      throw new DesktopContractError(
        `search_plan clause tickers must be a subset of search_plan.tickers: ${outsideScope.join(", ")}`,
      );
    }
  }

  const comparisonAxes = optionalStringEnumArray(
    plan.comparison_axes,
    "search_plan.comparison_axes",
    [
      "value",
      "absolute_change",
      "growth_rate",
      "value_difference",
      "directness",
      "evidence_grade",
    ] as const,
    16,
  );
  const numericAxes = new Set([
    "value",
    "absolute_change",
    "growth_rate",
    "value_difference",
  ]);
  if (
    comparisonAxes.some((axis) => numericAxes.has(axis)) &&
    !clauses.some((clause) => clause.required && clause.metrics.length > 0)
  ) {
    throw new DesktopContractError(
      "numeric comparison_axes require a metric on a required clause",
    );
  }
  const temporalAxes = new Set(["absolute_change", "growth_rate"]);
  if (comparisonAxes.some((axis) => temporalAxes.has(axis))) {
    const missingWindows = clauses
      .filter(
        (clause) =>
          clause.required &&
          clause.metrics.length > 0 &&
          clause.calculation_window === null,
      )
      .map((clause) => clause.clause_id);
    if (missingWindows.length > 0) {
      throw new DesktopContractError(
        `temporal comparison_axes require calculation_window on required metric clauses: ${missingWindows.join(", ")}`,
      );
    }
  }
  if (
    clauses.reduce((total, clause) => total + clause.metrics.length, 0) > 32
  ) {
    throw new DesktopContractError(
      "search_plan supports at most 32 metric references",
    );
  }

  const limitResults = optionalInt(
    plan.limit_results,
    "search_plan.limit_results",
    { min: 1, max: 50, fallback: 12 },
  );
  if (limitResults < requiredClauseCount) {
    throw new DesktopContractError(
      "search_plan.limit_results must cover every required clause",
    );
  }

  return {
    question: requireBoundedString(
      plan.question,
      "search_plan.question",
      4_000,
    ),
    intent: requirePatternString(
      plan.intent,
      "search_plan.intent",
      64,
      /^[a-z][a-z0-9_.-]*$/,
    ),
    clauses,
    tickers,
    document_types: optionalBoundedStringArray(
      plan.document_types,
      "search_plan.document_types",
      { maxItems: 16, maxLength: 128, uppercase: true },
    ),
    periods: optionalBoundedStringArray(plan.periods, "search_plan.periods", {
      maxItems: 40,
      maxLength: 128,
    }),
    universe,
    comparison_axes: comparisonAxes,
    answer_scope: optionalEnum(
      plan.answer_scope,
      "search_plan.answer_scope",
      ["direct", "supporting_context_only"] as const,
      "direct",
    ),
    uncertainty: optionalEnum(
      plan.uncertainty,
      "search_plan.uncertainty",
      ["low", "medium", "high"] as const,
      "low",
    ),
    limit_results: limitResults,
    limit_tickers: optionalInt(
      plan.limit_tickers,
      "search_plan.limit_tickers",
      { min: 1, max: 50, fallback: 20 },
    ),
  };
}

export function validateResearchStateV2(input: unknown): ResearchStateV2 {
  const state = assertPlainObject(input, "research_state");
  if (state.contract_version !== RESEARCH_STATE_CONTRACT_VERSION) {
    throw new DesktopContractError(
      `research_state.contract_version must be ${RESEARCH_STATE_CONTRACT_VERSION}`,
      { code: "contract_mismatch", status: 502, retryable: true },
    );
  }
  const plan = validateSearchPlanV2(state.plan);
  const resolvedScope = assertPlainObject(
    state.resolved_scope,
    "research_state.resolved_scope",
  );
  const answerability = assertPlainObject(
    state.answerability,
    "research_state.answerability",
  );
  const answerabilityStatus = answerability.status;
  if (
    typeof answerabilityStatus !== "string" ||
    ![
      "answerable",
      "partial",
      "not_answerable",
      "supporting_context_only",
    ].includes(answerabilityStatus)
  ) {
    throw new DesktopContractError(
      "research_state.answerability.status is invalid",
      {
        code: "contract_mismatch",
        status: 502,
        retryable: true,
      },
    );
  }

  const requiredArrays = [
    "source_anchors",
    "clause_coverage",
    "evidence_units",
    "computed_values",
    "calculation_coverage",
    "missing_parts",
    "recommended_actions",
    "warnings",
  ] as const;
  for (const field of requiredArrays) {
    if (!Array.isArray(state[field])) {
      throw new DesktopContractError(
        `research_state.${field} must be an array`,
        {
          code: "contract_mismatch",
          status: 502,
          retryable: true,
        },
      );
    }
  }
  if (
    state.continuation !== null &&
    state.continuation !== undefined &&
    (!state.continuation ||
      typeof state.continuation !== "object" ||
      Array.isArray(state.continuation))
  ) {
    throw new DesktopContractError(
      "research_state.continuation must be an object or null",
      { code: "contract_mismatch", status: 502, retryable: true },
    );
  }

  return {
    ...state,
    contract_version: RESEARCH_STATE_CONTRACT_VERSION,
    release_id: typeof state.release_id === "string" ? state.release_id : null,
    plan,
    resolved_scope: resolvedScope,
    source_anchors: state.source_anchors as unknown[],
    answerability,
    clause_coverage: state.clause_coverage as unknown[],
    evidence_units: state.evidence_units as unknown[],
    computed_values: state.computed_values as unknown[],
    calculation_coverage: state.calculation_coverage as unknown[],
    missing_parts: state.missing_parts as unknown[],
    recommended_actions: state.recommended_actions as unknown[],
    continuation:
      state.continuation && typeof state.continuation === "object"
        ? (state.continuation as Record<string, unknown>)
        : null,
    warnings: state.warnings as unknown[],
  };
}

function validateSearchPlanClause(
  input: Record<string, unknown>,
  index: number,
): SearchPlanClauseV2 {
  const name = `search_plan.clauses[${index}]`;
  assertAllowedKeys(input, name, [
    "clause_id",
    "retrieval_query",
    "required_concepts",
    "required_predicates",
    "required",
    "tickers",
    "directness",
    "object_types",
    "metrics",
    "metric_dimensions",
    "metric_scope",
    "calculation_window",
  ]);
  const retrievalQuery = requireBoundedString(
    input.retrieval_query,
    `${name}.retrieval_query`,
    1_000,
  );
  if (retrievalQuery.length < 2) {
    throw new DesktopContractError(`${name}.retrieval_query is too short`);
  }
  const requiredConcepts = optionalBoundedStringArray(
    input.required_concepts,
    `${name}.required_concepts`,
    { maxItems: 32, maxLength: 160 },
  );
  const requiredPredicates = optionalBoundedStringArray(
    input.required_predicates,
    `${name}.required_predicates`,
    { maxItems: 16, maxLength: 160 },
  );
  const metrics = optionalBoundedStringArray(input.metrics, `${name}.metrics`, {
    maxItems: 32,
    maxLength: 128,
  });
  const metricDimensions = optionalBoundedStringArray(
    input.metric_dimensions,
    `${name}.metric_dimensions`,
    { maxItems: 16, maxLength: 160 },
  );
  const metricScope = optionalEnum(
    input.metric_scope,
    `${name}.metric_scope`,
    ["company_total", "dimensioned", "any"] as const,
    "company_total",
  );
  const queryTokens = new Set(planTokens(retrievalQuery));
  for (const [field, values] of [
    ["required_concepts", requiredConcepts],
    ["required_predicates", requiredPredicates],
    ["metric_dimensions", metricDimensions],
  ] as const) {
    for (const value of values) {
      const tokens = planTokens(value);
      if (
        tokens.length > 0 &&
        !tokens.every((token) => queryTokens.has(token))
      ) {
        throw new DesktopContractError(
          `${name}.${field} entries must be named in retrieval_query`,
        );
      }
    }
  }
  if (metricDimensions.length > 0 && metrics.length === 0) {
    throw new DesktopContractError(`${name}.metric_dimensions require metrics`);
  }
  if (metricDimensions.length > 0 && metricScope === "company_total") {
    throw new DesktopContractError(
      `${name}.metric_dimensions require dimensioned or any scope`,
    );
  }
  if (
    metrics.length > 0 &&
    metricDimensions.length === 0 &&
    metricScope === "dimensioned"
  ) {
    throw new DesktopContractError(
      `${name}.metric_scope=dimensioned requires metric_dimensions`,
    );
  }
  if (metrics.length === 0 && requiredConcepts.length === 0) {
    throw new DesktopContractError(
      `${name} requires metrics or required_concepts`,
    );
  }
  if (
    metrics.length === 0 &&
    requiredConcepts.length > 1 &&
    requiredPredicates.length === 0
  ) {
    throw new DesktopContractError(
      `${name} multi-concept qualitative clauses require required_predicates`,
    );
  }
  if (metrics.length > 0 && requiredPredicates.length > 0) {
    throw new DesktopContractError(
      `${name} metric clauses cannot set required_predicates`,
    );
  }
  const calculationWindow = optionalNullableEnum(
    input.calculation_window,
    `${name}.calculation_window`,
    ["period_over_period", "year_over_year"] as const,
  );
  if (calculationWindow && metrics.length === 0) {
    throw new DesktopContractError(
      `${name}.calculation_window requires metrics`,
    );
  }

  return {
    clause_id: requirePatternString(
      input.clause_id,
      `${name}.clause_id`,
      64,
      /^[A-Za-z0-9][A-Za-z0-9_.-]*$/,
    ),
    retrieval_query: retrievalQuery,
    required_concepts: requiredConcepts,
    required_predicates: requiredPredicates,
    required: optionalBoolean(input.required, `${name}.required`, true),
    tickers:
      optionalTickerArray(input.tickers, `${name}.tickers`, { max: 50 }) ?? [],
    directness: optionalEnum(
      input.directness,
      `${name}.directness`,
      ["any", "direct_preferred", "direct_required"] as const,
      "direct_preferred",
    ),
    object_types: optionalBoundedStringArray(
      input.object_types,
      `${name}.object_types`,
      { maxItems: 32, maxLength: 128 },
    ),
    metrics,
    metric_dimensions: metricDimensions,
    metric_scope: metricScope,
    calculation_window: calculationWindow,
  };
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
    analysis_mode: optionalBoundedString(
      context.analysis_mode,
      "analysis_mode",
      40,
    ),
    research_mode: optionalBoundedString(
      context.research_mode,
      "research_mode",
      40,
    ),
    run_kind: optionalBoundedString(context.run_kind, "run_kind", 60),
    agent_turn: optionalInt(context.agent_turn, "agent_turn", {
      min: 0,
      max: 200,
    }),
  });
}

function requireToolName(value: unknown): DesktopOntologyToolName {
  if (isDesktopOntologyToolName(value)) return value;
  throw new DesktopContractError(
    `Unsupported ontology tool: ${String(value)}`,
    {
      code: "tool_not_allowed",
      publicMessage: "허용되지 않은 온톨로지 도구입니다.",
      status: 403,
    },
  );
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
  if (typeof value === "string" && values.includes(value as T))
    return value as T;
  throw new DesktopContractError(
    `${name} must be one of: ${values.join(", ")}`,
  );
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
    throw new DesktopContractError(
      `${name} must be between ${options.min} and ${options.max}`,
    );
  }
  return value;
}

function optionalBoolean(
  value: unknown,
  name: string,
  fallback: boolean,
): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new DesktopContractError(`${name} must be a boolean`);
  }
  return value;
}

function requirePatternString(
  value: unknown,
  name: string,
  maxLength: number,
  pattern: RegExp,
): string {
  const result = requireBoundedString(value, name, maxLength);
  if (!pattern.test(result)) {
    throw new DesktopContractError(`${name} has an invalid format`);
  }
  return result;
}

function optionalNullableEnum<T extends string>(
  value: unknown,
  name: string,
  values: readonly T[],
): T | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && values.includes(value as T)) {
    return value as T;
  }
  throw new DesktopContractError(
    `${name} must be one of: ${values.join(", ")}`,
  );
}

function optionalStringEnumArray<T extends string>(
  value: unknown,
  name: string,
  values: readonly T[],
  maxItems: number,
): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new DesktopContractError(
      `${name} must contain at most ${maxItems} items`,
    );
  }
  const normalized = value.map((entry, index) => {
    if (typeof entry !== "string" || !values.includes(entry as T)) {
      throw new DesktopContractError(
        `${name}[${index}] must be one of: ${values.join(", ")}`,
      );
    }
    return entry as T;
  });
  return Array.from(new Set(normalized));
}

function optionalBoundedStringArray(
  value: unknown,
  name: string,
  options: {
    maxItems: number;
    maxLength: number;
    uppercase?: boolean;
  },
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > options.maxItems) {
    throw new DesktopContractError(
      `${name} must contain at most ${options.maxItems} items`,
    );
  }
  return Array.from(
    new Set(
      value.map((entry, index) => {
        const normalized = requireBoundedString(
          entry,
          `${name}[${index}]`,
          options.maxLength,
        );
        return options.uppercase ? normalized.toUpperCase() : normalized;
      }),
    ),
  );
}

function requireObjectArray(
  value: unknown,
  name: string,
  options: { min: number; max: number },
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new DesktopContractError(`${name} must be an array`);
  }
  if (value.length < options.min || value.length > options.max) {
    throw new DesktopContractError(
      `${name} must contain ${options.min}-${options.max} items`,
    );
  }
  return value.map((entry, index) =>
    assertPlainObject(entry, `${name}[${index}]`),
  );
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  name: string,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    throw new DesktopContractError(
      `${name} contains unsupported fields: ${unexpected.join(", ")}`,
    );
  }
}

function planTokens(value: string): string[] {
  return (
    value
      .toLocaleLowerCase("en-US")
      .match(/[0-9a-z\u3131-\u318e\uac00-\ud7a3_]+/gu) ?? []
  );
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
    throw new DesktopContractError(
      `${name} must have ${options.min}-${options.max} tickers`,
    );
  }
  return Array.from(
    new Set(
      value.map((item, index) => normalizeTicker(item, `${name}[${index}]`)),
    ),
  );
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
