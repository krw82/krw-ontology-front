import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatSessionRow,
  MessageRow,
  SessionShareMessage,
  SessionShareRow,
} from "@/types/database";
import type { Locale } from "@/i18n/config";
import type { PublicShareContext } from "@/lib/share/message-share";
import {
  createShareToken,
  resolveShareContext,
} from "@/lib/share/message-share";
import { redactSensitiveOutput } from "@/lib/security/sensitive-output";
import { sanitizeAssistantContent } from "@/lib/chat/assistant-content";
import { parseChatAttachmentContent } from "@/lib/chat/attachments";
import { normalizeTickers } from "@/lib/ontology/ticker";
import { inferShareLocale } from "@/lib/share/share-locale";
import {
  buildSessionMessages,
  buildSessionShareTitle,
  pickFirstAssistantAnswer,
} from "@/lib/share/session-share-message";

const SESSION_SHARE_SNAPSHOT_VERSION = 1;

export interface PublicSessionShare {
  token: string;
  title: string;
  tickers: string[] | null;
  locale: Locale;
  messages: SessionShareMessage[];
  message_count: number;
  share_context: PublicShareContext;
  created_at: string;
}

/**
 * message-share.ts의 internal helper(`normalizeShareTickers`)와 동일 로직.
 * "기존 코드 0줄 변경" 원칙에 따라 복사하여 사용한다.
 * normalizeTickers만 export되어 있으므로 그것을 재사용.
 */
function normalizeShareTickers(
  tickers: readonly string[] | null | undefined,
): string[] | null {
  const normalized = normalizeTickers(tickers ?? []);
  return normalized.length > 0 ? normalized : null;
}

/**
 * session_shares 테이블에서 특정 세션의 활성(취소되지 않은) 공유를 조회한다.
 * 동일 세션에 대해 이미 공유가 존재하면 재사용하기 위해 사용된다.
 */
export async function findExistingActiveSessionShare(
  sessionId: string,
): Promise<Pick<SessionShareRow, "token" | "locale"> | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("session_shares")
    .select("token, locale")
    .eq("source_session_id", sessionId)
    .is("revoked_at", null)
    .maybeSingle<Pick<SessionShareRow, "token" | "locale">>();
  return data ?? null;
}

/**
 * 세션 공유를 생성한다.
 *
 * - messages 배열을 빌드하고 redaction/sanitization을 적용한다.
 * - 첫 completed assistant 답변으로 title을 생성한다.
 * - locale은 assistant 답변 텍스트를 기반으로 추론하여 반환한다.
 * - share_context는 첫 completed assistant 답변을 기반으로 resolveShareContext로 추론한다.
 * - unique-violation(race) 시 기존 활성 공유를 fallback으로 반환한다.
 */
export async function createSessionShare(params: {
  userId: string;
  session: ChatSessionRow;
  messages: MessageRow[];
}): Promise<Pick<SessionShareRow, "token" | "locale">> {
  const admin = getSupabaseAdmin();
  const token = createShareToken();

  // 메시지 선택 + 정렬
  const selectedMessages = buildSessionMessages(params.messages);
  if (selectedMessages.length === 0) {
    throw new Error("No completed Q&A to share");
  }

  // 정제 적용 (redact + sanitize)
  // user message: <attached_file> wire format을 visible text로 교체한 뒤 redact.
  // assistant message: sanitizeAssistantContent가 전용 포맷을 처리.
  const sanitizedMessages: SessionShareMessage[] = selectedMessages.map((m) => ({
    role: m.role,
    content:
      m.role === "assistant"
        ? redactSensitiveOutput(sanitizeAssistantContent(m.content)).content
        : redactSensitiveOutput(
            parseChatAttachmentContent(m.content).visibleText,
          ).content,
    created_at: m.created_at,
  }));

  // 첫 completed assistant 답변으로 타이틀 생성
  const firstAnswer = pickFirstAssistantAnswer(params.messages);
  const sanitizedFirstAnswer = redactSensitiveOutput(
    sanitizeAssistantContent(firstAnswer),
  ).content;
  const title = buildSessionShareTitle(
    sanitizedFirstAnswer,
    params.session.title,
  );

  // share_context: 첫 completed assistant 답변에서 run_kind/guru_lens 추론
  const firstAssistantMessage = params.messages.find(
    (m) => m.role === "assistant" && m.status === "completed",
  );
  const shareContext: PublicShareContext = firstAssistantMessage
    ? await resolveShareContext(admin, firstAssistantMessage)
    : { run_kind: null, guru_lens: null };

  // locale 추론 (모든 assistant 답변 텍스트 기반)
  const locale = inferShareLocale({
    answerContent: sanitizedMessages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n"),
  });

  const payload = {
    token,
    owner_user_id: params.userId,
    source_session_id: params.session.id,
    title,
    tickers: normalizeShareTickers(params.session.default_tickers),
    locale,
    messages: sanitizedMessages,
    message_count: sanitizedMessages.length,
    share_context: shareContext,
    snapshot_version: SESSION_SHARE_SNAPSHOT_VERSION,
  };

  const { data, error } = await admin
    .from("session_shares")
    .insert(payload)
    .select("token, locale")
    .single<Pick<SessionShareRow, "token" | "locale">>();

  if (!error && data) return data;

  // unique-violation (race) → fallback
  const existing = await findExistingActiveSessionShare(params.session.id);
  if (existing) return existing;

  throw new Error(error?.message || "Failed to create session share");
}

/**
 * 공유 토큰으로 공개 세션 공유를 조회한다.
 * revoked_at이 null인 경우에만 반환하며, 방어적으로 redaction을 재적용한다.
 */
export async function findPublicSessionShare(
  token: string,
): Promise<PublicSessionShare | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("session_shares")
    .select(
      "token, title, tickers, locale, messages, message_count, share_context, created_at",
    )
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle<
      Omit<PublicSessionShare, "messages" | "share_context" | "locale"> & {
        messages: SessionShareMessage[];
        share_context: unknown;
        locale: string;
      }
    >();

  if (!data) return null;

  // 방어적 redaction 재적용
  const redactedMessages = data.messages.map((m) => ({
    role: m.role,
    content: redactSensitiveOutput(m.content).content,
    created_at: m.created_at,
  }));

  const shareContext = normalizeStoredShareContext(data.share_context);

  return {
    token: data.token,
    title: data.title,
    tickers: data.tickers,
    locale: data.locale as Locale,
    messages: redactedMessages,
    message_count: data.message_count,
    share_context: shareContext,
    created_at: data.created_at,
  };
}

/**
 * DB에 저장된 share_context(JSON)를 PublicShareContext로 정규화한다.
 * message-share.ts의 internal `normalizeShareContext`와 동일 로직이며,
 * export되지 않았으므로 복사하여 사용한다.
 */
function normalizeStoredShareContext(value: unknown): PublicShareContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { run_kind: null, guru_lens: null };
  }
  const record = value as Record<string, unknown>;
  return {
    run_kind: readShareRunKind(record.run_kind),
    guru_lens: readShareGuruLens(record.guru_lens),
  };
}

function readShareRunKind(value: unknown): PublicShareContext["run_kind"] {
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

function readShareGuruLens(value: unknown): PublicShareContext["guru_lens"] {
  if (typeof value !== "string" || value.length === 0) return null;
  return value as PublicShareContext["guru_lens"];
}
