import "server-only";

import { tryRecordCoverageActivation } from "@/lib/coverage/activation";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UserCompanyCoverageStatus, UserCompanyMark } from "@/types/api-contracts";
import type { UserCompanyMarkRow } from "@/types/database";

const MARK_SELECT =
  "user_id,ticker,coverage_status,priority,interest_reason,tags,last_activity_at,created_at,updated_at";

export class CoverageLimitError extends Error {
  readonly code = "coverage_limit_reached";

  constructor() {
    super("무료 플랜에서는 진행 중인 회사 커버리지를 최대 3개까지 둘 수 있습니다.");
    this.name = "CoverageLimitError";
  }
}

export class CoverageIdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";

  constructor() {
    super("같은 저장 요청 번호가 다른 커버리지 변경에 이미 사용되었습니다.");
    this.name = "CoverageIdempotencyConflictError";
  }
}

export interface SetCompanyCoverageStatusInput {
  userId: string;
  userEmail?: string | null;
  ticker: string;
  coverageStatus: UserCompanyCoverageStatus;
  idempotencyKey?: string;
  source?: string;
  priority?: number | null;
  interestReason?: string | null;
  tags?: string[] | null;
}

export interface CompanyCoverageMutationResult {
  mark: UserCompanyMark;
  eventId: string;
  previousStatus: UserCompanyCoverageStatus | null;
  changed: boolean;
  idempotentReplay: boolean;
}

interface CoverageMutationRpcResult {
  mark: UserCompanyMarkRow;
  event_id: string;
  previous_status: UserCompanyCoverageStatus | null;
  coverage_status: UserCompanyCoverageStatus;
  changed: boolean;
  idempotent_replay: boolean;
}

export async function setCompanyCoverageStatus(
  input: SetCompanyCoverageStatusInput,
): Promise<UserCompanyMark> {
  return (await setCompanyCoverageStatusWithEvent(input)).mark;
}

export async function setCompanyCoverageStatusWithEvent(
  input: SetCompanyCoverageStatusInput,
): Promise<CompanyCoverageMutationResult> {
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) throw new Error("invalid_ticker");

  const admin = getSupabaseAdmin();
  const entitlement = await getEntitlementStatus(input.userId, input.userEmail, {
    supabase: admin,
  });
  const activeLimit = entitlement.plan.key === "free" ? 3 : null;
  const { data, error } = await admin.rpc("set_user_company_coverage_status", {
    p_user_id: input.userId,
    p_ticker: ticker,
    p_coverage_status: input.coverageStatus,
    p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    p_source: input.source ?? "api",
    p_priority: input.priority ?? null,
    p_interest_reason: input.interestReason ?? null,
    p_tags: input.tags ?? null,
    p_active_limit: activeLimit,
  });

  if (error) {
    if (error.message?.includes("coverage_limit_reached")) {
      throw new CoverageLimitError();
    }
    if (error.message?.includes("idempotency_key_conflict")) {
      throw new CoverageIdempotencyConflictError();
    }
    throw new Error(`Failed to set company coverage: ${error.message}`);
  }
  const result = data as unknown as CoverageMutationRpcResult | null;
  if (!result?.mark || !result.event_id) {
    throw new Error("Failed to set company coverage: empty result");
  }
  if (!result.idempotent_replay && result.changed) {
    await tryRecordCoverageActivation(input.userId);
  }
  return {
    mark: companyMarkFromRow(result.mark),
    eventId: result.event_id,
    previousStatus: result.previous_status,
    changed: Boolean(result.changed),
    idempotentReplay: Boolean(result.idempotent_replay),
  };
}

export async function getCompanyCoverageStatus(
  userId: string,
  rawTicker: string,
): Promise<UserCompanyMark | null> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("user_company_marks")
    .select(MARK_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .maybeSingle<UserCompanyMarkRow>();
  if (error) throw new Error(`Failed to load company coverage: ${error.message}`);
  return data ? companyMarkFromRow(data) : null;
}

export async function ensureCompanyCoverage(input: {
  userId: string;
  userEmail?: string | null;
  ticker: string;
  source: string;
}): Promise<UserCompanyMark> {
  const existing = await getCompanyCoverageStatus(input.userId, input.ticker);
  if (existing) return existing;
  return setCompanyCoverageStatus({
    userId: input.userId,
    userEmail: input.userEmail,
    ticker: input.ticker,
    coverageStatus: "exploring",
    source: input.source,
  });
}

export function companyMarkFromRow(row: UserCompanyMarkRow): UserCompanyMark {
  return {
    user_id: row.user_id,
    ticker: row.ticker,
    coverage_status: row.coverage_status,
    priority: row.priority,
    interest_reason: row.interest_reason,
    tags: row.tags ?? [],
    last_activity_at: row.last_activity_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
