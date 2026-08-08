import {
  parseMarketIssueResearchPaths,
  type MarketIssueResearchPath,
} from "@/lib/market-issues/contract";

export type MarketIssueScope = "mine" | "market";

export type MarketIssueCompany = {
  id: string | null;
  name: string;
  ticker: string | null;
  relationship: string | null;
  href: string | null;
};

export type MarketIssueSource = {
  id: string;
  sourceType: string | null;
  publisher: string | null;
  author: string | null;
  originalTitle: string | null;
  originalText: string | null;
  href: string | null;
  publishedAt: string | null;
};

export type MarketIssueUserState = {
  saved: boolean;
  hidden: boolean;
};

export type MarketIssueCard = {
  id: string;
  title: string;
  statusLabel: string;
  statusTone: string;
  summary: string;
  impactPath: string[];
  companies: MarketIssueCompany[];
  sourceCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
  userState: MarketIssueUserState | null;
  whyShown: string[];
  confirmed: string[];
  unconfirmed: string[];
  researchPaths: MarketIssueResearchPath[];
  sources: MarketIssueSource[];
};

export type MarketIssueListResponse = {
  issues: MarketIssueCard[];
  revision: string | null;
  nextCursor: string | null;
};

export type MarketIssueDetailResponse = {
  issue: MarketIssueCard;
};

export type MarketIssuesStatus = {
  label: string | null;
  updatedAt: string | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function firstDefined(record: UnknownRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readTextList(value: unknown): string[] {
  if (typeof value === "string") {
    const text = readString(value);
    return text ? [text] : [];
  }
  if (!Array.isArray(value)) {
    const record = asRecord(value);
    if (!record) return [];
    return readTextList(firstDefined(record, ["items", "steps", "points", "text", "summary", "label"]));
  }

  return value.flatMap((item) => {
    const text = readString(item);
    if (text) return [text];
    const record = asRecord(item);
    if (!record) return [];
    const nested = readString(firstDefined(record, ["text", "label", "summary", "title", "content"]));
    return nested ? [nested] : [];
  });
}

function readCompany(value: unknown, index: number): MarketIssueCompany | null {
  const record = asRecord(value);
  if (!record) {
    const ticker = readString(value);
    return ticker
      ? { id: null, name: ticker, ticker, relationship: null, href: null }
      : null;
  }

  const ticker = readString(firstDefined(record, ["ticker", "symbol"]));
  const name = readString(firstDefined(record, ["name", "company_name", "companyName", "label"])) ?? ticker;
  if (!name) return null;

  return {
    id: readString(firstDefined(record, ["id", "company_id", "companyId"])) ?? `company-${index}`,
    name,
    ticker,
    relationship: readString(firstDefined(record, ["relationship", "relationship_label", "relationshipLabel", "reason"])),
    href: readString(firstDefined(record, ["href", "url", "company_href", "companyHref"])),
  };
}

function readCompanies(value: unknown): MarketIssueCompany[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((company, index) => readCompany(company, index))
    .filter((company): company is MarketIssueCompany => company !== null);
}

function readSource(value: unknown, index: number): MarketIssueSource | null {
  const record = asRecord(value);
  if (!record) return null;

  const originalTitle = readString(firstDefined(record, ["original_title", "originalTitle", "title", "headline"]));
  const originalText = readString(firstDefined(record, ["original_text", "originalText", "text", "content", "body"]));
  const publisher = readString(firstDefined(record, ["publisher", "source_name", "sourceName", "account_name", "accountName"]));
  const href = readString(firstDefined(record, ["href", "url", "source_url", "sourceUrl", "permalink"]));

  if (!originalTitle && !originalText && !publisher && !href) return null;

  return {
    id: readString(firstDefined(record, ["id", "source_id", "sourceId"])) ?? `source-${index}`,
    sourceType: readString(firstDefined(record, ["source_type", "sourceType", "type", "platform"])),
    publisher,
    author: readString(firstDefined(record, ["author", "author_name", "authorName", "handle"])),
    originalTitle,
    originalText,
    href,
    publishedAt: readString(firstDefined(record, ["published_at", "publishedAt", "created_at", "createdAt"])),
  };
}

function readSources(value: unknown): MarketIssueSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((source, index) => readSource(source, index))
    .filter((source): source is MarketIssueSource => source !== null);
}

function readUserState(value: unknown): MarketIssueUserState | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    saved: firstDefined(record, ["saved", "is_saved", "isSaved"]) === true,
    hidden: firstDefined(record, ["hidden", "is_hidden", "isHidden"]) === true,
  };
}

function uniqueText(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export function normalizeMarketIssue(value: unknown, fallbackId = "issue"): MarketIssueCard | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readString(firstDefined(record, ["id", "issue_id", "issueId"])) ?? fallbackId;
  const sources = readSources(firstDefined(record, ["sources", "source_items", "sourceItems", "items"]));
  const sourceCount = readNumber(firstDefined(record, ["source_count", "sourceCount"])) ?? sources.length;
  const title = readString(firstDefined(record, ["title", "headline", "name"])) ?? "시장 이슈 정리 중";

  return {
    id,
    title,
    statusLabel: readString(firstDefined(record, ["status_label", "statusLabel", "status"])) ?? "추가 확인 필요",
    statusTone: readString(firstDefined(record, ["status_tone", "statusTone", "tone"])) ?? "neutral",
    summary: readString(firstDefined(record, ["summary", "korean_summary", "koreanSummary", "ai_summary", "aiSummary", "description"])) ?? "아직 한국어 맥락이 정리되지 않았습니다.",
    impactPath: uniqueText(readTextList(firstDefined(record, ["impact_path", "impactPath", "research_path", "researchPath"]))),
    companies: readCompanies(firstDefined(record, ["companies", "related_companies", "relatedCompanies", "entities"])),
    sourceCount: Math.max(0, Math.trunc(sourceCount)),
    publishedAt: readString(firstDefined(record, ["published_at", "publishedAt", "created_at", "createdAt"])),
    updatedAt: readString(firstDefined(record, ["updated_at", "updatedAt", "last_updated_at", "lastUpdatedAt"])),
    userState: readUserState(firstDefined(record, ["user_state", "userState"])),
    whyShown: uniqueText(readTextList(firstDefined(record, ["why_shown", "whyShown", "match_reasons", "matchReasons"]))),
    confirmed: uniqueText(readTextList(firstDefined(record, ["confirmed", "confirmed_facts", "confirmedFacts", "facts_confirmed", "factsConfirmed"]))),
    unconfirmed: uniqueText(readTextList(firstDefined(record, ["unconfirmed", "unconfirmed_items", "unconfirmedItems", "needs_verification", "needsVerification"]))),
    researchPaths: parseMarketIssueResearchPaths(firstDefined(record, ["research_paths", "researchPaths"])),
    sources,
  };
}

export function normalizeMarketIssueList(value: unknown): MarketIssueListResponse {
  const record = asRecord(value);
  const rawIssues = record && Array.isArray(record.issues) ? record.issues : [];

  return {
    issues: rawIssues
      .map((issue, index) => normalizeMarketIssue(issue, `issue-${index}`))
      .filter((issue): issue is MarketIssueCard => issue !== null),
    revision: record ? readString(firstDefined(record, ["revision", "version"])) : null,
    nextCursor: record ? readString(firstDefined(record, ["next_cursor", "nextCursor"])) : null,
  };
}

export function normalizeMarketIssueDetail(value: unknown): MarketIssueDetailResponse | null {
  const record = asRecord(value);
  if (!record) return null;
  const rawIssue = asRecord(record.issue) ?? record;
  const issue = normalizeMarketIssue(rawIssue);
  if (!issue) return null;

  const detailSources = readSources(firstDefined(record, ["sources", "source_items", "sourceItems"]));
  const detailConfirmed = readTextList(firstDefined(record, ["confirmed", "confirmed_facts", "confirmedFacts"]));
  const detailUnconfirmed = readTextList(firstDefined(record, ["unconfirmed", "unconfirmed_items", "unconfirmedItems", "needs_verification", "needsVerification"]));
  const detailResearchPaths = parseMarketIssueResearchPaths(firstDefined(record, ["research_paths", "researchPaths"]));
  const detailWhyShown = readTextList(firstDefined(record, ["why_shown", "whyShown", "match_reasons", "matchReasons"]));

  return {
    issue: {
      ...issue,
      confirmed: uniqueText([...issue.confirmed, ...detailConfirmed]),
      unconfirmed: uniqueText([...issue.unconfirmed, ...detailUnconfirmed]),
      researchPaths: detailResearchPaths.length > 0 ? detailResearchPaths : issue.researchPaths,
      whyShown: uniqueText([...issue.whyShown, ...detailWhyShown]),
      sources: detailSources.length > 0 ? detailSources : issue.sources,
    },
  };
}

export function normalizeMarketIssuesStatus(value: unknown): MarketIssuesStatus {
  const record = asRecord(value);
  if (!record) return { label: null, updatedAt: null };

  return {
    label: readString(firstDefined(record, ["label", "status_label", "statusLabel", "status", "message"])),
    updatedAt: readString(firstDefined(record, ["updated_at", "updatedAt", "last_updated_at", "lastUpdatedAt", "generated_at", "generatedAt"])),
  };
}

export function formatIssueDate(value: string | null, fallback = "시간 정보 없음"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatIssueRelativeTime(value: string | null): string {
  if (!value) return "시간 정보 없음";
  const date = new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return "시간 정보 없음";

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "방금 업데이트";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return formatIssueDate(value);
}

export function marketIssueStatusClass(tone: string): string {
  switch (tone.toLowerCase()) {
    case "confirmed":
    case "verified":
      return "border-[#b9dccf] bg-[#eff9f3] text-[#287450]";
    case "new":
    case "info":
      return "border-[#c8d8f7] bg-[#f0f5ff] text-[#3568ba]";
    case "updated":
      return "border-[#d8cef4] bg-[#f7f3ff] text-[#6d56aa]";
    case "caution":
    case "warning":
      return "border-[#efdbac] bg-[#fff9e9] text-[#8a6318]";
    default:
      return "border-[#d9dfe8] bg-[#f8fafc] text-[#5e6c80]";
  }
}
