import "server-only";

import { createHash } from "node:crypto";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureCompanyCoverage, setCompanyCoverageStatus } from "@/lib/coverage/repository";
import {
  DESKTOP_NOTEBOOK_COMPANY_CONTRACT,
  DESKTOP_NOTEBOOK_CONTRACT,
  DESKTOP_NOTEBOOK_MUTATION_CONTRACT,
  toDesktopMark,
  toDesktopNote,
  toDesktopNotebookCompanyDetail,
  toDesktopNotebookOverview,
  toDesktopQuestion,
} from "@/lib/desktop/dto/notebook-dto";
import { DesktopContractError } from "@/lib/desktop/ontology-contracts";
import {
  getCompanyMark,
  getWatchlistCompanyDetail,
  listWatchlistOverview,
} from "@/lib/watchlist/workspace";
import type {
  UserCompanyQuestion,
  UserResearchNote,
} from "@/types/api-contracts";
import type {
  UserCompanyMarkRow,
  UserCompanyQuestionRow,
  UserResearchNoteRow,
} from "@/types/database";

const PRIVATE_CACHE_SECONDS = 300;
const QUESTION_SELECT =
  "id, user_id, ticker, question, status, source, source_chat_session_id, source_message_id, answered_at, visible_after_at, created_at, updated_at";
const NOTE_SELECT =
  "id, user_id, ticker, title, body, note_type, tags, source_chat_session_id, source_message_id, client_operation_id, source_origin, source_device_id, source_local_session_id, source_local_run_id, source_local_message_id, created_at, updated_at";
const NOTE_TYPES = new Set<UserResearchNoteRow["note_type"]>([
  "manual",
  "chat_summary",
  "thesis_check",
  "filing_check",
  "risk_memo",
  "earnings_setup",
  "earnings_review",
  "tearsheet",
]);
const QUESTION_STATUSES = new Set<UserCompanyQuestionRow["status"]>([
  "open",
  "answered",
  "dismissed",
]);

export async function getDesktopNotebookOverview(userId: string) {
  const data = toDesktopNotebookOverview(await listWatchlistOverview(userId));
  const payload = {
    ok: true as const,
    contract_version: DESKTOP_NOTEBOOK_CONTRACT,
    data,
    meta: resourceMeta(),
  };
  return {
    payload,
    etag: createResourceEtag(DESKTOP_NOTEBOOK_CONTRACT, payload.data),
  };
}

export async function getDesktopNotebookCompany(
  userId: string,
  rawTicker: string,
) {
  const ticker = requireTicker(rawTicker);
  const detail = await getWatchlistCompanyDetail(userId, ticker);
  if (!detail) return null;
  const data = toDesktopNotebookCompanyDetail(detail);
  const payload = {
    ok: true as const,
    contract_version: DESKTOP_NOTEBOOK_COMPANY_CONTRACT,
    data,
    meta: resourceMeta(),
  };
  return {
    payload,
    etag: createResourceEtag(
      `${DESKTOP_NOTEBOOK_COMPANY_CONTRACT}:${ticker}`,
      payload.data,
    ),
  };
}

export async function updateDesktopNotebookMark(input: {
  userId: string;
  userEmail?: string | null;
  ticker: string;
  expectedVersion: string | null;
  body: unknown;
}) {
  const ticker = await requireIndexedTicker(input.ticker);
  const body = requireObject(input.body);
  const existing = await getCompanyMark(input.userId, ticker);
  requireMatchingVersion(
    input.expectedVersion,
    existing?.updated_at ?? "new",
  );

  const update = parseMarkUpdate(body);
  if (Object.keys(update).length === 0) {
    throw validationError("변경할 종목 상태를 입력해주세요.");
  }

  const mark = await setCompanyCoverageStatus({
    userId: input.userId,
    userEmail: input.userEmail,
    ticker,
    coverageStatus: update.coverage_status ?? existing?.coverage_status ?? "exploring",
    source: "desktop",
    priority: update.priority ?? existing?.priority ?? null,
    interestReason: update.interest_reason === undefined
      ? existing?.interest_reason ?? null
      : update.interest_reason,
    tags: update.tags ?? existing?.tags ?? null,
  });
  const data = toDesktopMark(mark);
  return mutationPayload("mark", data);
}

export async function createDesktopNotebookNote(input: {
  userId: string;
  userEmail?: string | null;
  deviceId: string | null;
  ticker: string;
  idempotencyKey: string | null;
  body: unknown;
}) {
  const ticker = await requireIndexedTicker(input.ticker);
  const operationId = requireIdempotencyKey(input.idempotencyKey);
  const body = requireObject(input.body);
  const note = parseNoteInput(body);
  const normalizedRequest = {
    ticker,
    title: note.title,
    body: note.body,
    note_type: note.note_type,
    tags: note.tags,
    source_chat_session_id: null,
    source_message_id: null,
    source_origin: "desktop" as const,
    source_device_id: boundedOptional(input.deviceId, 200),
    source_local_session_id: boundedOptional(
      body.local_session_id ?? body.localSessionId,
      200,
    ),
    source_local_run_id: boundedOptional(
      body.local_run_id ?? body.localRunId,
      200,
    ),
    source_local_message_id: boundedOptional(
      body.local_message_id ?? body.localMessageId,
      200,
    ),
  };
  const admin = getSupabaseAdmin();
  const existing = await findNoteByOperationId(input.userId, operationId);
  if (existing) {
    requireMatchingNoteRequest(existing, normalizedRequest);
    return mutationPayload("note", toDesktopNote(noteFromRow(existing)), {
      replayed: true,
    });
  }

  await touchCompanyMark(input.userId, input.userEmail, ticker);

  const { data, error } = await admin
    .from("user_research_notes")
    .insert({
      user_id: input.userId,
      ...normalizedRequest,
      client_operation_id: operationId,
    })
    .select(NOTE_SELECT)
    .single<UserResearchNoteRow>();

  if (error || !data) {
    if (error && isConflictError(error)) {
      const replay = await findNoteByOperationId(input.userId, operationId);
      if (replay) {
        requireMatchingNoteRequest(replay, normalizedRequest);
        return mutationPayload("note", toDesktopNote(noteFromRow(replay)), {
          replayed: true,
        });
      }
    }
    throw new Error(
      `Failed to create Desktop note: ${error?.message ?? "missing row"}`,
    );
  }

  return mutationPayload("note", toDesktopNote(noteFromRow(data)), {
    replayed: false,
  });
}

export async function updateDesktopNotebookQuestion(input: {
  userId: string;
  ticker: string;
  questionId: string;
  expectedVersion: string | null;
  body: unknown;
}) {
  const ticker = await requireIndexedTicker(input.ticker);
  const questionId = requireUuid(input.questionId);
  const admin = getSupabaseAdmin();
  const { data: current, error: currentError } = await admin
    .from("user_company_questions")
    .select(QUESTION_SELECT)
    .eq("id", questionId)
    .eq("user_id", input.userId)
    .eq("ticker", ticker)
    .maybeSingle<UserCompanyQuestionRow>();

  if (currentError) {
    throw new Error(
      `Failed to load Desktop question: ${currentError.message}`,
    );
  }
  if (!current) {
    throw new DesktopContractError("Question not found", {
      code: "not_found",
      publicMessage: "질문을 찾지 못했습니다.",
      status: 404,
    });
  }
  requireMatchingVersion(input.expectedVersion, current.updated_at);

  const body = requireObject(input.body);
  const update = parseQuestionUpdate(body);
  if (Object.keys(update).length === 0) {
    throw validationError("변경할 질문 내용을 입력해주세요.");
  }

  const { data, error } = await admin
    .from("user_company_questions")
    .update(update)
    .eq("id", questionId)
    .eq("user_id", input.userId)
    .eq("ticker", ticker)
    .eq("updated_at", current.updated_at)
    .select(QUESTION_SELECT)
    .maybeSingle<UserCompanyQuestionRow>();

  if (error) {
    throw new Error(`Failed to update Desktop question: ${error.message}`);
  }
  if (!data) throw resourceConflict();
  return mutationPayload("question", toDesktopQuestion(questionFromRow(data)));
}

function resourceMeta() {
  return {
    generated_at: new Date().toISOString(),
    max_age_seconds: PRIVATE_CACHE_SECONDS,
  };
}

function mutationPayload<
  Key extends "mark" | "note" | "question",
  Value,
  Meta extends Record<string, unknown> = Record<string, never>,
>(
  key: Key,
  value: Value,
  meta = {} as Meta,
) {
  return {
    ok: true as const,
    contract_version: DESKTOP_NOTEBOOK_MUTATION_CONTRACT,
    data: { [key]: value } as Record<Key, Value>,
    meta: {
      generated_at: new Date().toISOString(),
      ...meta,
    },
  };
}

function createResourceEtag(scope: string, value: unknown) {
  const digest = createHash("sha256")
    .update(`${scope}:${JSON.stringify(value)}`)
    .digest("base64url")
    .slice(0, 24);
  return `"notebook-${digest}"`;
}

function requireMatchingVersion(
  rawExpected: string | null,
  currentVersion: string,
) {
  const expected = normalizeVersion(rawExpected);
  if (!expected) {
    throw new DesktopContractError("If-Match is required", {
      code: "validation_error",
      publicMessage: "최신 상태를 확인한 뒤 다시 저장해주세요.",
      status: 428,
    });
  }
  if (expected !== currentVersion) throw resourceConflict();
}

function normalizeVersion(value: string | null) {
  if (!value) return null;
  return value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

function requireIdempotencyKey(value: string | null) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new DesktopContractError("Idempotency-Key is required", {
      code: "validation_error",
      publicMessage: "노트 저장 요청 식별자가 올바르지 않습니다.",
      status: 428,
    });
  }
  return normalized;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw validationError("요청 본문 형식이 올바르지 않습니다.");
  }
  return value as Record<string, unknown>;
}

function parseMarkUpdate(body: Record<string, unknown>) {
  const update: Partial<
    Pick<
      UserCompanyMarkRow,
      "coverage_status" | "priority" | "interest_reason" | "tags"
    >
  > = {};
  if (body.coverage_status !== undefined) {
    if (!(["exploring", "watching", "holding", "closed"] as const).includes(
      body.coverage_status as UserCompanyMarkRow["coverage_status"],
    )) {
      throw validationError("커버리지 상태가 올바르지 않습니다.");
    }
    update.coverage_status = body.coverage_status as UserCompanyMarkRow["coverage_status"];
  }
  if (body.priority !== undefined) {
    if (
      !Number.isSafeInteger(body.priority) ||
      Number(body.priority) < 0 ||
      Number(body.priority) > 10
    ) {
      throw validationError("우선순위가 올바르지 않습니다.");
    }
    update.priority = Number(body.priority);
  }
  if (body.interest_reason !== undefined) {
    update.interest_reason =
      boundedOptional(body.interest_reason, 1200) ?? null;
  }
  if (body.tags !== undefined) {
    update.tags = normalizeTags(body.tags);
  }
  return update;
}

function parseNoteInput(body: Record<string, unknown>) {
  const title = boundedRequired(body.title, 200, "노트 제목을 입력해주세요.");
  const noteType = String(body.note_type ?? body.noteType ?? "manual");
  if (!NOTE_TYPES.has(noteType as UserResearchNoteRow["note_type"])) {
    throw validationError("노트 유형이 올바르지 않습니다.");
  }
  return {
    title,
    body: boundedText(body.body, 20_000),
    note_type: noteType as UserResearchNoteRow["note_type"],
    tags: normalizeTags(body.tags ?? []),
  };
}

function parseQuestionUpdate(body: Record<string, unknown>) {
  const update: Partial<
    Pick<UserCompanyQuestionRow, "question" | "status" | "answered_at">
  > = {};
  if (body.question !== undefined) {
    update.question = boundedRequired(
      body.question,
      1200,
      "질문을 입력해주세요.",
    );
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!QUESTION_STATUSES.has(status as UserCompanyQuestionRow["status"])) {
      throw validationError("질문 상태가 올바르지 않습니다.");
    }
    update.status = status as UserCompanyQuestionRow["status"];
    update.answered_at =
      status === "answered" ? new Date().toISOString() : null;
  }
  return update;
}

async function requireIndexedTicker(value: string) {
  const ticker = requireTicker(value);
  if (!(await getIndexedCompany(ticker))) {
    throw new DesktopContractError("Company not found", {
      code: "not_found",
      publicMessage: "회사를 찾지 못했습니다.",
      status: 404,
    });
  }
  return ticker;
}

function requireTicker(value: string) {
  const ticker = normalizeTicker(value);
  if (!ticker) throw validationError("올바른 티커를 입력해주세요.");
  return ticker;
}

function requireUuid(value: string) {
  const normalized = String(value ?? "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new DesktopContractError("Question not found", {
      code: "not_found",
      publicMessage: "질문을 찾지 못했습니다.",
      status: 404,
    });
  }
  return normalized;
}

function boundedRequired(
  value: unknown,
  maxLength: number,
  publicMessage: string,
) {
  const normalized = boundedOptional(value, maxLength);
  if (!normalized) throw validationError(publicMessage);
  return normalized;
}

function boundedOptional(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw validationError("문자열 값이 올바르지 않습니다.");
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength) || null;
}

function boundedText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw validationError("노트 본문이 올바르지 않습니다.");
  return value.replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) throw validationError("태그 형식이 올바르지 않습니다.");
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 40))
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

interface NormalizedDesktopNoteRequest {
  ticker: string;
  title: string;
  body: string;
  note_type: UserResearchNoteRow["note_type"];
  tags: string[];
  source_chat_session_id: null;
  source_message_id: null;
  source_origin: "desktop";
  source_device_id: string | null;
  source_local_session_id: string | null;
  source_local_run_id: string | null;
  source_local_message_id: string | null;
}

function requireMatchingNoteRequest(
  existing: UserResearchNoteRow,
  request: NormalizedDesktopNoteRequest,
) {
  const matches =
    existing.ticker === request.ticker &&
    existing.title === request.title &&
    existing.body === request.body &&
    existing.note_type === request.note_type &&
    equalStringArrays(existing.tags ?? [], request.tags) &&
    existing.source_chat_session_id === request.source_chat_session_id &&
    existing.source_message_id === request.source_message_id &&
    existing.source_origin === request.source_origin &&
    (existing.source_device_id ?? null) === request.source_device_id &&
    (existing.source_local_session_id ?? null) ===
      request.source_local_session_id &&
    (existing.source_local_run_id ?? null) === request.source_local_run_id &&
    (existing.source_local_message_id ?? null) ===
      request.source_local_message_id;

  if (!matches) throw idempotencyConflict();
}

function equalStringArrays(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function findNoteByOperationId(
  userId: string,
  operationId: string,
) {
  const { data, error } = await getSupabaseAdmin()
    .from("user_research_notes")
    .select(NOTE_SELECT)
    .eq("user_id", userId)
    .eq("client_operation_id", operationId)
    .maybeSingle<UserResearchNoteRow>();
  if (error) {
    throw new Error(`Failed to load Desktop note operation: ${error.message}`);
  }
  return data;
}

async function touchCompanyMark(
  userId: string,
  userEmail: string | null | undefined,
  ticker: string,
) {
  const admin = getSupabaseAdmin();
  const existing = await getCompanyMark(userId, ticker);
  const now = new Date().toISOString();
  if (existing) {
    const { error } = await admin
      .from("user_company_marks")
      .update({ last_activity_at: now })
      .eq("user_id", userId)
      .eq("ticker", ticker);
    if (error) {
      throw new Error(`Failed to touch Desktop company coverage: ${error.message}`);
    }
    return;
  }
  await ensureCompanyCoverage({
    userId,
    userEmail,
    ticker,
    source: "desktop_notebook",
  });
}

function questionFromRow(row: UserCompanyQuestionRow): UserCompanyQuestion {
  return { ...row };
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

function validationError(publicMessage: string) {
  return new DesktopContractError(publicMessage, {
    code: "validation_error",
    publicMessage,
    status: 400,
  });
}

function resourceConflict() {
  return new DesktopContractError("Resource version conflict", {
    code: "resource_conflict",
    publicMessage: "다른 기기에서 내용이 변경되었습니다. 최신 내용을 불러온 뒤 다시 시도해주세요.",
    status: 409,
  });
}

function idempotencyConflict() {
  return new DesktopContractError("Idempotency key payload conflict", {
    code: "idempotency_conflict",
    publicMessage: "같은 저장 요청 번호가 다른 노트에 이미 사용되었습니다.",
    status: 409,
  });
}

function isConflictError(error: { code?: string | null }) {
  return error.code === "23505";
}
