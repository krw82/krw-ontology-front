import type {
  ResearchInboxItem,
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

export const DESKTOP_NOTEBOOK_CONTRACT = "desktop-notebook/v1" as const;
export const DESKTOP_NOTEBOOK_COMPANY_CONTRACT =
  "desktop-notebook-company/v1" as const;
export const DESKTOP_NOTEBOOK_MUTATION_CONTRACT =
  "desktop-notebook-mutation/v1" as const;

export type DesktopNotebookAction =
  | {
      type: "open_company";
      ticker: string;
    }
  | {
      type: "run_question";
      ticker: string;
      question_id: string | null;
      question: string | null;
    };

export function toDesktopNotebookOverview(
  overview: WatchlistOverviewResponse,
) {
  return {
    stats: {
      total_companies: overview.stats.total,
      watchlisted: overview.stats.watchlisted,
      holdings: overview.stats.holding,
      open_questions: overview.stats.open_questions,
      notes: overview.stats.notes,
      recent_activity: overview.stats.recent_activity,
    },
    companies: overview.companies.map(toDesktopNotebookCompanySummary),
    inbox: overview.research_inbox.map(toDesktopInboxItem),
  };
}

export function toDesktopNotebookCompanyDetail(
  detail: WatchlistCompanyDetailResponse,
) {
  return {
    company: toDesktopNotebookCompanySummary(detail.company),
    notebook: toDesktopNotebook(detail.notebook),
    questions: detail.questions.map(toDesktopQuestion),
    notes: detail.notes.map(toDesktopNote),
    card: detail.card ? toDesktopCard(detail.card) : null,
    theses: detail.theses.map(toDesktopThesis),
    thesis_checks: detail.thesis_checks.map(toDesktopThesisCheck),
  };
}

export function toDesktopMark(mark: UserCompanyMark) {
  return {
    is_watchlisted: mark.is_watchlisted,
    is_holding: mark.is_holding,
    priority: mark.priority,
    interest_reason: mark.interest_reason,
    tags: mark.tags,
    last_activity_at: mark.last_activity_at,
    created_at: mark.created_at,
    updated_at: mark.updated_at,
    version: isSyntheticMark(mark) ? "new" : mark.updated_at,
  };
}

export function toDesktopQuestion(question: UserCompanyQuestion) {
  return {
    id: question.id,
    ticker: question.ticker,
    question: question.question,
    status: question.status,
    source: question.source,
    answered_at: question.answered_at,
    visible_after_at: question.visible_after_at,
    created_at: question.created_at,
    updated_at: question.updated_at,
    version: question.updated_at,
  };
}

export function toDesktopNote(note: UserResearchNote) {
  return {
    id: note.id,
    ticker: note.ticker,
    title: note.title,
    body: note.body,
    note_type: note.note_type,
    tags: note.tags,
    created_at: note.created_at,
    updated_at: note.updated_at,
  };
}

function toDesktopNotebookCompanySummary(company: WatchlistCompanySummary) {
  return {
    ticker: company.ticker,
    name: company.name,
    display_name: company.companyNameKo ?? company.name,
    localized_name: company.companyNameKo ?? null,
    sector: company.sector,
    description: company.description,
    latest_period: company.latest_period,
    coverage_label: company.coverage,
    document_count: company.document_count,
    document_types: company.document_types,
    notebook_preview: company.notebook_preview,
    open_question_count: company.open_question_count,
    note_count: company.note_count,
    recent_research_count: company.recent_chat_count,
    latest_activity_at: company.latest_activity_at,
    research_status: company.research_status,
    research_status_label: company.research_status_label,
    research_status_reason: company.research_status_reason,
    notebook_updated_at: company.notebook_updated_at,
    notebook_age_days: company.notebook_age_days,
    mark: toDesktopMark(company.mark),
  };
}

function toDesktopInboxItem(item: ResearchInboxItem) {
  return {
    id: [
      item.ticker,
      item.reason,
      item.current_question_id ?? "company",
    ].join(":"),
    ticker: item.ticker,
    company_name: item.company_name,
    status: item.status,
    status_label: item.status_label,
    reason: item.reason,
    title: item.title,
    description: item.description,
    priority: item.priority,
    age_days: item.age_days,
    open_question_count: item.open_question_count,
    action: inboxAction(item),
  };
}

function inboxAction(item: ResearchInboxItem): DesktopNotebookAction {
  if (item.reason === "open_questions") {
    return {
      type: "run_question",
      ticker: item.ticker,
      question_id: item.current_question_id,
      question: item.current_question,
    };
  }
  return {
    type: "open_company",
    ticker: item.ticker,
  };
}

function toDesktopNotebook(notebook: UserCompanyNotebook) {
  return {
    ticker: notebook.ticker,
    title: notebook.title,
    content_md: notebook.content_md,
    basis_release_id: notebook.basis_release_id,
    basis_period: notebook.basis_period,
    created_at: notebook.created_at,
    updated_at: notebook.updated_at,
    version: notebook.updated_at ?? "new",
  };
}

function toDesktopCard(card: UserCompanyCard) {
  return {
    id: card.id,
    ticker: card.ticker,
    title: card.title,
    summary: card.summary,
    content_md: card.content_md,
    basis_release_id: card.basis_release_id,
    basis_period: card.basis_period,
    basis_document_type: card.basis_document_type,
    created_at: card.created_at,
    updated_at: card.updated_at,
  };
}

function toDesktopThesis(thesis: UserCompanyThesis) {
  return {
    id: thesis.id,
    ticker: thesis.ticker,
    title: thesis.title,
    thesis_text: thesis.thesis_text,
    status: thesis.status,
    tags: thesis.tags,
    archived_at: thesis.archived_at,
    created_at: thesis.created_at,
    updated_at: thesis.updated_at,
    version: thesis.updated_at,
  };
}

function toDesktopThesisCheck(check: UserThesisCheck) {
  return {
    id: check.id,
    thesis_id: check.thesis_id,
    ticker: check.ticker,
    result_status: check.result_status,
    summary: check.summary,
    strengthening_points: check.strengthening_points,
    weakening_points: check.weakening_points,
    neutral_points: check.neutral_points,
    next_questions: check.next_questions,
    basis_release_id: check.basis_release_id,
    basis_period: check.basis_period,
    created_at: check.created_at,
  };
}

function isSyntheticMark(mark: UserCompanyMark) {
  return mark.created_at === new Date(0).toISOString();
}
