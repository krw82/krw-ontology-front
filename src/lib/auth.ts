import { createClient } from "@/lib/supabase/server";
import { AuthError } from "@supabase/supabase-js";

export async function getAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return user;
}

export function authError(requestId?: string) {
  return Response.json(
    {
      error: {
        code: "authentication_error" as const,
        message: "Authentication required",
      },
      request_id: requestId,
    },
    { status: 401 }
  );
}

export function serviceUnavailableError(message: string, requestId?: string) {
  return Response.json(
    {
      error: {
        code: "service_unavailable" as const,
        message,
      },
      request_id: requestId,
    },
    { status: 503 }
  );
}

export function forbiddenError(message: string, requestId?: string) {
  return Response.json(
    {
      error: {
        code: "forbidden" as const,
        message,
      },
      request_id: requestId,
    },
    { status: 403 }
  );
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}

export function handleAuthError(err: unknown, requestId?: string) {
  if (isAuthError(err)) {
    return authError(requestId);
  }
  return serviceUnavailableError("Authentication service unavailable", requestId);
}
