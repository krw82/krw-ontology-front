import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  MAX_ACTIVE_DOCUMENT_ATTACHMENTS_PER_USER,
  MAX_DOCUMENT_ATTACHMENT_BYTES,
} from "@/lib/document-ingestion/config";
import {
  documentAttachmentRelativePath,
  removeDocumentAttachment,
  writeDocumentAttachment,
} from "@/lib/document-ingestion/storage";
import { isUuid } from "@/lib/api/validation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ChatAttachmentRow, ChatSessionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(status: number, message: string) {
  return Response.json(
    { error: { code: "validation_error", message } },
    { status },
  );
}

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse(400, "첨부할 파일이 없습니다.");
  }

  if (!isPdfFile(file)) {
    return errorResponse(400, "PDF 파일만 업로드할 수 있습니다.");
  }

  if (file.size <= 0 || file.size > MAX_DOCUMENT_ATTACHMENT_BYTES) {
    return errorResponse(
      400,
      `PDF 파일은 최대 ${Math.round(
        MAX_DOCUMENT_ATTACHMENT_BYTES / 1024 / 1024,
      )}MB까지 첨부할 수 있습니다.`,
    );
  }

  const rawSessionId = formData.get("session_id");
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : null;
  if (sessionId && !isUuid(sessionId)) {
    return errorResponse(400, "채팅 세션 형식이 올바르지 않습니다.");
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { count: activeAttachmentCount, error: countError } = await admin
    .from("chat_attachments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("message_id", null)
    .gt("expires_at", now)
    .in("extraction_status", ["queued", "processing", "completed"]);

  if (countError) {
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "첨부 상태를 확인하지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }

  if ((activeAttachmentCount ?? 0) >= MAX_ACTIVE_DOCUMENT_ATTACHMENTS_PER_USER) {
    return errorResponse(
      429,
      "처리되지 않은 첨부 문서가 너무 많습니다. 일부 첨부를 사용하거나 잠시 후 다시 시도해주세요.",
    );
  }

  let session: Pick<
    ChatSessionRow,
    "id" | "user_id" | "default_tickers"
  > | null = null;

  if (sessionId) {
    const { data, error } = await admin
      .from("chat_sessions")
      .select("id, user_id, default_tickers")
      .eq("id", sessionId)
      .is("deleted_at", null)
      .maybeSingle<Pick<ChatSessionRow, "id" | "user_id" | "default_tickers">>();

    if (error || !data || data.user_id !== user.id) {
      return errorResponse(404, "채팅 세션을 찾지 못했습니다.");
    }
    session = data;
  }

  const attachmentId = randomUUID();
  const relativePath = documentAttachmentRelativePath({
    userId: user.id,
    attachmentId,
    fileName: file.name,
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeDocumentAttachment({ relativePath, content: buffer });

  const { data: attachment, error: attachmentError } = await admin
    .from("chat_attachments")
    .insert({
      id: attachmentId,
      user_id: user.id,
      session_id: session?.id ?? null,
      ticker: session?.default_tickers?.[0] ?? null,
      file_name: file.name,
      mime_type: file.type || "application/pdf",
      file_size: file.size,
      storage_kind: "local_fs",
      original_path: relativePath,
      extraction_status: "queued",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single<ChatAttachmentRow>();

  if (attachmentError || !attachment) {
    await removeDocumentAttachment(relativePath).catch(() => undefined);
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "첨부 파일을 저장하지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }

  const { error: jobError } = await admin.from("document_ingestion_jobs").insert({
    attachment_id: attachment.id,
    status: "queued",
  });

  if (jobError) {
    await removeDocumentAttachment(relativePath).catch(() => undefined);
    await admin.from("chat_attachments").delete().eq("id", attachment.id);
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "문서 변환 작업을 준비하지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }

  return Response.json(
    {
      attachment: {
        id: attachment.id,
        file_name: attachment.file_name,
        file_size: attachment.file_size,
        mime_type: attachment.mime_type,
        status: attachment.extraction_status,
      },
    },
    { status: 201 },
  );
}
