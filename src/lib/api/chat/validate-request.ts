import { NextRequest } from "next/server";
import type { ChatRunRequest, ErrorCode } from "@/types/api-contracts";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { validateChatAttachments } from "@/lib/chat/attachments";
import { getChatContentLimit } from "@/lib/chat-limits";
import {
  isOptionalStringArray,
  isPlainObject,
  isUuid,
  normalizeStringList,
} from "@/lib/api/validation";

interface ValidatedRequest {
  body: ChatRunRequest;
  userId: string;
}

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId?: string
) {
  return Response.json(
    { error: { code, message }, request_id: requestId },
    { status }
  );
}

/**
 * Validates the incoming request: parses JSON body, checks required fields,
 * content length, and authenticates the user.
 *
 * Returns either a ValidatedRequest or a Response (error).
 */
export async function validateRequest(
  request: NextRequest
): Promise<{ ok: true; data: ValidatedRequest } | { ok: false; response: Response }> {
  // Parse JSON body
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return { ok: false, response: errorResponse(400, "validation_error", "Invalid JSON body") };
  }

  if (!isPlainObject(parsedBody)) {
    return {
      ok: false,
      response: errorResponse(400, "validation_error", "Request body must be an object"),
    };
  }

  const {
    content,
    request_id,
    session_id,
    scope_type,
    default_tickers,
    default_document_types,
  } = parsedBody;

  if (typeof content !== "string" || typeof request_id !== "string") {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "content and request_id must be strings",
        typeof request_id === "string" ? request_id : undefined,
      ),
    };
  }

  const normalizedRequestId = request_id.trim();
  if (content.trim().length === 0 || !normalizedRequestId) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "Missing required fields: content, request_id",
        normalizedRequestId || undefined,
      ),
    };
  }

  if (session_id !== undefined && typeof session_id !== "string") {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "session_id must be a string",
        normalizedRequestId,
      ),
    };
  }

  if (typeof session_id === "string" && !isUuid(session_id)) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "session_id must be a valid UUID",
        normalizedRequestId,
      ),
    };
  }

  if (
    scope_type !== undefined &&
    scope_type !== "global" &&
    scope_type !== "company"
  ) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "scope_type must be global or company",
        normalizedRequestId,
      ),
    };
  }

  if (!isOptionalStringArray(default_tickers)) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "default_tickers must be an array of strings",
        normalizedRequestId,
      ),
    };
  }

  if (!isOptionalStringArray(default_document_types)) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "default_document_types must be an array of strings",
        normalizedRequestId,
      ),
    };
  }

  const normalizedDefaultTickers = normalizeStringList(default_tickers);
  const normalizedDefaultDocumentTypes = normalizeStringList(default_document_types);
  const attachmentValidation = validateChatAttachments(content);
  if (!attachmentValidation.ok) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        attachmentValidation.message,
        normalizedRequestId,
      ),
    };
  }

  const body: ChatRunRequest = {
    content,
    request_id: normalizedRequestId,
    ...(session_id ? { session_id } : {}),
    ...(scope_type ? { scope_type } : {}),
    ...(default_tickers ? { default_tickers: normalizedDefaultTickers } : {}),
    ...(default_document_types
      ? { default_document_types: normalizedDefaultDocumentTypes }
      : {}),
  };

  if (!body.session_id && body.scope_type === "company" && !body.default_tickers?.length) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "default_tickers required for company scope",
        normalizedRequestId,
      ),
    };
  }

  const contentLimit = getChatContentLimit(content);
  if (content.trim().length < 1 || content.length > contentLimit) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        `Content must be between 1 and ${contentLimit.toLocaleString()} characters`,
        normalizedRequestId
      ),
    };
  }

  // Authenticate user
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return { ok: false, response: handleAuthError(err, normalizedRequestId) };
  }
  if (!user) {
    return { ok: false, response: handleAuthError(new Error("No user"), normalizedRequestId) };
  }

  return { ok: true, data: { body, userId: user.id } };
}
