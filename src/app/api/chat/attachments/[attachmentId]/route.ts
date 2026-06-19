import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { isUuid } from "@/lib/api/validation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ChatAttachmentRow } from "@/types/database";

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

  const { data: attachment, error } = await getSupabaseAdmin()
    .from("chat_attachments")
    .select(
      "id, file_name, file_size, mime_type, extraction_status, extraction_error, extracted_char_count, created_at, updated_at",
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

  return Response.json({
    attachment: {
      id: attachment.id,
      file_name: attachment.file_name,
      file_size: attachment.file_size,
      mime_type: attachment.mime_type,
      status: attachment.extraction_status,
      error: attachment.extraction_error,
      extracted_char_count: attachment.extracted_char_count,
      created_at: attachment.created_at,
      updated_at: attachment.updated_at,
    },
  });
}
