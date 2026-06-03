import type { KRWOntologyMCPToolName } from "@/types/api-contracts";

export interface ToolInputPolicyResult {
  input: Record<string, unknown>;
  changed: boolean;
}

const RESPONSE_DETAIL_TOOL_SET = new Set<KRWOntologyMCPToolName>([
  "krw_ontology_query",
  "krw_ontology_retrieve",
  "krw_ontology_compare",
]);

export function normalizeKrwOntologyToolInput(
  mcpToolName: KRWOntologyMCPToolName | null,
  input: Record<string, unknown>,
): ToolInputPolicyResult {
  const downgradedInput = downgradeFullResponseDetailInput(mcpToolName, input);
  if (!downgradedInput) {
    return { input, changed: false };
  }

  return { input: downgradedInput, changed: true };
}

function downgradeFullResponseDetailInput(
  mcpToolName: KRWOntologyMCPToolName | null,
  input: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!mcpToolName || !RESPONSE_DETAIL_TOOL_SET.has(mcpToolName)) return null;
  if (input.response_detail !== "full") return null;
  return {
    ...input,
    response_detail: "compact",
  };
}
