import "server-only";

import { getIndexedCompanies, getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker, normalizeTickers } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  buildResearchInbox,
  buildResearchState,
  isNotebookEmpty,
  type ResearchNotebookStateInput,
} from "@/lib/watchlist/research-state";
import type {
  SessionSummary,
  UserCompanyCard,
  UserCompanyMark,
  UserCompanyNotebook,
  UserCompanyQuestion,
  UserCompanyThesis,
  UserResearchNote,
  UserThesisCheck,
  WatchlistCompanyDetailResponse,
  WatchlistCompanySummary,
  WatchlistOverviewResponse,
} from "@/types/api-contracts";
import type {
  ChatSessionRow,
  UserCompanyCardRow,
  UserCompanyMarkRow,
  UserCompanyNotebookRow,
  UserCompanyQuestionRow,
  UserCompanyThesisRow,
  UserResearchNoteRow,
  UserThesisCheckRow,
} from "@/types/database";

interface VisibleQuestionState {
  count: number;
  currentQuestionId: string | null;
  currentQuestion: string | null;
}

const MARK_SELECT =
  "user_id, ticker, is_watchlisted, is_holding, priority, interest_reason, tags, last_activity_at, created_at, updated_at";
const QUESTION_SELECT =
  "id, user_id, ticker, question, status, source, source_chat_session_id, source_message_id, answered_at, visible_after_at, created_at, updated_at";
const NOTE_SELECT =
  "id, user_id, ticker, title, body, note_type, tags, source_chat_session_id, source_message_id, created_at, updated_at";
const CARD_SELECT =
  "id, user_id, ticker, title, summary, content_md, basis_release_id, basis_period, basis_document_type, source_chat_session_id, source_message_id, created_at, updated_at";
const NOTEBOOK_SELECT =
  "id, user_id, ticker, title, content_md, previous_content_md, basis_release_id, basis_period, last_source_chat_session_id, last_source_message_id, created_at, updated_at";
const NOTEBOOK_OVERVIEW_SELECT =
  "ticker, content_md, updated_at";
const THESIS_SELECT =
  "id, user_id, ticker, title, thesis_text, status, tags, archived_at, source_chat_session_id, source_message_id, created_at, updated_at";
const THESIS_CHECK_SELECT =
  "id, thesis_id, user_id, ticker, result_status, summary, strengthening_points, weakening_points, neutral_points, next_questions, basis_release_id, basis_period, source_chat_session_id, source_message_id, created_at";
const SESSION_SUMMARY_SELECT =
  "id, title, scope_type, default_tickers, last_message_preview, last_message_at, latest_run_status, created_at, updated_at";

export function emptyUserCompanyMark(
  userId: string,
  ticker: string,
): UserCompanyMark {
  const now = new Date(0).toISOString();
  return {
    user_id: userId,
    ticker,
    is_watchlisted: false,
    is_holding: false,
    priority: 0,
    interest_reason: null,
    tags: [],
    last_activity_at: null,
    created_at: now,
    updated_at: now,
  };
}

export async function listWatchlistOverview(
  userId: string,
): Promise<WatchlistOverviewResponse> {
  const admin = getSupabaseAdmin();
  const { data: marks, error } = await admin
    .from("user_company_marks")
    .select(MARK_SELECT)
    .eq("user_id", userId)
    .or("is_watchlisted.eq.true,is_holding.eq.true,interest_reason.not.is.null")
    .order("updated_at", { ascending: false })
    .returns<UserCompanyMarkRow[]>();

  if (error) {
    throw new Error(`Failed to load watchlist marks: ${error.message}`);
  }

  const normalizedMarks = (marks ?? [])
    .map(markFromRow)
    .filter((mark) => Boolean(normalizeTicker(mark.ticker)));
  const tickers = normalizeTickers(normalizedMarks.map((mark) => mark.ticker));
  const companies = await getIndexedCompanies(tickers);
  const companyByTicker = new Map(companies.map((company) => [company.ticker, company]));
  const [questionStatesByTicker, notesByTicker, notebooksByTicker, sessionsByTicker] =
    await Promise.all([
      listVisibleOpenQuestionStatesByTicker(userId, tickers),
      countNotesByTicker(userId, tickers),
      listNotebookStatesByTicker(userId, tickers),
      countRecentSessionsByTicker(userId, tickers),
    ]);

  const summaries = normalizedMarks.map((mark) =>
    buildCompanySummary({
      userId,
      mark,
      company: companyByTicker.get(mark.ticker) ?? null,
      openQuestionCount: questionStatesByTicker.get(mark.ticker)?.count ?? 0,
      noteCount: notesByTicker.get(mark.ticker) ?? 0,
      recentChatCount: sessionsByTicker.get(mark.ticker) ?? 0,
      notebook: notebooksByTicker.get(mark.ticker) ?? null,
    }),
  );
  const researchInbox = buildResearchInbox(
    summaries.map((company) => ({
      ticker: company.ticker,
      company_name: company.companyNameKo ?? company.name,
      status: company.research_status,
      status_label: company.research_status_label,
      reason: company.research_status_reason,
      notebook_updated_at: company.notebook_updated_at,
      notebook_age_days: company.notebook_age_days,
      open_question_count: company.open_question_count,
      current_question_id:
        questionStatesByTicker.get(company.ticker)?.currentQuestionId ?? null,
      current_question:
        questionStatesByTicker.get(company.ticker)?.currentQuestion ?? null,
    })),
  );

  return {
    companies: summaries,
    research_inbox: researchInbox,
    stats: {
      total: summaries.length,
      watchlisted: summaries.filter((company) => company.mark.is_watchlisted).length,
      holding: summaries.filter((company) => company.mark.is_holding).length,
      open_questions: sumQuestionStates(questionStatesByTicker),
      notes: sumMap(notesByTicker),
      recent_activity: summaries.filter((company) => company.latest_activity_at).length,
    },
  };
}

export async function getWatchlistCompanyDetail(
  userId: string,
  rawTicker: string,
): Promise<WatchlistCompanyDetailResponse | null> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const admin = getSupabaseAdmin();
  const [
    company,
    mark,
    notebook,
    questions,
    card,
    theses,
    notes,
    recentSessions,
  ] = await Promise.all([
    getIndexedCompany(ticker),
    getCompanyMark(userId, ticker),
    getCompanyNotebook(userId, ticker),
    listCompanyQuestions(userId, ticker),
    getCompanyCard(userId, ticker),
    listCompanyTheses(userId, ticker),
    listCompanyNotes(userId, ticker),
    listRecentTickerSessions(userId, ticker),
  ]);

  if (!company) return null;

  const thesisIds = theses.map((thesis) => thesis.id);
  const thesisChecks = thesisIds.length
    ? await listThesisChecks(userId, ticker, thesisIds)
    : [];

  const latestActivity = latestTimestamp([
    mark?.updated_at,
    notebook?.updated_at,
    ...questions.map((question) => question.updated_at),
    card?.updated_at,
    ...theses.map((thesis) => thesis.updated_at),
    ...notes.map((note) => note.updated_at),
    ...recentSessions.map((session) => session.updated_at),
  ]);

  const summary = buildCompanySummary({
    userId,
    mark: mark ?? emptyUserCompanyMark(userId, ticker),
    company,
    openQuestionCount: questions.filter((question) => question.status === "open").length,
    noteCount: notes.length,
    recentChatCount: recentSessions.length,
    latestActivityAt: latestActivity,
    notebook,
  });

  // Keep a lightweight activity timestamp on marks that already exist.
  if (mark && latestActivity && mark.last_activity_at !== latestActivity) {
    await admin
      .from("user_company_marks")
      .update({ last_activity_at: latestActivity })
      .eq("user_id", userId)
      .eq("ticker", ticker);
  }

  return {
    company: summary,
    notebook: notebook ?? defaultCompanyNotebook(userId, ticker, company),
    questions,
    card,
    theses,
    thesis_checks: thesisChecks,
    notes,
    recent_sessions: recentSessions,
  };
}

export async function getCompanyMark(
  userId: string,
  rawTicker: string,
): Promise<UserCompanyMark | null> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_marks")
    .select(MARK_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .maybeSingle<UserCompanyMarkRow>();

  if (error) throw new Error(`Failed to load company mark: ${error.message}`);
  return data ? markFromRow(data) : null;
}

export async function listCompanyQuestions(
  userId: string,
  rawTicker: string,
): Promise<UserCompanyQuestion[]> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_questions")
    .select(QUESTION_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .lte("visible_after_at", new Date().toISOString())
    .order("updated_at", { ascending: false })
    .returns<UserCompanyQuestionRow[]>();

  if (error) throw new Error(`Failed to load company questions: ${error.message}`);
  return (data ?? []).map(questionFromRow);
}

export async function listCompanyNotes(
  userId: string,
  rawTicker: string,
): Promise<UserResearchNote[]> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("user_research_notes")
    .select(NOTE_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .order("updated_at", { ascending: false })
    .returns<UserResearchNoteRow[]>();

  if (error) throw new Error(`Failed to load research notes: ${error.message}`);
  return (data ?? []).map(noteFromRow);
}

async function getCompanyCard(
  userId: string,
  ticker: string,
): Promise<UserCompanyCard | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_company_cards")
    .select(CARD_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .maybeSingle<UserCompanyCardRow>();

  if (error) throw new Error(`Failed to load company card: ${error.message}`);
  return data ? cardFromRow(data) : null;
}

export async function getCompanyNotebook(
  userId: string,
  rawTicker: string,
): Promise<UserCompanyNotebook | null> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_notebooks")
    .select(NOTEBOOK_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .maybeSingle<UserCompanyNotebookRow>();

  if (error) throw new Error(`Failed to load company notebook: ${error.message}`);
  return data ? notebookFromRow(data) : null;
}

async function listCompanyTheses(
  userId: string,
  ticker: string,
): Promise<UserCompanyThesis[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_company_theses")
    .select(THESIS_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .returns<UserCompanyThesisRow[]>();

  if (error) throw new Error(`Failed to load company theses: ${error.message}`);
  return (data ?? []).map(thesisFromRow);
}

async function listThesisChecks(
  userId: string,
  ticker: string,
  thesisIds: string[],
): Promise<UserThesisCheck[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_thesis_checks")
    .select(THESIS_CHECK_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .in("thesis_id", thesisIds)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<UserThesisCheckRow[]>();

  if (error) throw new Error(`Failed to load thesis checks: ${error.message}`);
  return (data ?? []).map(thesisCheckFromRow);
}

async function listVisibleOpenQuestionStatesByTicker(
  userId: string,
  tickers: string[],
): Promise<Map<string, VisibleQuestionState>> {
  const states = new Map<string, VisibleQuestionState>();
  if (tickers.length === 0) return states;

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_questions")
    .select("ticker,id,question,visible_after_at,created_at,updated_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .lte("visible_after_at", new Date().toISOString())
    .in("ticker", tickers)
    .order("visible_after_at", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<
      Array<
        Pick<
          UserCompanyQuestionRow,
          | "ticker"
          | "id"
          | "question"
          | "visible_after_at"
          | "created_at"
          | "updated_at"
        >
      >
    >();

  if (error) throw new Error(`Failed to count open questions: ${error.message}`);
  for (const row of data ?? []) {
    const ticker = normalizeTicker(row.ticker);
    if (!ticker) continue;
    const current = states.get(ticker) ?? {
      count: 0,
      currentQuestionId: null,
      currentQuestion: null,
    };
    current.count += 1;
    if (!current.currentQuestionId) {
      current.currentQuestionId = row.id;
      current.currentQuestion = row.question;
    }
    states.set(ticker, current);
  }
  return states;
}

async function countNotesByTicker(userId: string, tickers: string[]) {
  const counts = new Map<string, number>();
  if (tickers.length === 0) return counts;

  const { data, error } = await getSupabaseAdmin()
    .from("user_research_notes")
    .select("ticker")
    .eq("user_id", userId)
    .in("ticker", tickers)
    .returns<Array<Pick<UserResearchNoteRow, "ticker">>>();

  if (error) throw new Error(`Failed to count notes: ${error.message}`);
  for (const row of data ?? []) {
    counts.set(row.ticker, (counts.get(row.ticker) ?? 0) + 1);
  }
  return counts;
}

async function listNotebookStatesByTicker(
  userId: string,
  tickers: string[],
): Promise<Map<string, ResearchNotebookStateInput>> {
  const notebooks = new Map<string, ResearchNotebookStateInput>();
  if (tickers.length === 0) return notebooks;

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_notebooks")
    .select(NOTEBOOK_OVERVIEW_SELECT)
    .eq("user_id", userId)
    .in("ticker", tickers)
    .returns<
      Array<
        Pick<UserCompanyNotebookRow, "ticker" | "content_md" | "updated_at">
      >
    >();

  if (error) {
    throw new Error(`Failed to load notebook states: ${error.message}`);
  }

  for (const row of data ?? []) {
    const ticker = normalizeTicker(row.ticker);
    if (!ticker) continue;
    notebooks.set(ticker, {
      content_md: row.content_md,
      updated_at: row.updated_at,
    });
  }

  return notebooks;
}

async function countRecentSessionsByTicker(userId: string, tickers: string[]) {
  const counts = new Map<string, number>();
  if (tickers.length === 0) return counts;

  const { data, error } = await getSupabaseAdmin()
    .from("chat_sessions")
    .select("default_tickers")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("last_message_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(200)
    .returns<Array<Pick<ChatSessionRow, "default_tickers">>>();

  if (error) throw new Error(`Failed to count recent sessions: ${error.message}`);
  const tickerSet = new Set(tickers);
  for (const row of data ?? []) {
    for (const ticker of normalizeTickers(row.default_tickers ?? [])) {
      if (tickerSet.has(ticker)) counts.set(ticker, (counts.get(ticker) ?? 0) + 1);
    }
  }
  return counts;
}

async function listRecentTickerSessions(
  userId: string,
  ticker: string,
): Promise<SessionSummary[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("chat_sessions")
    .select(SESSION_SUMMARY_SELECT)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .contains("default_tickers", [ticker])
    .order("updated_at", { ascending: false })
    .limit(10)
    .returns<ChatSessionRow[]>();

  if (error) throw new Error(`Failed to load recent sessions: ${error.message}`);
  return (data ?? []).map((session) => ({
    id: session.id,
    title: session.title,
    scope_type: session.scope_type,
    default_tickers: session.default_tickers ?? [],
    last_message_preview: session.last_message_preview,
    last_message_at: session.last_message_at,
    latest_run_status: session.latest_run_status,
    created_at: session.created_at,
    updated_at: session.updated_at,
  }));
}

function buildCompanySummary({
  userId,
  mark,
  company,
  openQuestionCount,
  noteCount,
  recentChatCount,
  latestActivityAt,
  notebook,
}: {
  userId: string;
  mark: UserCompanyMark;
  company: Awaited<ReturnType<typeof getIndexedCompany>>;
  openQuestionCount: number;
  noteCount: number;
  recentChatCount: number;
  latestActivityAt?: string | null;
  notebook?: ResearchNotebookStateInput | null;
}): WatchlistCompanySummary {
  const ticker = normalizeTicker(mark.ticker) ?? mark.ticker;
  const researchState = buildResearchState({
    ticker,
    notebook: notebook ?? null,
    openQuestionCount,
  });
  return {
    ticker,
    name: company?.name ?? ticker,
    sector: company?.sector ?? null,
    description: company?.description ?? "현재 인덱스의 상세 회사 설명을 찾지 못했습니다.",
    latest_period: company?.latest_period ?? null,
    coverage: company?.coverage ?? "공시 커버리지 확인 필요",
    document_count: company?.document_count ?? 0,
    document_types: company?.document_types ?? [],
    notebook_preview: buildNotebookPreview(ticker, notebook),
    mark: company ? mark : { ...mark, user_id: userId, ticker },
    open_question_count: openQuestionCount,
    note_count: noteCount,
    recent_chat_count: recentChatCount,
    latest_activity_at:
      latestActivityAt === undefined
        ? latestTimestamp([
            mark.last_activity_at,
            mark.updated_at,
          ])
        : latestActivityAt,
    research_status: researchState.status,
    research_status_label: researchState.status_label,
    research_status_reason: researchState.reason,
    notebook_updated_at: researchState.notebook_updated_at,
    notebook_age_days: researchState.notebook_age_days,
  };
}

function buildNotebookPreview(
  ticker: string,
  notebook: ResearchNotebookStateInput | null | undefined,
): string {
  const fallback = "아직 작성된 리서치 노트가 없습니다.";
  const contentMd = notebook?.content_md ?? null;
  if (isNotebookEmpty(ticker, contentMd)) return fallback;

  const lines = (contentMd ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => cleanNotebookPreviewLine(ticker, line))
    .filter(Boolean);
  const preview = lines.join(" ").replace(/\s+/g, " ").trim();

  if (!preview || preview === "아직 기록된 내용이 없습니다.") return fallback;
  if (preview.length <= 140) return preview;
  return `${preview.slice(0, 140).trimEnd()}...`;
}

function cleanNotebookPreviewLine(ticker: string, line: string): string {
  const withoutMarkdown = line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

  if (!withoutMarkdown) return "";
  if (
    withoutMarkdown.toUpperCase() ===
    `${ticker.trim().toUpperCase()} 리서치 노트북`.toUpperCase()
  ) {
    return "";
  }
  if (withoutMarkdown === "아직 기록된 내용이 없습니다.") return "";
  return withoutMarkdown;
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function sumMap(map: Map<string, number>): number {
  return Array.from(map.values()).reduce((sum, value) => sum + value, 0);
}

function sumQuestionStates(map: Map<string, VisibleQuestionState>): number {
  return Array.from(map.values()).reduce((sum, value) => sum + value.count, 0);
}

function markFromRow(row: UserCompanyMarkRow): UserCompanyMark {
  return {
    user_id: row.user_id,
    ticker: row.ticker,
    is_watchlisted: row.is_watchlisted,
    is_holding: row.is_holding,
    priority: row.priority,
    interest_reason: row.interest_reason,
    tags: row.tags ?? [],
    last_activity_at: row.last_activity_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function questionFromRow(row: UserCompanyQuestionRow): UserCompanyQuestion {
  return { ...row };
}

function cardFromRow(row: UserCompanyCardRow): UserCompanyCard {
  return {
    id: row.id,
    user_id: row.user_id,
    ticker: row.ticker,
    title: row.title,
    summary: row.summary,
    content_md: row.content_md,
    basis_release_id: row.basis_release_id,
    basis_period: row.basis_period,
    basis_document_type: row.basis_document_type,
    source_chat_session_id: row.source_chat_session_id,
    source_message_id: row.source_message_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function notebookFromRow(row: UserCompanyNotebookRow): UserCompanyNotebook {
  return {
    id: row.id,
    user_id: row.user_id,
    ticker: row.ticker,
    title: row.title,
    content_md: row.content_md,
    previous_content_md: row.previous_content_md,
    basis_release_id: row.basis_release_id,
    basis_period: row.basis_period,
    last_source_chat_session_id: row.last_source_chat_session_id,
    last_source_message_id: row.last_source_message_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function defaultCompanyNotebook(
  userId: string,
  ticker: string,
  company: Awaited<ReturnType<typeof getIndexedCompany>> | null,
): UserCompanyNotebook {
  const title = `${ticker} 리서치 노트북`;
  return {
    id: null,
    user_id: userId,
    ticker,
    title,
    content_md: defaultCompanyNotebookContent(),
    previous_content_md: null,
    basis_release_id: null,
    basis_period: company?.latest_period ?? null,
    last_source_chat_session_id: null,
    last_source_message_id: null,
    created_at: null,
    updated_at: null,
  };
}

function defaultCompanyNotebookContent(): string {
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

function thesisFromRow(row: UserCompanyThesisRow): UserCompanyThesis {
  return {
    id: row.id,
    user_id: row.user_id,
    ticker: row.ticker,
    title: row.title,
    thesis_text: row.thesis_text,
    status: row.status,
    tags: row.tags ?? [],
    archived_at: row.archived_at,
    source_chat_session_id: row.source_chat_session_id,
    source_message_id: row.source_message_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function thesisCheckFromRow(row: UserThesisCheckRow): UserThesisCheck {
  return {
    id: row.id,
    thesis_id: row.thesis_id,
    user_id: row.user_id,
    ticker: row.ticker,
    result_status: row.result_status,
    summary: row.summary,
    strengthening_points: row.strengthening_points ?? [],
    weakening_points: row.weakening_points ?? [],
    neutral_points: row.neutral_points ?? [],
    next_questions: row.next_questions ?? [],
    basis_release_id: row.basis_release_id,
    basis_period: row.basis_period,
    source_chat_session_id: row.source_chat_session_id,
    source_message_id: row.source_message_id,
    created_at: row.created_at,
  };
}

function noteFromRow(row: UserResearchNoteRow): UserResearchNote {
  return {
    id: row.id,
    user_id: row.user_id,
    ticker: row.ticker,
    title: row.title,
    body: row.body,
    note_type: row.note_type,
    tags: row.tags ?? [],
    source_chat_session_id: row.source_chat_session_id,
    source_message_id: row.source_message_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
