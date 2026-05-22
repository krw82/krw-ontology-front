import type {
  StreamingEventType,
  StreamingCitation,
  MCPToolName,
} from "@/types/api-contracts";

export interface AccumulatedRun {
  fullText: string;
  structuredOutput: unknown;
  researchSynthesisOutput: unknown;
  researchSynthesisText: string | null;
  displayPlanOutput: unknown;
  toolCalls: Array<{
    id: string;
    toolName: MCPToolName;
    argumentsJson: string;
    resultSummary: string | null;
    resultJson: unknown;
    resultText: string | null;
    startedAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
  }>;
  citations: StreamingCitation[];
  inputTokens: number;
  outputTokens: number;
}

export type AccumulatedToolCall = AccumulatedRun["toolCalls"][number];

export function createAccumulator(): AccumulatedRun {
  return {
    fullText: "",
    structuredOutput: null,
    researchSynthesisOutput: null,
    researchSynthesisText: null,
    displayPlanOutput: null,
    toolCalls: [],
    citations: [],
    inputTokens: 0,
    outputTokens: 0,
  };
}

export interface StreamWriter {
  write: (chunk: Uint8Array) => Promise<void>;
}

export function createSSEWriter(stream: StreamWriter) {
  const encoder = new TextEncoder();

  async function sendEvent(event: StreamingEventType, data: unknown) {
    await stream.write(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    );
  }

  return { sendEvent };
}

export function addToken(acc: AccumulatedRun, text: string) {
  acc.fullText += text;
}

export function startToolCall(
  acc: AccumulatedRun,
  id: string,
  toolName: MCPToolName,
  args: Record<string, unknown>
) {
  const toolCall: AccumulatedToolCall = {
    id,
    toolName,
    argumentsJson: JSON.stringify(args),
    resultSummary: null,
    resultJson: null,
    resultText: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    errorMessage: null,
  };
  acc.toolCalls.push(toolCall);
  return toolCall;
}

export function endToolCall(
  acc: AccumulatedRun,
  id: string,
  resultSummary: string | null,
  errorMessage: string | null,
  resultJson?: unknown,
  resultText?: string | null,
) {
  const tc = acc.toolCalls.find((t) => t.id === id);
  if (tc) {
    const now = new Date();
    tc.resultSummary = resultSummary
      ? resultSummary.slice(0, 2000)
      : tc.resultSummary;
    if (resultJson !== undefined) {
      tc.resultJson = resultJson;
    }
    if (resultText !== undefined) {
      tc.resultText = resultText ? resultText.slice(0, 100_000) : null;
    }
    tc.finishedAt = now.toISOString();
    tc.errorMessage = errorMessage;
    return tc;
  }
  return null;
}

export function addCitation(acc: AccumulatedRun, citation: StreamingCitation) {
  acc.citations.push(citation);
}

// Note: Usage accumulates across all agent loop iterations.
// For a 5-iteration run, totals include all 5 Claude API calls.
// This is correct for cost tracking but represents total, not per-message.
export function setUsage(
  acc: AccumulatedRun,
  inputTokens: number,
  outputTokens: number
) {
  acc.inputTokens += inputTokens;
  acc.outputTokens += outputTokens;
}
