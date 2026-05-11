import { NextRequest } from "next/server";
import type { ChatRunRequest, ErrorCode } from "@/types/api-contracts";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getChatContentLimit } from "@/lib/chat-limits";

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
  let body: ChatRunRequest;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: errorResponse(400, "validation_error", "Invalid JSON body") };
  }

  const { session_id, content, request_id } = body;

  if (!session_id || !content || !request_id) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        "Missing required fields: session_id, content, request_id",
        request_id
      ),
    };
  }

  const contentLimit = getChatContentLimit(content);
  if (content.length < 1 || content.length > contentLimit) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "validation_error",
        `Content must be between 1 and ${contentLimit.toLocaleString()} characters`,
        request_id
      ),
    };
  }

  // Authenticate user
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return { ok: false, response: handleAuthError(err, request_id) };
  }
  if (!user) {
    return { ok: false, response: handleAuthError(new Error("No user"), request_id) };
  }

  return { ok: true, data: { body, userId: user.id } };
}
