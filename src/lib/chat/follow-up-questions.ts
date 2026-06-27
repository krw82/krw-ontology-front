const MAX_FOLLOW_UP_QUESTIONS = 5;
const MIN_FOLLOW_UP_QUESTIONS = 2;
const MAX_FOLLOW_UP_QUESTION_LENGTH = 220;

const FOLLOW_UP_HEADINGS = [
  "이어서 볼 질문",
  "이어서 보면 좋은 질문",
  "다음으로 파고들 질문",
  "다음 질문",
  "follow-up questions",
  "follow up questions",
  "next questions",
  "questions to ask next",
] as const;

const LIST_ITEM_PATTERN = /^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+?)\s*$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;
const MARKDOWN_HEADING_PATTERN = /^\s{0,3}#{1,6}\s+/;
const INTERNAL_TERM_PATTERN =
  /\b(?:query_context|krw[_-]?ontology|mcp|tool|schema|system prompt|source_pack|metric_series_pack|chart_series|artifact|json|sql)\b/i;
const COMMAND_ENDING_PATTERN =
  /(줘|해줘|보여줘|알려줘|뽑아줘|정리해줘|나눠줘|점검해줘|비교해줘|봐줘|볼까|볼까요|인가요|나요|까요|습니까)\??\.?$/;
const QUESTION_ENDING_PATTERN = /[?？]$/;

export interface ExtractedFollowUpQuestions {
  body: string;
  questions: string[];
}

export function extractFollowUpQuestions(
  content: string,
): ExtractedFollowUpQuestions | null {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const lines = normalized.split("\n");
  const headingIndex = findLastFollowUpHeadingIndex(lines);
  if (headingIndex < 0) return null;

  const body = lines.slice(0, headingIndex).join("\n").trim();
  if (!body) return null;

  const questions = parseFollowUpQuestionLines(lines.slice(headingIndex + 1));
  if (!questions) return null;

  return {
    body,
    questions,
  };
}

function findLastFollowUpHeadingIndex(lines: string[]): number {
  let inFence = false;
  let matchedIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE_PATTERN.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (isFollowUpHeading(line)) matchedIndex = index;
  }

  return matchedIndex;
}

function isFollowUpHeading(line: string): boolean {
  const normalized = line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*/, "")
    .replace(/\*\*$/, "")
    .replace(/[:：]\s*$/, "")
    .trim()
    .toLowerCase();

  return FOLLOW_UP_HEADINGS.some((heading) => normalized === heading);
}

function parseFollowUpQuestionLines(lines: string[]): string[] | null {
  const questions: string[] = [];
  let sawListItem = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (FENCE_PATTERN.test(line)) return null;
    if (MARKDOWN_HEADING_PATTERN.test(line)) return null;

    const listMatch = line.match(LIST_ITEM_PATTERN);
    const candidate = listMatch?.[1]?.trim() ?? line;

    if (listMatch) {
      sawListItem = true;
    } else if (sawListItem) {
      return null;
    }

    const question = normalizeFollowUpQuestion(candidate);
    if (!question) return null;
    questions.push(question);

    if (questions.length > MAX_FOLLOW_UP_QUESTIONS) return null;
  }

  const uniqueQuestions = Array.from(new Set(questions));
  if (uniqueQuestions.length < MIN_FOLLOW_UP_QUESTIONS) return null;
  return uniqueQuestions;
}

function normalizeFollowUpQuestion(value: string): string | null {
  const question = value
    .replace(/^\*\*/, "")
    .replace(/\*\*$/, "")
    .trim();

  if (!question) return null;
  if (question.length > MAX_FOLLOW_UP_QUESTION_LENGTH) return null;
  if (INTERNAL_TERM_PATTERN.test(question)) return null;
  if (question.includes("://")) return null;
  if (question.startsWith("|") || question.startsWith(">")) return null;
  if (!QUESTION_ENDING_PATTERN.test(question) && !COMMAND_ENDING_PATTERN.test(question)) {
    return null;
  }

  return question;
}
