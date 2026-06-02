import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatSessionRow,
  MessageRow,
  MessageShareRow,
} from "@/types/database";
import {
  sanitizeAssistantContent,
  sanitizeAssistantPreviewContent,
} from "@/lib/chat/assistant-content";

const SHARE_TOKEN_BYTES = 18;
const MAX_SHARE_TITLE_LENGTH = 90;

export interface PublicMessageShare {
  token: string;
  title: string;
  answer_content: string;
  answer_created_at: string;
  tickers: string[] | null;
  created_at: string;
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
      "token, title, answer_content, answer_created_at, tickers, created_at",
    )
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle<PublicMessageShare>();

  if (!data) return null;

  const answerContent = sanitizeAssistantContent(data.answer_content);
  const titleFallback = sanitizeAssistantPreviewContent(data.title);
  return {
    ...data,
    title: buildShareTitle(answerContent, titleFallback || undefined),
    answer_content: answerContent,
  };
}

export async function findExistingActiveShare(
  messageId: string,
): Promise<Pick<MessageShareRow, "token"> | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("message_shares")
    .select("token")
    .eq("source_message_id", messageId)
    .is("revoked_at", null)
    .maybeSingle<Pick<MessageShareRow, "token">>();

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
  const payload = {
    token,
    owner_user_id: params.userId,
    source_session_id: params.session.id,
    source_message_id: params.message.id,
    title: buildShareTitle(answerContent, params.session.title),
    answer_content: answerContent,
    answer_created_at: params.message.created_at,
    tickers: params.session.default_tickers ?? null,
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
