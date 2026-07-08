import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { isUuid } from "@/lib/api/validation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ChatAttachmentRow, DocumentIngestionJobRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { attachmentId } = await params;
  if (!isUuid(attachmentId)) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "첨부 문서 형식이 올바르지 않습니다.",
        },
      },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: attachment, error } = await admin
    .from("chat_attachments")
    .select(
      "id, file_name, file_size, mime_type, extraction_status, extraction_stage, progress_percent, last_event_seq, error_code, error_message, extraction_error, extracted_char_count, created_at, updated_at",
    )
    .eq("id", attachmentId)
    .eq("user_id", user.id)
    .maybeSingle<
      Pick<
        ChatAttachmentRow,
        | "id"
        | "file_name"
        | "file_size"
        | "mime_type"
        | "extraction_status"
        | "extraction_stage"
        | "progress_percent"
        | "last_event_seq"
        | "error_code"
        | "error_message"
        | "extraction_error"
        | "extracted_char_count"
        | "created_at"
        | "updated_at"
      >
    >();

  if (error) {
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "첨부 문서 상태를 확인하지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }

  if (!attachment) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: "첨부 문서를 찾지 못했습니다.",
        },
      },
      { status: 404 },
    );
  }

  const { data: job, error: jobError } = await admin
    .from("document_ingestion_jobs")
    .select("id, status, stage, progress_percent, last_event_seq, updated_at")
    .eq("attachment_id", attachment.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<
        DocumentIngestionJobRow,
        | "id"
        | "status"
        | "stage"
        | "progress_percent"
        | "last_event_seq"
        | "updated_at"
      >
    >();

  if (jobError) {
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "첨부 문서 작업 상태를 확인하지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }

  return Response.json({
    attachment: {
      id: attachment.id,
      file_name: attachment.file_name,
      file_size: attachment.file_size,
      mime_type: attachment.mime_type,
      status: attachment.extraction_status,
      stage: attachment.extraction_stage,
      progress_percent: attachment.progress_percent,
      last_event_seq: attachment.last_event_seq,
      error: attachment.error_message ?? attachment.extraction_error,
      error_code: attachment.error_code,
      extracted_char_count: attachment.extracted_char_count,
      job: job
        ? {
            id: job.id,
            status: job.status,
            stage: job.stage,
            progress_percent: job.progress_percent,
            last_event_seq: job.last_event_seq,
            updated_at: job.updated_at,
          }
        : null,
      created_at: attachment.created_at,
      updated_at: attachment.updated_at,
    },
  });
}
