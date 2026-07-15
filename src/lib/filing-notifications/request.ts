import "server-only";

import type { NextRequest } from "next/server";
import { getConfiguredAppOrigin } from "@/lib/auth/origin";

export function isExpectedMutationOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const configuredOrigin = getConfiguredAppOrigin();
  const requestOrigin = request.nextUrl.origin;
  const expectedOrigin = configuredOrigin ?? requestOrigin;

  if (!origin) return process.env.NODE_ENV !== "production";
  return origin === expectedOrigin;
}

export function invalidOriginResponse() {
  return Response.json(
    {
      error: {
        code: "forbidden",
        message: "허용되지 않은 요청 출처입니다.",
      },
    },
    { status: 403 },
  );
}
