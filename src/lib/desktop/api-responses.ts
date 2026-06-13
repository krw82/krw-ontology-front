import { DesktopAuthError } from "./auth";
import { DesktopOntologyServiceError } from "./ontology-service";
import {
  desktopErrorResponse,
  DesktopContractError,
  type DesktopErrorCode,
} from "./ontology-contracts";

export function desktopJsonError(
  code: DesktopErrorCode,
  publicMessage: string,
  status: number,
  options: { message?: string; retryable?: boolean; headers?: HeadersInit } = {},
) {
  return Response.json(
    desktopErrorResponse(code, publicMessage, options),
    { status, headers: options.headers },
  );
}

export function desktopUnknownError() {
  return desktopJsonError(
    "internal_error",
    "KRW Desktop API 요청 중 오류가 발생했습니다.",
    500,
  );
}

export function handleDesktopApiError(error: unknown) {
  if (error instanceof DesktopContractError) {
    return desktopJsonError(error.code, error.publicMessage, error.status, {
      message: error.message,
      retryable: error.retryable,
    });
  }

  if (error instanceof DesktopAuthError) {
    return desktopJsonError(error.code, error.publicMessage, error.status, {
      message: error.message,
      retryable: error.retryable,
    });
  }

  if (error instanceof DesktopOntologyServiceError) {
    return desktopJsonError(error.code, error.publicMessage, error.status, {
      message: error.message,
      retryable: error.retryable,
    });
  }

  return desktopUnknownError();
}
