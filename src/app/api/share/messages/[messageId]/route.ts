import type { NextRequest } from "next/server";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser, forbiddenError, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createMessageShare,
  ensureMessageShareContextSnapshot,
  ensureMessageShareQuestionSnapshot,
  findExistingActiveShare,
} from "@/lib/share/message-share";
import { buildSharePath, inferShareLocale } from "@/lib/share/share-locale";
import { isUuid } from "@/lib/api/validation";
import type { ChatSessionRow, MessageRow } from "@/types/database";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await params;
  if (!isUuid(messageId)) {
    return errorResponse(400, "validation_error", "잘못된 메시지 ID입니다.");
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const admin = getSupabaseAdmin();
  const { data: message, error: messageError } = await admin
    .from("messages")
    .select("id, session_id, role, content, status, created_at, updated_at")
    .eq("id", messageId)
    .single<MessageRow>();

  if (messageError || !message) {
    return errorResponse(404, "not_found", "답변을 찾지 못했습니다.");
  }

  if (message.role !== "assistant" || message.status !== "completed") {
    return errorResponse(400, "validation_error", "완료된 답변만 공유할 수 있습니다.");
  }

  const { data: session, error: sessionError } = await admin
    .from("chat_sessions")
    .select(
      "id, user_id, title, claude_session_id, scope_type, default_tickers, default_document_types, created_at, updated_at",
    )
    .eq("id", message.session_id)
    .is("deleted_at", null)
    .single<ChatSessionRow>();

  if (sessionError || !session) {
    return errorResponse(404, "not_found", "채팅을 찾지 못했습니다.");
  }

  if (session.user_id !== user.id) {
    return forbiddenError("이 답변을 공유할 권한이 없습니다.");
  }

  try {
    const existing = await findExistingActiveShare(message.id);
    if (existing && !existing.question_content) {
      await ensureMessageShareQuestionSnapshot({ message, session });
    }
    if (existing && isMissingShareRunKind(existing.share_context)) {
      await ensureMessageShareContextSnapshot({ message });
    }
    const share =
      existing ?? (await createMessageShare({ userId: user.id, message, session }));
    const shareLocale = inferShareLocale({ answerContent: message.content });
    const shareUrl = buildSharePath(share.token, shareLocale);

    await recordAnalyticsEventFromRequest(request, {
      eventName: "share_created",
      userId: user.id,
      sessionId: session.id,
      messageId: message.id,
      properties: {
        reused_existing_share: Boolean(existing),
        scope_type: session.scope_type,
        ticker: session.default_tickers?.[0] ?? null,
        tickers: session.default_tickers ?? [],
      },
    });

    return Response.json({
      token: share.token,
      share_url: shareUrl,
      url: new URL(shareUrl, request.url).toString(),
    });
  } catch (error) {
    console.error("[share] failed to create message share", error);
    return errorResponse(500, "internal_error", "공유 링크를 만들지 못했습니다.");
  }
}

function isMissingShareRunKind(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  return typeof (value as Record<string, unknown>).run_kind !== "string";
}
