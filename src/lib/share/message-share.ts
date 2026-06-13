import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AgentRunRow,
  ChatSessionRow,
  MessageRow,
  MessageShareRow,
} from "@/types/database";
import {
  sanitizeAssistantContent,
  sanitizeAssistantPreviewContent,
} from "@/lib/chat/assistant-content";
import { parseChatAttachmentContent } from "@/lib/chat/attachments";
import { normalizeTickers } from "@/lib/ontology/ticker";
import type { Locale } from "@/i18n/config";
import { inferShareLocale } from "./share-locale";

const SHARE_TOKEN_BYTES = 18;
const MAX_SHARE_TITLE_LENGTH = 90;
const MAX_SHARE_QUESTION_CHARS = 8_000;
const SHARE_SNAPSHOT_VERSION = 2;

export interface PublicMessageShare {
  token: string;
  title: string;
  question_content: string | null;
  question_created_at: string | null;
  answer_content: string;
  answer_created_at: string;
  tickers: string[] | null;
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
      "token, title, question_content, question_created_at, answer_content, answer_created_at, tickers, created_at",
    )
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle<PublicMessageShare>();

  if (!data) return null;

  const answerContent = sanitizeAssistantContent(data.answer_content);
  const titleFallback = sanitizeAssistantPreviewContent(data.title);
  const questionContent = normalizeShareQuestion(data.question_content);
  return {
    ...data,
    title: buildShareTitle(answerContent, titleFallback || undefined),
    question_content: questionContent,
    answer_content: answerContent,
    tickers: normalizeShareTickers(data.tickers),
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
): Promise<Pick<MessageShareRow, "token" | "question_content"> | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("message_shares")
    .select("token, question_content")
    .eq("source_message_id", messageId)
    .is("revoked_at", null)
    .maybeSingle<Pick<MessageShareRow, "token" | "question_content">>();

  return data ?? null;
}

export async function createMessageShare(params: {
  userId: string;
  message: MessageRow;
  session: ChatSessionRow;
}): Promise<Pick<MessageShareRow, "token">> {
  const admin = getSupabaseAdmin();
  const token = createShareToken();
  const answerContent = sanitizeAssistantContent(params.message.content);
  const questionSnapshot = await resolveShareQuestionSnapshot(params);
  const payload = {
    token,
    owner_user_id: params.userId,
    source_session_id: params.session.id,
    source_message_id: params.message.id,
    source_question_message_id: questionSnapshot.sourceQuestionMessageId,
    title: buildShareTitle(answerContent, params.session.title),
    question_content: questionSnapshot.questionContent,
    question_created_at: questionSnapshot.questionCreatedAt,
    answer_content: answerContent,
    answer_created_at: params.message.created_at,
    tickers: normalizeShareTickers(params.session.default_tickers),
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
