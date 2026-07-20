import type { DesktopErrorCode } from "./ontology-contracts";

/**
 * Shared desktop authentication contract that is safe to import from
 * standalone Node workers. Keeping it separate from request authentication
 * prevents worker bundles from pulling in Next.js request-only modules.
 */
export interface DesktopAuthContext {
  userId: string;
  userEmail: string | null;
  deviceId: string | null;
  authMethod: "desktop_access_token" | "dev_token";
}

export class DesktopAuthError extends Error {
  code: DesktopErrorCode;
  publicMessage: string;
  status: number;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: DesktopErrorCode;
      publicMessage?: string;
      status?: number;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "DesktopAuthError";
    this.code = options.code ?? "authentication_error";
    this.publicMessage = options.publicMessage ?? message;
    this.status = options.status ?? 401;
    this.retryable = Boolean(options.retryable);
  }
}
