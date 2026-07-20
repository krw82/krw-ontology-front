import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contextSchema = z.object({
  timezone: z.string().trim().min(1).max(80),
});

const closeSchema = contextSchema.extend({
  feed_session_id: z.uuid(),
});

const closeResultSchema = z.object({
  id: z.uuid(),
  local_date: z.string(),
  closed_at: z.iso.datetime(),
  judgment_count: z.number().int().nonnegative(),
  observation_count: z.number().int().nonnegative(),
  thesis_update_count: z.number().int().nonnegative(),
  open_question_count: z.number().int().nonnegative(),
  next_check_count: z.number().int().nonnegative(),
  outcome: z.enum(["completed", "deferred"]),
  idempotent_replay: z.boolean(),
});

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsed = contextSchema.safeParse({
    timezone: request.nextUrl.searchParams.get("timezone"),
  });
  if (!parsed.success) return validationError();

  let localDate: string;
  try {
    localDate = formatLocalDate(new Date().toISOString(), parsed.data.timezone);
  } catch {
    return validationError("올바른 시간대를 선택해주세요.");
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_decision_sessions")
    .select("id,local_date,closed_at,judgment_count,observation_count,thesis_update_count,open_question_count,next_check_count,outcome")
    .eq("user_id", user.id)
    .eq("local_date", localDate)
    .maybeSingle();
  if (error) return internalError();
  return Response.json({
    id: data?.id ?? null,
    local_date: localDate,
    closed_at: data?.closed_at ?? null,
    judgment_count: data?.judgment_count ?? 0,
    observation_count: data?.observation_count ?? 0,
    thesis_update_count: data?.thesis_update_count ?? 0,
    open_question_count: data?.open_question_count ?? 0,
    next_check_count: data?.next_check_count ?? 0,
    outcome: data?.outcome ?? null,
  });
}

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsed = closeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError();

  try {
    formatLocalDate(new Date().toISOString(), parsed.data.timezone);
  } catch {
    return validationError("올바른 시간대를 선택해주세요.");
  }

  const { data, error } = await getSupabaseAdmin().rpc(
    "close_user_decision_session",
    {
      p_user_id: user.id,
      p_feed_session_id: parsed.data.feed_session_id,
      p_timezone: parsed.data.timezone,
    },
  );
  if (error) {
    if (error.code === "22023") return validationError();
    return internalError();
  }
  const result = closeResultSchema.safeParse(data);
  if (!result.success) return internalError();
  return Response.json(result.data, {
    status: result.data.idempotent_replay ? 200 : 201,
  });
}

function formatLocalDate(snapshotAt: string, timezone: string): string {
  const date = new Date(snapshotAt);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  if (!values.year || !values.month || !values.day) {
    throw new Error("invalid local date");
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function validationError(message = "오늘 종료 요청을 확인해주세요.") {
  return Response.json(
    { error: { code: "validation_error", message } },
    { status: 400 },
  );
}

function internalError() {
  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "오늘의 판단을 종료하지 못했습니다.",
      },
    },
    { status: 500 },
  );
}
