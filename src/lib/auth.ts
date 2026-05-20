import { createClient } from "@/lib/supabase/server";
import { AuthError } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import {
  DEV_AUTH_EMAIL,
  DEV_AUTH_NAME,
  DEV_AUTH_USER_ID,
  isDevAuthBypassEnabled,
} from "@/lib/dev-auth";

export async function getAuthUser(): Promise<User | null> {
  if (isDevAuthBypassEnabled()) {
    return {
      id: DEV_AUTH_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: DEV_AUTH_EMAIL,
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
      phone: "",
      confirmed_at: "2026-01-01T00:00:00.000Z",
      last_sign_in_at: "2026-01-01T00:00:00.000Z",
      app_metadata: {
        provider: "dev-auth-bypass",
        providers: ["dev-auth-bypass"],
      },
      user_metadata: {
        name: DEV_AUTH_NAME,
        full_name: DEV_AUTH_NAME,
      },
      identities: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      is_anonymous: false,
    } as User;
  }

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
  if (err instanceof Error && err.message === "No user") {
    return authError(requestId);
  }
  if (isAuthError(err)) {
    return authError(requestId);
  }
  return serviceUnavailableError("Authentication service unavailable", requestId);
}
