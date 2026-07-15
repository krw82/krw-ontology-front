const MAX_STRIP_ITERATIONS = 24;

const INTERNAL_PROGRESS_VERBS =
  "(?:read|retrieve|trace|run|query|check|verify|search|inspect|get|gather|look\\s+up|analy[sz]e|compare|review|open)";

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
  /^\s*서브에이전트에\s+위임하겠습니다\.?/,
  /^\s*(?:ResearchPack|CompanyEvidencePack|Guru\s+ResearchPack|GuruCompanyResearchPack)\s+수신\s+완료\.?/i,
];

const LEADING_WORKFLOW_STATUS_PATTERNS = [
  // The SDK can occasionally emit this transition after the final Guru review.
  // It is a completion marker for the assistant, not consultation prose.
  /^\s*(?:evidence\s+)?review\s+(?:has\s+been\s+)?validated\.\s*(?:(?:now\s+)?i\s+have|let\s+me)[^.!?\n]*(?:[.!?]\s*)/i,
  /^\s*[^.!?\n]*(?:ResearchPack|CompanyEvidencePack|Guru\s+ResearchPack|GuruCompanyResearchPack|GuruCompanyEvidenceReview|company_evidence_researcher|subagent|parameter\s+encoding|tool\s+call|MCP)\b[^.!?\n]*(?:[.!?]\s*)/i,
  /^\s*(?:ResearchPack|CompanyEvidencePack|Guru\s+ResearchPack|GuruCompanyResearchPack)\b[^.!?\n]*(?:[.!?]\s*)/i,
  /^\s*(?:company\s+evidence|filing\s+evidence)\s+(?:is\s+needed|received|supplied)\b[^.!?\n]*(?:[.!?]\s*)/i,
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

function isLikelyAnswerSentenceStart(value: string): boolean {
  return (
    /^\s*(?:Based|Overall|In|For|The|This|These|Those|My|I|At|From|Against|Compared|However|Therefore|So)\b/.test(
      value,
    ) || /^\s*[가-힣]/.test(value)
  );
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

function stripLeadingWorkflowStatus(value: string): string {
  for (const pattern of LEADING_WORKFLOW_STATUS_PATTERNS) {
    const match = value.match(pattern);
    if (match) return value.slice(match[0].length);
  }

  return value;
}

function stripLeadingInternalWorkflowBlock(value: string): string {
  const probe = value.slice(0, 1800);
  if (
    !/\b(?:ResearchPack|CompanyEvidencePack|GuruCompanyEvidenceReview|company_evidence_researcher|subagent|parameter\s+encoding|MCP|tool)\b|서브에이전트|도구|수신 완료/i.test(
      probe,
    )
  ) {
    return value;
  }

  const koreanAnswerStart = probe.match(
    /(?:^|[.!?]\s*)(자,|먼저|결론|내가|제가|이\s+회사는|버핏|막스|애크먼|플랫|테리|[가-힣]{2,}[^.!?\n]{0,40}(?:은|는|이|가)\s)/,
  );
  const separator = probe.match(/(?:^|\n)\s*-{3,}\s*\n+/);
  if (koreanAnswerStart?.index !== undefined && koreanAnswerStart.index > 0) {
    const marker = koreanAnswerStart[1] ?? "";
    const start = probe.indexOf(marker, koreanAnswerStart.index);
    if (
      start > 0 &&
      (separator?.index === undefined || start < separator.index)
    ) {
      return value.slice(start);
    }
  }

  if (separator?.index !== undefined) {
    const start = separator.index + separator[0].length;
    if (start > 0) return value.slice(start);
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
    if (isLikelyFollowupBoundary(after) || isLikelyAnswerSentenceStart(after)) {
      return after;
    }
  }

  return value.trim().length <= 240 ? "" : value;
}

function stripInternalEvidencePhrases(value: string): string {
  return value
    .replace(/,\s*verified\s+(?:by|from)\s+trace\b/gi, "")
    .replace(/\s*\((?:verified\s+(?:by|from)\s+trace)\)/gi, "")
    .replace(/\bverified\s+(?:by|from)\s+trace\b/gi, "supported by filing evidence");
}

function stripStandaloneHorizontalRules(value: string): string {
  return value
    .replace(/\n{2,}\s*(?:-{3,}|\*{3,}|_{3,})\s*\n{2,}/g, "\n\n")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*\n+/, "")
    .replace(/\n+\s*(?:-{3,}|\*{3,}|_{3,})\s*$/g, "\n");
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

    const withoutInternalBlock = stripLeadingInternalWorkflowBlock(output);
    if (withoutInternalBlock !== output) {
      output = withoutInternalBlock;
      strippedInternalContent = true;
      continue;
    }

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

    const withoutWorkflowStatus = stripLeadingWorkflowStatus(output);
    if (withoutWorkflowStatus !== output) {
      output = withoutWorkflowStatus;
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

  return stripStandaloneHorizontalRules(stripInternalEvidencePhrases(output)).trimStart();
}

export function sanitizeAssistantPreviewContent(content: string): string {
  return sanitizeAssistantContent(content).replace(/\s+/g, " ").trim();
}
