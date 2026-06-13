import "server-only";

import { isPlainObject } from "@/lib/api/validation";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";

export function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function parseJsonObject(request: Request) {
  const body = await request.json().catch(() => null);
  return isPlainObject(body) ? body : null;
}

export function stringInput(
  body: Record<string, unknown>,
  key: string,
  options: { maxLength?: number; required?: boolean } = {},
): string | null {
  const value = body[key];
  if (value === undefined || value === null) return options.required ? null : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return options.required ? null : "";
  return normalized.slice(0, options.maxLength ?? normalized.length);
}

export function textInput(
  body: Record<string, unknown>,
  key: string,
  options: { maxLength?: number; required?: boolean } = {},
): string | null {
  const value = body[key];
  if (value === undefined || value === null) return options.required ? null : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return options.required ? null : "";
  return normalized.slice(0, options.maxLength ?? normalized.length);
}

export function booleanInput(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  return typeof body[key] === "boolean" ? body[key] : undefined;
}

export function stringArrayInput(
  body: Record<string, unknown>,
  key: string,
  options: { maxItems?: number; maxLength?: number } = {},
): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const maxItems = options.maxItems ?? 12;
  const maxLength = options.maxLength ?? 40;
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/\s+/g, " ").trim().slice(0, maxLength))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}

export async function requireIndexedTicker(rawTicker: string | null | undefined) {
  const ticker = normalizeTicker(rawTicker ?? "");
  if (!ticker) {
    return {
      ok: false as const,
      response: errorResponse(400, "validation_error", "올바른 티커를 입력해주세요."),
    };
  }

  let company;
  try {
    company = await getIndexedCompany(ticker);
  } catch {
    return {
      ok: false as const,
      response: errorResponse(
        503,
        "service_unavailable",
        "온톨로지 인덱스를 확인하지 못했습니다.",
      ),
    };
  }

  if (!company) {
    return {
      ok: false as const,
      response: errorResponse(
        400,
        "validation_error",
        `현재 온톨로지 인덱스에 없는 회사입니다: ${ticker}`,
      ),
    };
  }

  return { ok: true as const, ticker, company };
}
