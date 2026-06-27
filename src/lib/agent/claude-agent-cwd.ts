import { mkdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_AGENT_WORKSPACE_DIR = ".agent-workspace";

export async function resolveClaudeAgentCwd(): Promise<string> {
  const configured = process.env.CLAUDE_AGENT_CWD?.trim();
  const cwd = configured || path.join(process.cwd(), DEFAULT_AGENT_WORKSPACE_DIR);

  if (!path.isAbsolute(cwd)) {
    throw new Error(
      `CLAUDE_AGENT_CWD must be an absolute path when set: ${cwd}`,
    );
  }

  await mkdir(cwd, { recursive: true });
  return cwd;
}
