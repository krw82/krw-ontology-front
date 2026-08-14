import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AgentRunRow,
  ChatAttachmentRow,
  ChatSessionRow,
  Json,
  MessageRow,
  MessageShareRow,
} from "@/types/database";
import {
  sanitizeAssistantContent,
  sanitizeAssistantPreviewContent,
} from "@/lib/chat/assistant-content";
import { parseChatAttachmentContent } from "@/lib/chat/attachments";
import { normalizeTickers } from "@/lib/ontology/ticker";
import { redactSensitiveOutput } from "@/lib/security/sensitive-output";
import type { Locale } from "@/i18n/config";
import { normalizeGuruLensKey, type GuruLensKey } from "@/lib/guru-lenses";
import type { RunKind } from "@/lib/run-kind";
import { inferShareLocale } from "./share-locale";

const SHARE_TOKEN_BYTES = 18;
const MAX_SHARE_TITLE_LENGTH = 90;
const MAX_SHARE_QUESTION_CHARS = 8_000;
const SHARE_SNAPSHOT_VERSION = 2;

export interface PublicShareQuestionAttachments {
  urls: string[];
  files: PublicShareQuestionAttachmentFile[];
}

export interface PublicShareQuestionAttachmentFile {
  name: string;
  mimeType: string | null;
  size: number | null;
}

export interface PublicShareContext {
  run_kind: RunKind | null;
  guru_lens: GuruLensKey | null;
}

export interface PublicMessageShare {
  token: string;
  title: string;
  question_content: string | null;
  question_created_at: string | null;
  question_attachments: PublicShareQuestionAttachments;
  answer_content: string;
  answer_created_at: string;
  tickers: string[] | null;
  share_context: PublicShareContext;
  created_at: string;
  locale: Locale;
}

export interface PublicShareStarter {
  token: string;
  title: string;
  question_content: string;
  tickers: string[] | null;
}

interface ShareQuestionSnapshot {
  sourceQuestionMessageId: string | null;
  questionContent: string | null;
  questionCreatedAt: string | null;
}

export function createShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

export function buildShareTitle(content: string, fallbackTitle?: string): string {
  const firstMeaningfulLine = content
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/[*_`>]/g, "")
        .trim(),
    )
    .find(Boolean);

  const title = firstMeaningfulLine || fallbackTitle || "공유된 답변";
  return title.length > MAX_SHARE_TITLE_LENGTH
    ? `${title.slice(0, MAX_SHARE_TITLE_LENGTH - 1)}...`
    : title;
}

export async function findPublicMessageShare(
  token: string,
): Promise<PublicMessageShare | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("message_shares")
    .select(
      "token, title, question_content, question_created_at, source_question_message_id, answer_content, answer_created_at, tickers, share_context, created_at",
    )
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle<
      Omit<PublicMessageShare, "question_attachments"> &
        Pick<MessageShareRow, "source_question_message_id">
    >();

  if (!data) return null;

  const answerContent = redactSensitiveOutput(
    sanitizeAssistantContent(data.answer_content),
  ).content;
  const titleFallback = redactSensitiveOutput(
    sanitizeAssistantPreviewContent(data.title),
  ).content;
  const questionContent = redactNullableShareText(
    normalizeShareQuestion(data.question_content),
  );
  const questionAttachments = await loadPublicQuestionAttachments(
    admin,
    data.source_question_message_id,
  );
  return {
    token: data.token,
    title: buildShareTitle(answerContent, titleFallback || undefined),
    question_content: questionContent,
    question_created_at: data.question_created_at,
    question_attachments: questionAttachments,
    answer_content: answerContent,
    answer_created_at: data.answer_created_at,
    tickers: normalizeShareTickers(data.tickers),
    share_context: normalizeShareContext(data.share_context),
    created_at: data.created_at,
    locale: inferShareLocale({
      questionContent,
      answerContent,
    }),
  };
}

export async function findPublicShareStarter(
  token: string,
): Promise<PublicShareStarter | null> {
  const share = await findPublicMessageShare(token);
  const questionContent = normalizeShareQuestion(share?.question_content);
  if (!share || !questionContent) return null;

  return {
    token: share.token,
    title: share.title,
    question_content: questionContent,
    tickers: share.tickers,
  };
}

export async function findExistingActiveShare(
  messageId: string,
): Promise<
  Pick<MessageShareRow, "token" | "question_content" | "share_context"> | null
> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("message_shares")
    .select("token, question_content, share_context")
    .eq("source_message_id", messageId)
    .is("revoked_at", null)
    .maybeSingle<
      Pick<MessageShareRow, "token" | "question_content" | "share_context">
    >();

  return data ?? null;
}

export async function createMessageShare(params: {
  userId: string;
  message: MessageRow;
  session: ChatSessionRow;
}): Promise<Pick<MessageShareRow, "token">> {
  const admin = getSupabaseAdmin();
  const token = createShareToken();
  const answerContent = redactSensitiveOutput(
    sanitizeAssistantContent(params.message.content),
  ).content;
  const questionSnapshot = await resolveShareQuestionSnapshot(params);
  const shareContext = await resolveShareContext(admin, params.message);
  const payload = {
    token,
    owner_user_id: params.userId,
    source_session_id: params.session.id,
    source_message_id: params.message.id,
    source_question_message_id: questionSnapshot.sourceQuestionMessageId,
    title: buildShareTitle(answerContent, params.session.title),
    question_content: redactNullableShareText(questionSnapshot.questionContent),
    question_created_at: questionSnapshot.questionCreatedAt,
    answer_content: answerContent,
    answer_created_at: params.message.created_at,
    tickers: normalizeShareTickers(params.session.default_tickers),
    share_context: toShareContextJson(shareContext),
    snapshot_version: SHARE_SNAPSHOT_VERSION,
  };

  const { data, error } = await admin
    .from("message_shares")
    .insert(payload)
    .select("token")
    .single<Pick<MessageShareRow, "token">>();

  if (!error && data) return data;

  const existing = await findExistingActiveShare(params.message.id);
  if (existing) return existing;

  throw new Error(error?.message || "Failed to create message share");
}

function normalizeShareTickers(
  tickers: readonly string[] | null | undefined,
): string[] | null {
  const normalized = normalizeTickers(tickers ?? []);
  return normalized.length > 0 ? normalized : null;
}

function redactNullableShareText(content: string | null): string | null {
  if (!content) return content;
  return redactSensitiveOutput(content).content;
}

export async function ensureMessageShareQuestionSnapshot(params: {
  message: MessageRow;
  session: ChatSessionRow;
}): Promise<void> {
  const questionSnapshot = await resolveShareQuestionSnapshot(params);
  if (!questionSnapshot.questionContent) return;

  await getSupabaseAdmin()
    .from("message_shares")
    .update({
      source_question_message_id: questionSnapshot.sourceQuestionMessageId,
      question_content: questionSnapshot.questionContent,
      question_created_at: questionSnapshot.questionCreatedAt,
      snapshot_version: SHARE_SNAPSHOT_VERSION,
    } satisfies Partial<MessageShareRow>)
    .eq("source_message_id", params.message.id)
    .is("revoked_at", null)
    .is("question_content", null);
}

export async function ensureMessageShareContextSnapshot(params: {
  message: MessageRow;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const shareContext = await resolveShareContext(admin, params.message);
  if (!hasShareContext(shareContext)) return;

  await admin
    .from("message_shares")
    .update({
      share_context: toShareContextJson(shareContext),
    } satisfies Partial<MessageShareRow>)
    .eq("source_message_id", params.message.id)
    .is("revoked_at", null);
}

async function resolveShareQuestionSnapshot(params: {
  message: MessageRow;
  session: ChatSessionRow;
}): Promise<ShareQuestionSnapshot> {
  const admin = getSupabaseAdmin();
  const runLinkedQuestion = await findRunLinkedQuestion(admin, params.message);
  if (runLinkedQuestion) return runLinkedQuestion;

  const previousQuestion = await findPreviousQuestion(admin, params.message);
  if (previousQuestion) return previousQuestion;

  return {
    sourceQuestionMessageId: null,
    questionContent: null,
    questionCreatedAt: null,
  };
}

async function findRunLinkedQuestion(
  admin: ReturnType<typeof getSupabaseAdmin>,
  answerMessage: MessageRow,
): Promise<ShareQuestionSnapshot | null> {
  const { data: run } = await admin
    .from("agent_runs")
    .select("user_message_id")
    .eq("assistant_message_id", answerMessage.id)
    .eq("session_id", answerMessage.session_id)
    .order("queued_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<Pick<AgentRunRow, "user_message_id">>();

  if (!run?.user_message_id) return null;

  const { data: question } = await admin
    .from("messages")
    .select("id, session_id, role, content, status, created_at, updated_at")
    .eq("id", run.user_message_id)
    .eq("session_id", answerMessage.session_id)
    .eq("role", "user")
    .maybeSingle<MessageRow>();

  return toQuestionSnapshot(question);
}

async function findPreviousQuestion(
  admin: ReturnType<typeof getSupabaseAdmin>,
  answerMessage: MessageRow,
): Promise<ShareQuestionSnapshot | null> {
  const { data: question } = await admin
    .from("messages")
    .select("id, session_id, role, content, status, created_at, updated_at")
    .eq("session_id", answerMessage.session_id)
    .eq("role", "user")
    .lte("created_at", answerMessage.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<MessageRow>();

  return toQuestionSnapshot(question);
}

function toQuestionSnapshot(
  question: MessageRow | null | undefined,
): ShareQuestionSnapshot | null {
  if (!question || question.role !== "user") return null;

  const questionContent = normalizeShareQuestion(question.content);
  if (!questionContent) return null;

  return {
    sourceQuestionMessageId: question.id,
    questionContent,
    questionCreatedAt: question.created_at,
  };
}

function normalizeShareQuestion(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const visibleText = parseChatAttachmentContent(value).visibleText;
  const normalized = visibleText.replace(/\s+\n/g, "\n").trim();
  return normalized ? normalized.slice(0, MAX_SHARE_QUESTION_CHARS) : null;
}

export async function resolveShareContext(
  admin: ReturnType<typeof getSupabaseAdmin>,
  answerMessage: MessageRow,
): Promise<PublicShareContext> {
  const { data: run } = await admin
    .from("agent_runs")
    .select("id, run_kind")
    .eq("assistant_message_id", answerMessage.id)
    .eq("session_id", answerMessage.session_id)
    .order("queued_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<Pick<AgentRunRow, "id" | "run_kind">>();

  const runKind = readShareRunKind(run?.run_kind);
  if (!runKind) return emptyShareContext();

  if (runKind !== "guru_advisor" || !run?.id) {
    return { run_kind: runKind, guru_lens: null };
  }

  const { data: queuedEvent } = await admin
    .from("agent_run_events")
    .select("payload")
    .eq("run_id", run.id)
    .eq("event_type", "run_queued")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<{ payload: unknown }>();

  const guruLens = isRecord(queuedEvent?.payload)
    ? normalizeGuruLensKey(queuedEvent.payload.guru_lens)
    : null;

  return { run_kind: runKind, guru_lens: guruLens };
}

function normalizeShareContext(value: unknown): PublicShareContext {
  if (!isRecord(value)) return emptyShareContext();
  return {
    run_kind: readShareRunKind(value.run_kind),
    guru_lens: normalizeGuruLensKey(value.guru_lens),
  };
}

function readShareRunKind(value: unknown): RunKind | null {
  return value === "idea_generation" ||
    value === "news_discovery" ||
    value === "news_discovery_wide" ||
    value === "market_move_research" ||
    value === "scenario_sensitivity" ||
    value === "guru_advisor" ||
    value === "company_research"
    ? value
    : null;
}

function emptyShareContext(): PublicShareContext {
  return { run_kind: null, guru_lens: null };
}

function hasShareContext(value: PublicShareContext): boolean {
  return Boolean(value.run_kind || value.guru_lens);
}

function toShareContextJson(value: PublicShareContext): Json {
  return {
    run_kind: value.run_kind,
    guru_lens: value.guru_lens,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function loadPublicQuestionAttachments(
  admin: ReturnType<typeof getSupabaseAdmin>,
  questionMessageId: string | null | undefined,
): Promise<PublicShareQuestionAttachments> {
  if (!questionMessageId) return emptyQuestionAttachments();

  const { data: message } = await admin
    .from("messages")
    .select("content, metadata")
    .eq("id", questionMessageId)
    .maybeSingle<Pick<MessageRow, "content" | "metadata">>();

  if (!message) return emptyQuestionAttachments();

  const urls = userUrlsFromMetadata(message.metadata);
  const inlineFiles = parseChatAttachmentContent(message.content).attachments.map(
    (attachment) => ({
      name: attachment.name,
      mimeType: null,
      size: attachment.byteLength,
    }),
  );

  const { data: documentFiles } = await admin
    .from("chat_attachments")
    .select("file_name, mime_type, file_size")
    .eq("message_id", questionMessageId)
    .order("created_at", { ascending: true })
    .returns<
      Array<Pick<ChatAttachmentRow, "file_name" | "mime_type" | "file_size">>
    >();

  const files = [
    ...inlineFiles,
    ...(documentFiles ?? []).map((file) => ({
      name: file.file_name,
      mimeType: file.mime_type,
      size: file.file_size,
    })),
  ]
    .filter((file) => file.name.trim().length > 0)
    .slice(0, 6);

  return { urls, files };
}

function emptyQuestionAttachments(): PublicShareQuestionAttachments {
  return { urls: [], files: [] };
}

function userUrlsFromMetadata(
  metadata: MessageRow["metadata"] | null | undefined,
): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const urls = metadata.user_urls;
  if (!Array.isArray(urls)) return [];

  return urls
    .filter((url): url is string => typeof url === "string")
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 3);
}
