import type { NextRequest } from "next/server";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser, forbiddenError, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createSessionShare,
  findExistingActiveSessionShare,
} from "@/lib/share/session-share";
import { buildSessionSharePath } from "@/lib/share/session-share-page";
import { inferShareLocale } from "@/lib/share/share-locale";
import { isUuid } from "@/lib/api/validation";
import type { ChatSessionRow, MessageRow } from "@/types/database";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) {
    return errorResponse(400, "validation_error", "잘못된 세션 ID입니다.");
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const admin = getSupabaseAdmin();

  // 세션 로드 + 소유권
  const { data: session, error: sessionError } = await admin
    .from("chat_sessions")
    .select(
      "id, user_id, title, claude_session_id, scope_type, default_tickers, default_document_types, created_at, updated_at",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single<ChatSessionRow>();

  if (sessionError || !session) {
    return errorResponse(404, "not_found", "채팅을 찾지 못했습니다.");
  }
  if (session.user_id !== user.id) {
    return forbiddenError("이 대화를 공유할 권한이 없습니다.");
  }

  // 세션의 모든 메시지 로드 (created_at 오름차순)
  const { data: messages, error: messagesError } = await admin
    .from("messages")
    .select("id, session_id, role, content, status, created_at, updated_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();

  if (messagesError || !messages) {
    return errorResponse(500, "internal_error", "메시지를 불러오지 못했습니다.");
  }

  // completed assistant 답변이 1개 이상인지 확인
  const hasCompletedAnswer = messages.some(
    (m) => m.role === "assistant" && m.status === "completed",
  );
  if (!hasCompletedAnswer) {
    return errorResponse(
      400,
      "no_completed_answers",
      "공유할 완료된 답변이 없습니다.",
    );
  }

  try {
    const existing = await findExistingActiveSessionShare(session.id);
    const share =
      existing ??
      (await createSessionShare({
        userId: user.id,
        session,
        messages,
      }));

    // locale 추론 후 URL 생성
    const firstAnswer =
      messages.find((m) => m.role === "assistant" && m.status === "completed")
        ?.content ?? "";
    const shareLocale = inferShareLocale({ answerContent: firstAnswer });
    const shareUrl = buildSessionSharePath(share.token, shareLocale);

    await recordAnalyticsEventFromRequest(request, {
      eventName: "session_share_created",
      userId: user.id,
      sessionId: session.id,
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
    console.error("[share] failed to create session share", error);
    return errorResponse(500, "internal_error", "공유 링크를 만들지 못했습니다.");
  }
}
