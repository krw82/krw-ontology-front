import type {
  StreamingCitation,
  MCPToolName,
} from "@/types/api-contracts";

/**
 * A run's accumulated stream state. Historically built by the legacy
 * Claude-agent stream handler; now the shape of persisted run events that
 * artifact builders read back.
 */
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
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
}
