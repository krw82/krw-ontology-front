import "server-only";

export const DEFAULT_CLAUDE_AGENT_MODEL = "sonnet";

export function getClaudeAgentModel(): string {
  return process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_AGENT_MODEL;
}
