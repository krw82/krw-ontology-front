import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  query,
  type Options,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { buildClaudeAgentEnv } from "@/lib/agent/env";
import { getKrwOntologyPluginPath } from "@/lib/agent/mcp-client";
import { getClaudeAgentModel } from "@/lib/agent/model";
import { readIntEnv } from "@/lib/env";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatSessionRow,
  MessageRow,
  UserCompanyQuestionRow,
} from "@/types/database";

const SESSION_SELECT =
  "id, title, scope_type, default_tickers, last_message_preview, last_message_at, latest_run_status, created_at, updated_at";
const MESSAGE_SELECT =
  "id, session_id, role, content, status, request_id, created_at, updated_at";

const DEFAULT_AGENT_WORKSPACE_DIR = ".agent-workspace";
const NOTEBOOK_MAX_LENGTH = 100_000;
const EXISTING_NOTEBOOK_PROMPT_LIMIT = 45_000;
const MESSAGE_PROMPT_LIMIT = 10_000;
const DEFAULT_RECENT_CONVERSATION_LIMIT = 3;
const RECENT_SESSION_CANDIDATE_MULTIPLIER = 4;
const DEFAULT_NOTEBOOK_AGENT_MAX_TURNS = 3;
const OPEN_QUESTION_MAX_COUNT = 5;
const AUTO_QUESTION_VISIBLE_INTERVAL_HOURS = 10;
const QUESTION_MAX_LENGTH = 1200;
const NOTEBOOK_TEMPLATE_SECTIONS = [
  "내가 보고 있는 이유",
  "긍정 논리",
  "반대 논리",
  "생각이 바뀔 수 있는 신호",
];
const DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Task",
  "Glob",
  "Grep",
  "LS",
  "Skill",
];

export interface NotebookConversationInput {
  session_id: string;
  session_title: string;
  user_message_id: string | null;
  assistant_message_id: string;
  user_question: string;
  assistant_answer: string;
  created_at: string;
}

export interface GenerateResearchNotebookInput {
  ticker: string;
  companyName: string;
  basisPeriod: string | null;
  existingNotebookMd: string;
  recentConversations: NotebookConversationInput[];
}

export async function listRecentTickerNotebookConversations(
  userId: string,
  rawTicker: string,
  limit = DEFAULT_RECENT_CONVERSATION_LIMIT,
): Promise<NotebookConversationInput[]> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker || limit <= 0) return [];

  const sessionLimit = Math.max(limit * RECENT_SESSION_CANDIDATE_MULTIPLIER, limit);
  const admin = getSupabaseAdmin();
  const { data: sessions, error } = await admin
    .from("chat_sessions")
    .select(SESSION_SELECT)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .contains("default_tickers", [ticker])
    .not("last_message_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(sessionLimit)
    .returns<ChatSessionRow[]>();

  if (error) {
    throw new Error(`Failed to load recent ticker sessions: ${error.message}`);
  }

  const conversations = (
    await Promise.all(
      (sessions ?? []).map((session) => loadNotebookConversationFromSession(session)),
    )
  )
    .filter((conversation): conversation is NotebookConversationInput =>
      Boolean(conversation),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

  return conversations.slice(0, limit);
}

export async function generateResearchNotebookMarkdown(
  input: GenerateResearchNotebookInput,
): Promise<string> {
  const ticker = normalizeTicker(input.ticker) ?? input.ticker.trim().toUpperCase();
  if (!ticker) throw new Error("Missing ticker for notebook refresh.");

  const promptPayload = {
    ticker,
    company_name: input.companyName,
    basis_period: input.basisPeriod,
    update_mode: "merge-research-answer",
    notebook_template: buildNotebookTemplate(),
    allowed_sections: NOTEBOOK_TEMPLATE_SECTIONS,
    forbidden_sections: [
      `${ticker} 리서치 노트북`,
      "기준 분기",
      "기준 공시",
      "기준 기간",
      "마지막 업데이트",
      "다음에 볼 것",
      "확인할 질문",
      "최근 업데이트",
      "새로 확인한 점",
      "현재 생각",
    ],
    existing_notebook_md: truncateForPrompt(
      input.existingNotebookMd,
      EXISTING_NOTEBOOK_PROMPT_LIMIT,
    ),
    recent_conversations: input.recentConversations.map((conversation) => ({
      session_id: conversation.session_id,
      title: conversation.session_title,
      user_question: truncateForPrompt(
        conversation.user_question,
        MESSAGE_PROMPT_LIMIT,
      ),
      assistant_answer: truncateForPrompt(
        conversation.assistant_answer,
        MESSAGE_PROMPT_LIMIT,
      ),
      created_at: conversation.created_at,
    })),
  };

  const prompt = [
    "Use $krw-ontology-research-notebook.",
    "Mode: merge-research-answer.",
    "Merge recent conversations into the existing personal Markdown notebook without turning it into a company report.",
    "Use the fixed section template in the payload: 내가 보고 있는 이유, 긍정 논리, 반대 논리, 생각이 바뀔 수 있는 신호.",
    "Do not include a title line or metadata line in the Markdown body.",
    "Use short topic-based bullets by default. A small Markdown table is okay when it makes comparison clearer. Do not write long paragraphs.",
    "Keep one idea per bullet and at most one number per bullet.",
    "Write in simple Korean for a personal investor. Prefer direction and what to watch over dense numerical recap.",
    "Keep only the few numbers that matter to the user's current view. If period basis or source is unclear, leave it out of the notebook.",
    "Avoid analyst-style certainty. Use wording like 현재는 ...로 보고 있음, 아직 확인 필요, 계속 봐야 함.",
    "Remove any existing notebook title, `기준 분기`, `기준 공시`, `기준 기간`, or `마지막 업데이트` lines.",
    "Do not create a `## 다음에 볼 것` section.",
    "Do not create a `## 확인할 질문` section.",
    "Do not create a `## 최근 업데이트` section.",
    "Do not create a `## 새로 확인한 점` section.",
    "Do not create a `## 현재 생각` section.",
    "Markdown tables are allowed only when they make a small comparison or checklist clearer; keep them compact and avoid source, valuation, segment financial, or dense numeric tables.",
    "Do not start with a company overview, business overview, segment overview, or tearsheet-style summary.",
    "Return only the final Markdown notebook. Do not use tools. Do not add explanations.",
    "",
    "Payload:",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n");

  const markdown = await runNotebookAgent(prompt);

  return normalizeNotebookMarkdown(markdown, ticker).slice(0, NOTEBOOK_MAX_LENGTH);
}

export async function generateResearchNotebookOpenQuestions(
  input: GenerateResearchNotebookInput,
): Promise<string[]> {
  const ticker = normalizeTicker(input.ticker) ?? input.ticker.trim().toUpperCase();
  if (!ticker) throw new Error("Missing ticker for notebook question extraction.");

  const promptPayload = {
    ticker,
    company_name: input.companyName,
    basis_period: input.basisPeriod,
    update_mode: "extract-open-questions",
    max_questions: OPEN_QUESTION_MAX_COUNT,
    existing_notebook_md: truncateForPrompt(
      input.existingNotebookMd,
      EXISTING_NOTEBOOK_PROMPT_LIMIT,
    ),
    recent_conversations: input.recentConversations.map((conversation) => ({
      session_id: conversation.session_id,
      title: conversation.session_title,
      user_question: truncateForPrompt(
        conversation.user_question,
        MESSAGE_PROMPT_LIMIT,
      ),
      assistant_answer: truncateForPrompt(
        conversation.assistant_answer,
        MESSAGE_PROMPT_LIMIT,
      ),
      created_at: conversation.created_at,
    })),
  };

  const prompt = [
    "Use $krw-ontology-research-notebook.",
    "Mode: extract-open-questions.",
    "Extract unresolved questions from recent conversations and the existing notebook.",
    "Return only a compact JSON array of Korean question strings.",
    "Do not include questions already answered by the notebook.",
    "Do not include buy/sell/target-price questions.",
    "Do not use tools. Do not add explanations.",
    "",
    "Payload:",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n");

  const result = await runNotebookAgent(prompt);
  return parseQuestionArray(result).slice(0, OPEN_QUESTION_MAX_COUNT);
}

export async function saveExtractedNotebookQuestions(input: {
  userId: string;
  ticker: string;
  questions: string[];
  sourceConversation: NotebookConversationInput | null;
}): Promise<number> {
  const ticker = normalizeTicker(input.ticker) ?? input.ticker.trim().toUpperCase();
  if (!ticker) return 0;

  const normalizedQuestions = dedupeQuestions(input.questions);
  const admin = getSupabaseAdmin();

  const now = new Date();
  const nowIso = now.toISOString();

  const { error: dismissError } = await admin
    .from("user_company_questions")
    .update({
      status: "dismissed",
      answered_at: null,
      updated_at: nowIso,
    })
    .eq("user_id", input.userId)
    .eq("ticker", ticker)
    .eq("source", "saved_from_chat")
    .eq("status", "open");

  if (dismissError) {
    throw new Error(`Failed to dismiss old notebook questions: ${dismissError.message}`);
  }

  if (normalizedQuestions.length === 0) return 0;

  const { data: existingRows, error: existingError } = await admin
    .from("user_company_questions")
    .select("question")
    .eq("user_id", input.userId)
    .eq("ticker", ticker)
    .neq("source", "saved_from_chat")
    .returns<Array<Pick<UserCompanyQuestionRow, "question">>>();

  if (existingError) {
    throw new Error(`Failed to load existing notebook questions: ${existingError.message}`);
  }

  const existingKeys = new Set(
    (existingRows ?? []).map((row) => normalizeQuestionKey(row.question)),
  );
  const newQuestions = normalizedQuestions.filter((question) => {
    const key = normalizeQuestionKey(question);
    if (!key || existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });

  if (newQuestions.length === 0) return 0;

  const { error } = await admin.from("user_company_questions").insert(
    newQuestions.map((question, index) => ({
      user_id: input.userId,
      ticker,
      question,
      status: "open" as const,
      source: "saved_from_chat" as const,
      source_chat_session_id: input.sourceConversation?.session_id ?? null,
      source_message_id: input.sourceConversation?.assistant_message_id ?? null,
      visible_after_at: new Date(
        now.getTime() + index * AUTO_QUESTION_VISIBLE_INTERVAL_HOURS * 60 * 60 * 1000,
      ).toISOString(),
    })),
  );

  if (error) {
    throw new Error(`Failed to save extracted notebook questions: ${error.message}`);
  }

  return newQuestions.length;
}

function buildNotebookTemplate(): string {
  return [
    "## 내가 보고 있는 이유",
    "- 왜 이 종목을 계속 보고 있는지.",
    "",
    "## 긍정 논리",
    "- 이 회사가 좋아질 수 있다고 보는 이유.",
    "- 현재 생각을 지지하는 근거.",
    "",
    "## 반대 논리",
    "- 내 생각이 틀릴 수 있는 이유.",
    "- 시장이 우려할 만한 지점.",
    "",
    "## 생각이 바뀔 수 있는 신호",
    "- 어떤 일이 생기면 기존 생각을 다시 봐야 하는지.",
  ].join("\n");
}

async function runNotebookAgent(prompt: string): Promise<string> {
  const cwd = await resolveNotebookAgentCwd();
  const pluginPath = getKrwOntologyPluginPath();
  const sdkOptions: Options = {
    cwd,
    model: getClaudeAgentModel(),
    pathToClaudeCodeExecutable:
      process.env.CLAUDE_CODE_EXECUTABLE || undefined,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: [
        "You transform app-provided text for one personal investor research notebook.",
        "For merge-research-answer, preserve the notebook and merge only useful new observations and change signals.",
        "Use only these notebook sections: 내가 보고 있는 이유, 긍정 논리, 반대 논리, 생각이 바뀔 수 있는 신호.",
        "Do not include a title line, H1, basis period line, filing basis line, or last-updated metadata line in the notebook body.",
        "Write section content as short topic-based bullets by default. A small Markdown table is okay when it makes comparison clearer. Do not write paragraph blocks.",
        "Keep one idea per bullet and at most one number per bullet.",
        "Do not create 현재 생각, 새로 확인한 점, 확인할 질문, 최근 업데이트, or 다음에 볼 것 sections in the notebook body.",
        "For extract-open-questions, return only a JSON array of unresolved question strings.",
        "Write like a careful individual investor, not a formal analyst memo. Use simple Korean and short sentences.",
        "Prefer directional notes over dense numbers. Keep only the most important 2-4 numbers when necessary.",
        "Do not list every percentage, growth rate, margin, or period from the conversations.",
        "If FY/CY/quarter basis is mixed or unclear, do not assert it as fact.",
        "Avoid wording like 스토리는 온전히 유지, 단기 노이즈, 사상 최고 수준, 결론적으로, 투자 포인트.",
        "Allow only compact personal-note Markdown tables when they clarify a comparison or checklist. Never write source, valuation, segment financial, or dense numeric tables. Never write a company overview or tearsheet.",
        "Never query files, databases, MCP tools, web, or external services.",
        "Return only the requested payload, with no code fence or explanation.",
      ].join("\n"),
    },
    plugins: [{ type: "local", path: pluginPath }],
    tools: [],
    allowedTools: [],
    disallowedTools: DISALLOWED_TOOLS,
    permissionMode: "dontAsk",
    allowDangerouslySkipPermissions: false,
    canUseTool: denyAllTools,
    settingSources: [],
    maxTurns: readIntEnv(
      "NOTEBOOK_AGENT_MAX_TURNS",
      DEFAULT_NOTEBOOK_AGENT_MAX_TURNS,
      { min: 1 },
    ),
    includePartialMessages: false,
    abortController: new AbortController(),
    env: buildClaudeAgentEnv(),
    sessionId: randomUUID(),
  };

  let output = "";
  let resultError: string | null = null;
  const sdkQuery = query({ prompt, options: sdkOptions });
  for await (const message of sdkQuery) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        if (!output.trim() && typeof message.result === "string") {
          output = message.result;
        }
      } else {
        resultError = Array.isArray(message.errors)
          ? message.errors.join("\n")
          : "Notebook agent execution failed.";
      }
      continue;
    }

    output += textFromSdkMessage(message);
  }

  if (resultError) throw new Error(resultError);
  return output;
}

async function loadNotebookConversationFromSession(
  session: ChatSessionRow,
): Promise<NotebookConversationInput | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(40)
    .returns<MessageRow[]>();

  if (error) {
    throw new Error(`Failed to load session messages: ${error.message}`);
  }

  const messages = (data ?? []).slice().reverse();
  const assistant = messages
    .slice()
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        message.status === "completed" &&
        message.content.trim().length > 0,
    );

  if (!assistant) return null;

  const assistantIndex = messages.findIndex((message) => message.id === assistant.id);
  const user = messages
    .slice(0, Math.max(assistantIndex, 0))
    .reverse()
    .find((message) => message.role === "user" && message.content.trim());

  return {
    session_id: session.id,
    session_title: session.title || "제목 없는 대화",
    user_message_id: user?.id ?? null,
    assistant_message_id: assistant.id,
    user_question: user?.content.trim() || session.title || "",
    assistant_answer: assistant.content.trim(),
    created_at: assistant.created_at,
  };
}

async function resolveNotebookAgentCwd(): Promise<string> {
  const configured = process.env.CLAUDE_AGENT_CWD?.trim();
  const cwd = configured || path.join(process.cwd(), DEFAULT_AGENT_WORKSPACE_DIR);
  if (!path.isAbsolute(cwd)) {
    throw new Error(`CLAUDE_AGENT_CWD must be absolute when set: ${cwd}`);
  }
  await mkdir(cwd, { recursive: true });
  return cwd;
}

async function denyAllTools(): Promise<PermissionResult> {
  return {
    behavior: "deny",
    message: "Notebook refresh must use only the provided payload.",
  };
}

function textFromSdkMessage(message: SDKMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .join("");
}

function normalizeNotebookMarkdown(markdown: string, ticker: string): string {
  const stripped = stripCodeFence(markdown).trim();
  const fallback = buildNotebookTemplate();
  const text = normalizeHeadingLevels(
    stripNotebookBodyChrome(stripped || fallback, ticker),
  );
  const normalized = ensureNotebookSections(text);
  return normalized.trim();
}

function ensureNotebookSections(markdown: string): string {
  const text = markdown.trim();
  if (!text) return buildNotebookTemplate();

  const hasAnyKnownSection = NOTEBOOK_TEMPLATE_SECTIONS.some((section) =>
    new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(text),
  );
  if (hasAnyKnownSection) return text;

  return ["## 내가 보고 있는 이유", "", ...bulletizeLooseText(text)].join("\n");
}

function bulletizeLooseText(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      /^[-*]\s+/.test(line) || /^#{2,6}\s+/.test(line) ? line : `- ${line}`,
    );

  return lines.length > 0 ? lines : ["- 아직 정리되지 않았습니다."];
}

function stripNotebookBodyChrome(markdown: string, ticker: string): string {
  const normalizedTicker = ticker.trim().toUpperCase();
  const headingPattern = new RegExp(
    `^#?\\s*${escapeRegExp(normalizedTicker)}\\s+리서치\\s+노트북\\s*$`,
    "i",
  );
  const metadataPattern =
    /^(?:\*\*)?\s*(?:기준\s*(?:분기|공시|기간)|마지막\s*업데이트)\s*[:：].*?(?:\*\*)?\s*$/;
  const combinedMetadataPattern =
    /^(?:\*\*)?.*(?:기준\s*(?:분기|공시|기간)).*(?:마지막\s*업데이트).*?(?:\*\*)?\s*$/;
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const strippedLines = lines.filter((line) => {
    const trimmed = line.trim();
    const unbolded = trimmed.replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
    if (!trimmed) return true;
    if (headingPattern.test(unbolded)) return false;
    if (metadataPattern.test(unbolded)) return false;
    if (combinedMetadataPattern.test(unbolded)) return false;
    return true;
  });

  return collapseBlankLines(strippedLines).join("\n").trim();
}

function normalizeHeadingLevels(markdown: string): string {
  return markdown.replace(/^#\s+(?!#)/gm, "## ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseBlankLines(lines: string[]): string[] {
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && collapsed[collapsed.length - 1]?.trim() === "") {
      continue;
    }
    collapsed.push(line);
  }
  return collapsed;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:markdown|md|json|text)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1] ?? trimmed;
}

function truncateForPrompt(value: string, maxLength: number): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (normalized.length <= maxLength) return normalized;
  const headLength = Math.floor(maxLength * 0.7);
  const tailLength = maxLength - headLength;
  return [
    normalized.slice(0, headLength).trimEnd(),
    "\n\n[...중간 내용 생략...]\n\n",
    normalized.slice(-tailLength).trimStart(),
  ].join("");
}

function parseQuestionArray(rawValue: string): string[] {
  const value = stripCodeFence(rawValue).trim();
  if (!value) return [];

  const parsed = tryParseQuestionJson(value);
  if (parsed) return dedupeQuestions(parsed);

  const bracketMatch = value.match(/\[[\s\S]*\]/);
  if (bracketMatch) {
    const parsedBracket = tryParseQuestionJson(bracketMatch[0]);
    if (parsedBracket) return dedupeQuestions(parsedBracket);
  }

  return dedupeQuestions(
    value
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
          .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
          .trim(),
      )
      .filter((line) => line.length > 0 && line.includes("?")),
  );
}

function tryParseQuestionJson(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return null;
  }
}

function dedupeQuestions(questions: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawQuestion of questions) {
    const question = normalizeQuestionText(rawQuestion);
    const key = normalizeQuestionKey(question);
    if (!question || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(question);
    if (result.length >= OPEN_QUESTION_MAX_COUNT) break;
  }
  return result;
}

function normalizeQuestionText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUESTION_MAX_LENGTH);
}

function normalizeQuestionKey(value: string): string {
  return normalizeQuestionText(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[?.!？！。]+$/g, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
