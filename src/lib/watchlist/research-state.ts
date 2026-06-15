import type {
  ResearchInboxItem,
  ResearchInboxReason,
  ResearchStatus,
} from "@/types/api-contracts";

export const RESEARCH_STALE_DAYS = 30;

export interface ResearchNotebookStateInput {
  content_md: string | null;
  updated_at: string | null;
}

export interface ResearchState {
  status: ResearchStatus;
  status_label: string;
  reason: ResearchInboxReason | null;
  notebook_updated_at: string | null;
  notebook_age_days: number | null;
}

export interface BuildResearchStateInput {
  ticker: string;
  notebook: ResearchNotebookStateInput | null;
  openQuestionCount: number;
  now?: Date;
  staleDays?: number;
}

export interface BuildResearchInboxInput extends ResearchState {
  ticker: string;
  company_name: string;
  open_question_count: number;
  current_question_id?: string | null;
  current_question?: string | null;
}

const STATUS_LABELS: Record<ResearchStatus, string> = {
  ready: "정리됨",
  empty: "비어 있음",
  has_open_questions: "열린 질문 있음",
  stale: "오래됨",
};

const REASON_PRIORITY: Record<ResearchInboxReason, number> = {
  empty_notebook: 100,
  open_questions: 80,
  stale_notebook: 60,
};
const EMPTY_NOTEBOOK_LINES = new Set([
  "내가 보고 있는 이유",
  "현재 생각",
  "새로 확인한 점",
  "긍정 논리",
  "반대 논리",
  "생각이 바뀔 수 있는 신호",
  "아직 기록된 내용이 없습니다.",
  "아직 정리되지 않았습니다.",
  "아직 없습니다.",
  "왜 이 종목을 계속 보고 있는지.",
  "이 회사가 좋아질 수 있다고 보는 이유.",
  "현재 생각을 지지하는 근거.",
  "내 생각이 틀릴 수 있는 이유.",
  "시장이 우려할 만한 지점.",
  "어떤 일이 생기면 기존 생각을 다시 봐야 하는지.",
]);

export function buildResearchState({
  ticker,
  notebook,
  openQuestionCount,
  now = new Date(),
  staleDays = RESEARCH_STALE_DAYS,
}: BuildResearchStateInput): ResearchState {
  const notebookUpdatedAt = notebook?.updated_at ?? null;
  const notebookAgeDays = daysSince(notebookUpdatedAt, now);

  if (isNotebookEmpty(ticker, notebook?.content_md ?? null)) {
    return buildState("empty", "empty_notebook", notebookUpdatedAt, notebookAgeDays);
  }

  if (openQuestionCount > 0) {
    return buildState(
      "has_open_questions",
      "open_questions",
      notebookUpdatedAt,
      notebookAgeDays,
    );
  }

  if (notebookAgeDays !== null && notebookAgeDays > staleDays) {
    return buildState("stale", "stale_notebook", notebookUpdatedAt, notebookAgeDays);
  }

  return buildState("ready", null, notebookUpdatedAt, notebookAgeDays);
}

export function buildResearchInbox(
  items: BuildResearchInboxInput[],
): ResearchInboxItem[] {
  return items
    .map(buildResearchInboxItem)
    .filter((item): item is ResearchInboxItem => Boolean(item))
    .sort((a, b) => {
      const priorityDiff = b.priority - a.priority;
      if (priorityDiff !== 0) return priorityDiff;

      const ageDiff = (b.age_days ?? -1) - (a.age_days ?? -1);
      if (ageDiff !== 0) return ageDiff;

      const questionDiff = b.open_question_count - a.open_question_count;
      if (questionDiff !== 0) return questionDiff;

      return a.ticker.localeCompare(b.ticker);
    });
}

export function buildResearchInboxItem(
  input: BuildResearchInboxInput,
): ResearchInboxItem | null {
  if (!input.reason) return null;

  const title = inboxTitle(input);
  const description = inboxDescription(input);
  const currentQuestion =
    input.reason === "open_questions" ? input.current_question?.trim() || null : null;
  const currentQuestionId =
    input.reason === "open_questions" ? input.current_question_id ?? null : null;
  const action = inboxAction(input, currentQuestion);

  return {
    ticker: input.ticker,
    company_name: input.company_name,
    status: input.status,
    status_label: input.status_label,
    reason: input.reason,
    title,
    description,
    current_question_id: currentQuestionId,
    current_question: currentQuestion,
    dismiss_question_id: currentQuestionId,
    action_label: action.label,
    action_href: action.href,
    secondary_action_label: action.secondaryLabel,
    secondary_action_href: action.secondaryHref,
    priority: REASON_PRIORITY[input.reason],
    age_days: input.notebook_age_days,
    open_question_count: input.open_question_count,
  };
}

export function isNotebookEmpty(
  ticker: string,
  contentMd: string | null | undefined,
): boolean {
  const normalized = normalizeNotebookContent(contentMd);
  if (!normalized) return true;

  const withoutHeading = normalized
    .split("\n")
    .filter((line, index) => {
      if (index !== 0) return true;
      return !isDefaultNotebookHeading(ticker, line);
    })
    .join("\n")
    .trim();

  if (withoutHeading === "") return true;

  const meaningfulLines = withoutHeading
    .split("\n")
    .map(normalizeNotebookLineForEmptyCheck)
    .filter((line) => line && !EMPTY_NOTEBOOK_LINES.has(line));

  return meaningfulLines.length === 0;
}

export function daysSince(
  value: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) {
    return null;
  }

  const diff = now.getTime() - date.getTime();
  if (diff < 0) return 0;
  return Math.floor(diff / 86_400_000);
}

function buildState(
  status: ResearchStatus,
  reason: ResearchInboxReason | null,
  notebookUpdatedAt: string | null,
  notebookAgeDays: number | null,
): ResearchState {
  return {
    status,
    status_label: STATUS_LABELS[status],
    reason,
    notebook_updated_at: notebookUpdatedAt,
    notebook_age_days: notebookAgeDays,
  };
}

function normalizeNotebookContent(contentMd: string | null | undefined): string {
  return (contentMd ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isDefaultNotebookHeading(ticker: string, line: string): boolean {
  const normalizedTicker = ticker.trim().toUpperCase();
  return (
    line.replace(/^#+\s*/, "").trim().toUpperCase() ===
    `${normalizedTicker} 리서치 노트북`.toUpperCase()
  );
}

function normalizeNotebookLineForEmptyCheck(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
}

function inboxTitle(input: BuildResearchInboxInput): string {
  if (input.reason === "empty_notebook") {
    return "노트북이 아직 비어 있습니다.";
  }

  if (input.reason === "open_questions") {
    const question = input.current_question?.trim();
    if (question) return question;
    return `열린 질문 ${input.open_question_count.toLocaleString("ko-KR")}개가 있습니다.`;
  }

  const ageLabel =
    input.notebook_age_days === null
      ? "한동안"
      : `${input.notebook_age_days.toLocaleString("ko-KR")}일 전`;
  return `마지막 점검이 ${ageLabel}입니다.`;
}

function inboxDescription(input: BuildResearchInboxInput): string {
  if (input.reason === "empty_notebook") {
    return "현재 보는 이유와 확인할 포인트를 한 줄이라도 남겨두세요.";
  }

  if (input.reason === "open_questions") {
    return "";
  }

  return "노트북을 열어 최근 생각이 여전히 유효한지 점검하세요.";
}

function inboxAction(
  input: BuildResearchInboxInput,
  currentQuestion: string | null,
): {
  label: string;
  href: string;
  secondaryLabel: string | null;
  secondaryHref: string | null;
} {
  const encodedTicker = encodeURIComponent(input.ticker);

  if (input.reason === "open_questions" && currentQuestion) {
    const params = new URLSearchParams({
      ticker: input.ticker,
      query: currentQuestion,
    });
    return {
      label: "이 질문으로 리서치",
      href: `/chat/new?${params.toString()}`,
      secondaryLabel: null,
      secondaryHref: null,
    };
  }

  if (input.reason === "open_questions") {
    return {
      label: "질문 확인",
      href: `/watchlist/${encodedTicker}`,
      secondaryLabel: null,
      secondaryHref: null,
    };
  }

  return {
    label: "노트북 열기",
    href: `/watchlist/${encodedTicker}`,
    secondaryLabel: null,
    secondaryHref: null,
  };
}
