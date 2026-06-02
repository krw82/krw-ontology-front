const MAX_STRIP_ITERATIONS = 24;

const INTERNAL_PROGRESS_VERBS =
  "(?:read|retrieve|trace|run|query|check|search|inspect|get|gather|look\\s+up|analy[sz]e|compare|review|open)";

const LEADING_ENGLISH_PROGRESS_START = new RegExp(
  `^\\s*(?:let\\s+me\\s+${INTERNAL_PROGRESS_VERBS}\\b|(?:i'll|i\\s+will|i\\s+need\\s+to|i\\s+should)\\s+${INTERNAL_PROGRESS_VERBS}\\b|(?:now|next,?)\\s+(?:let\\s+me|i'll|i\\s+will)\\s+${INTERNAL_PROGRESS_VERBS}\\b)`,
  "i",
);

const FOLLOWUP_PROGRESS_START = new RegExp(
  `^\\s*(?:let\\s+me\\s+${INTERNAL_PROGRESS_VERBS}\\b|(?:i'll|i\\s+will|i\\s+need\\s+to|i\\s+should)\\s+${INTERNAL_PROGRESS_VERBS}\\b|(?:now|next,?)\\s+(?:let\\s+me|i'll|i\\s+will)\\s+${INTERNAL_PROGRESS_VERBS}\\b|이제\\s+충분한\\s+증거|분석\\s+결과|답변을\\s+작성|최종\\s+답변)`,
  "i",
);

const LEADING_KOREAN_PROGRESS_PATTERNS = [
  /^\s*이제\s+충분한\s+증거를\s+확보했습니다\.?/,
  /^\s*분석\s+결과를\s+작성하겠습니다\.?/,
  /^\s*답변을\s+작성하겠습니다\.?/,
  /^\s*최종\s+답변을\s+작성하겠습니다\.?/,
  /^\s*이제\s+답변을\s+작성하겠습니다\.?/,
];

const LEADING_SEPARATOR_PATTERN = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*/;
const LEADING_TOOL_XML_PATTERNS = [
  /^\s*<function_calls\b[\s\S]*?<\/function_calls>\s*/i,
  /^\s*<tool_use\b[\s\S]*?<\/tool_use>\s*/i,
  /^\s*<invoke\b[\s\S]*?<\/invoke>\s*/i,
];
const LEADING_TRUNCATED_TOOL_XML_PATTERN =
  /^\s*<(?:function_calls|tool_use|invoke)\b/i;

function isLikelyFollowupBoundary(value: string): boolean {
  if (!value.trim()) return true;
  if (FOLLOWUP_PROGRESS_START.test(value)) return true;
  return /^\s*(?:-{3,}|\*{3,}|_{3,}|#{1,6}\s|\n+\s*\S)/.test(value);
}

function stripLeadingToolXml(value: string): string {
  for (const pattern of LEADING_TOOL_XML_PATTERNS) {
    const match = value.match(pattern);
    if (match) return value.slice(match[0].length);
  }

  const trimmed = value.trimStart();
  if (trimmed.length <= 240 && LEADING_TRUNCATED_TOOL_XML_PATTERN.test(trimmed)) {
    return "";
  }

  return value;
}

function stripLeadingKoreanProgress(value: string): string {
  for (const pattern of LEADING_KOREAN_PROGRESS_PATTERNS) {
    const match = value.match(pattern);
    if (match) return value.slice(match[0].length);
  }

  return value;
}

function stripLeadingEnglishProgress(value: string): string {
  const start = value.match(LEADING_ENGLISH_PROGRESS_START);
  if (!start) return value;

  for (let index = start[0].length; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "." && char !== "!" && char !== "?") continue;

    const after = value.slice(index + 1);
    if (isLikelyFollowupBoundary(after)) {
      return after;
    }
  }

  return value.trim().length <= 240 ? "" : value;
}

/**
 * Removes assistant-only internal progress text from user-facing surfaces and
 * prompt history. It intentionally does not change the stored message row.
 */
export function sanitizeAssistantContent(content: string): string {
  let output = content.replace(/\r\n/g, "\n");
  let strippedInternalContent = false;

  for (let index = 0; index < MAX_STRIP_ITERATIONS; index += 1) {
    const before = output;

    output = stripLeadingToolXml(output);
    if (output !== before) {
      strippedInternalContent = true;
      continue;
    }

    const withoutEnglishProgress = stripLeadingEnglishProgress(output);
    if (withoutEnglishProgress !== output) {
      output = withoutEnglishProgress;
      strippedInternalContent = true;
      continue;
    }

    const withoutKoreanProgress = stripLeadingKoreanProgress(output);
    if (withoutKoreanProgress !== output) {
      output = withoutKoreanProgress;
      strippedInternalContent = true;
      continue;
    }

    if (strippedInternalContent) {
      const withoutSeparator = output.replace(LEADING_SEPARATOR_PATTERN, "");
      if (withoutSeparator !== output) {
        output = withoutSeparator;
        continue;
      }
    }

    break;
  }

  return output.trimStart();
}

export function sanitizeAssistantPreviewContent(content: string): string {
  return sanitizeAssistantContent(content).replace(/\s+/g, " ").trim();
}
