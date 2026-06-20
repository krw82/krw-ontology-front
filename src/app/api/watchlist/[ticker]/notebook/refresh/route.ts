import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { reserveBudgetStep } from "@/lib/api/chat";
import { isUuid } from "@/lib/api/validation";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { shouldBlockAnalysisCreditReservation } from "@/lib/billing/credit-policy";
import { reserveAnalysisCreditsShadow } from "@/lib/concurrency/analysis-credits";
import {
  estimateCost,
  releaseExecutionBudget,
  settleExecutionBudget,
} from "@/lib/concurrency/execution-budget";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse, requireIndexedTicker } from "@/lib/watchlist/api";
import {
  generateResearchNotebookMarkdown,
  generateResearchNotebookOpenQuestions,
  listRecentTickerNotebookConversations,
  saveExtractedNotebookQuestions,
  type NotebookConversationInput,
  type NotebookAgentUsage,
} from "@/lib/watchlist/notebook-refresh";
import {
  defaultCompanyNotebook,
  getCompanyNotebook,
} from "@/lib/watchlist/workspace";
import type { UserCompanyNotebook } from "@/types/api-contracts";
import type {
  UserCompanyNotebookRefreshJobRow,
  UserCompanyNotebookRow,
} from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTEBOOK_SELECT =
  "id, user_id, ticker, title, content_md, previous_content_md, basis_release_id, basis_period, last_source_chat_session_id, last_source_message_id, created_at, updated_at";
const REFRESH_JOB_SELECT =
  "id, user_id, ticker, status, notebook_id, recent_conversation_count, saved_question_count, last_source_chat_session_id, last_source_message_id, error_code, error_message, requested_at, started_at, completed_at, created_at, updated_at";
const ACTIVE_REFRESH_STATUSES = ["queued", "running"] as const;
const STALE_REFRESH_JOB_MS = 30 * 60 * 1000;
const NOTEBOOK_REFRESH_RESEARCH_MODE = "standard";

interface NotebookRefreshJobContext {
  userId: string;
  creditRequestId: string;
  ticker: string;
  companyName: string;
  latestPeriod: string | null;
  existing: UserCompanyNotebook;
  recentConversations: NotebookConversationInput[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (jobId && !isUuid(jobId)) {
    return errorResponse(400, "validation_error", "노트북 정리 작업 ID가 올바르지 않습니다.");
  }

  const job = jobId
    ? await getRefreshJob(user.id, tickerResult.ticker, jobId)
    : await getActiveRefreshJob(user.id, tickerResult.ticker);

  if (!job) {
    return jobId
      ? errorResponse(404, "not_found", "노트북 정리 작업을 찾지 못했습니다.")
      : Response.json({ job: null, notebook: null });
  }

  const normalizedJob = await expireStaleRefreshJob(job);
  const notebook =
    normalizedJob.status === "succeeded"
      ? await getCompanyNotebook(user.id, tickerResult.ticker)
      : null;

  return Response.json({
    job: normalizedJob,
    notebook,
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;

  const activeJob = await getActiveRefreshJob(user.id, tickerResult.ticker);
  if (activeJob) {
    return Response.json({ job: activeJob, notebook: null }, { status: 202 });
  }

  const existing =
    (await getCompanyNotebook(user.id, tickerResult.ticker)) ??
    defaultCompanyNotebook(user.id, tickerResult.ticker, tickerResult.company);
  const recentConversations = await listRecentTickerNotebookConversations(
    user.id,
    tickerResult.ticker,
    3,
  );

  if (recentConversations.length === 0) {
    return errorResponse(
      409,
      "conflict",
      "노트북에 반영할 완료된 최근 대화가 없습니다.",
    );
  }

  const creditRequestId = randomUUID();
  const budgetResult = await reserveBudgetStep(
    user.id,
    creditRequestId,
    user.email ?? null,
    NOTEBOOK_REFRESH_RESEARCH_MODE,
  );
  if (!budgetResult.ok) return budgetResult.response;

  const creditReservation = await reserveAnalysisCreditsShadow(
    user.id,
    creditRequestId,
    {
      runKind: "company_research",
      researchMode: NOTEBOOK_REFRESH_RESEARCH_MODE,
    },
  );
  if (
    !budgetResult.budget.entitlement?.usage.unlimited &&
    shouldBlockAnalysisCreditReservation(creditReservation)
  ) {
    await releaseExecutionBudget(
      user.id,
      creditRequestId,
      null,
      "notebook_credit_reserve_blocked",
    );
    return errorResponse(
      creditReservation.ok ? 429 : 500,
      creditReservation.ok ? "cost_cap_exceeded" : "internal_error",
      creditReservation.ok
        ? "이번 주 분석 한도에 도달해 노트북 정리를 시작할 수 없습니다."
        : "사용량 정보를 확인하지 못했습니다.",
    );
  }

  const latestSource = recentConversations[0] ?? null;
  const { data: job, error } = await getSupabaseAdmin()
    .from("user_company_notebook_refresh_jobs")
    .insert({
      user_id: user.id,
      ticker: tickerResult.ticker,
      status: "queued",
      recent_conversation_count: recentConversations.length,
      last_source_chat_session_id: latestSource?.session_id ?? null,
      last_source_message_id: latestSource?.assistant_message_id ?? null,
    })
    .select(REFRESH_JOB_SELECT)
    .single<UserCompanyNotebookRefreshJobRow>();

  if (error || !job) {
    await releaseExecutionBudget(
      user.id,
      creditRequestId,
      null,
      "notebook_refresh_job_insert_failed",
    );
    const existingActiveJob = await getActiveRefreshJob(user.id, tickerResult.ticker);
    if (existingActiveJob) {
      return Response.json(
        { job: existingActiveJob, notebook: null },
        { status: 202 },
      );
    }

    return errorResponse(500, "internal_error", "노트북 정리 작업을 시작하지 못했습니다.");
  }

  void runNotebookRefreshJob(job.id, {
    userId: user.id,
    creditRequestId,
    ticker: tickerResult.ticker,
    companyName: tickerResult.company.name ?? tickerResult.ticker,
    latestPeriod: tickerResult.company.latest_period,
    existing,
    recentConversations,
  });

  return Response.json({ job, notebook: null }, { status: 202 });
}

async function runNotebookRefreshJob(
  jobId: string,
  context: NotebookRefreshJobContext,
) {
  const admin = getSupabaseAdmin();
  const usage = createNotebookUsageAccumulator();

  try {
    await admin
      .from("user_company_notebook_refresh_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      })
      .eq("id", jobId)
      .eq("user_id", context.userId)
      .eq("ticker", context.ticker);

    const contentMd = await generateResearchNotebookMarkdown({
      ticker: context.ticker,
      companyName: context.companyName,
      basisPeriod: context.existing.basis_period ?? context.latestPeriod,
      existingNotebookMd: context.existing.content_md,
      recentConversations: context.recentConversations,
      onUsage: usage.add,
    });

    const latestSource = context.recentConversations[0] ?? null;
    const { data: notebook, error: notebookError } = await admin
      .from("user_company_notebooks")
      .upsert(
        {
          user_id: context.userId,
          ticker: context.ticker,
          title: context.existing.title || `${context.ticker} 리서치 노트북`,
          content_md: contentMd,
          previous_content_md: context.existing.content_md,
          basis_period: context.existing.basis_period ?? context.latestPeriod,
          last_source_chat_session_id: latestSource?.session_id ?? null,
          last_source_message_id: latestSource?.assistant_message_id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,ticker" },
      )
      .select(NOTEBOOK_SELECT)
      .single<UserCompanyNotebookRow>();

    if (notebookError || !notebook) {
      throw new Error(notebookError?.message || "Notebook upsert returned no row.");
    }

    let savedQuestionCount = 0;
    try {
      const extractedQuestions = await generateResearchNotebookOpenQuestions({
        ticker: context.ticker,
        companyName: context.companyName,
        basisPeriod: context.existing.basis_period ?? context.latestPeriod,
        existingNotebookMd: contentMd,
        recentConversations: context.recentConversations,
        onUsage: usage.add,
      });
      savedQuestionCount = await saveExtractedNotebookQuestions({
        userId: context.userId,
        ticker: context.ticker,
        questions: extractedQuestions,
        sourceConversation: latestSource,
      });
    } catch (err) {
      console.warn("[watchlist-notebook-refresh] question extraction failed", {
        ticker: context.ticker,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await touchMark(context.userId, context.ticker);
    await admin
      .from("user_company_notebook_refresh_jobs")
      .update({
        status: "succeeded",
        notebook_id: notebook.id,
        saved_question_count: savedQuestionCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", context.userId)
      .eq("ticker", context.ticker);

    await settleNotebookRefreshCredits(context, usage.snapshot(), "completed", {
      saved_question_count: savedQuestionCount,
      recent_conversation_count: context.recentConversations.length,
    });
  } catch (err) {
    console.warn("[watchlist-notebook-refresh] job failed", {
      ticker: context.ticker,
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });

    await admin
      .from("user_company_notebook_refresh_jobs")
      .update({
        status: "failed",
        error_code: "notebook_refresh_failed",
        error_message: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", context.userId)
      .eq("ticker", context.ticker);

    await settleNotebookRefreshCredits(context, usage.snapshot(), "failed", {
      error_message: err instanceof Error ? err.message : String(err),
      recent_conversation_count: context.recentConversations.length,
    });
  }
}

function createNotebookUsageAccumulator() {
  const total: NotebookAgentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
  };

  return {
    add: (usage: NotebookAgentUsage) => {
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.cacheHitInputTokens += usage.cacheHitInputTokens;
      total.cacheMissInputTokens += usage.cacheMissInputTokens;
    },
    snapshot: () => ({ ...total }),
  };
}

async function settleNotebookRefreshCredits(
  context: NotebookRefreshJobContext,
  usage: NotebookAgentUsage,
  terminalStatus: string,
  metadata: Record<string, unknown>,
) {
  const estimatedCost = estimateCost(usage.inputTokens, usage.outputTokens);
  const budgetMetadata = {
    executor_type: "notebook_refresh",
    ticker: context.ticker,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    prompt_cache_hit_tokens: usage.cacheHitInputTokens,
    prompt_cache_miss_tokens: usage.cacheMissInputTokens,
    ...metadata,
  };

  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    await settleExecutionBudget(
      context.userId,
      context.creditRequestId,
      null,
      estimatedCost,
      terminalStatus,
      budgetMetadata,
    );
    return;
  }

  await releaseExecutionBudget(
    context.userId,
    context.creditRequestId,
    null,
    `notebook_refresh_${terminalStatus}`,
  );
}

async function getRefreshJob(
  userId: string,
  ticker: string,
  jobId: string,
): Promise<UserCompanyNotebookRefreshJobRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_company_notebook_refresh_jobs")
    .select(REFRESH_JOB_SELECT)
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .maybeSingle<UserCompanyNotebookRefreshJobRow>();

  if (error) {
    throw new Error(`Failed to load notebook refresh job: ${error.message}`);
  }

  return data ?? null;
}

async function getActiveRefreshJob(
  userId: string,
  ticker: string,
): Promise<UserCompanyNotebookRefreshJobRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_company_notebook_refresh_jobs")
    .select(REFRESH_JOB_SELECT)
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .in("status", [...ACTIVE_REFRESH_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<UserCompanyNotebookRefreshJobRow[]>();

  if (error) {
    throw new Error(`Failed to load active notebook refresh job: ${error.message}`);
  }

  return data?.[0] ?? null;
}

async function expireStaleRefreshJob(
  job: UserCompanyNotebookRefreshJobRow,
): Promise<UserCompanyNotebookRefreshJobRow> {
  if (!ACTIVE_REFRESH_STATUSES.includes(job.status as (typeof ACTIVE_REFRESH_STATUSES)[number])) {
    return job;
  }

  const updatedAt = new Date(job.updated_at).getTime();
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < STALE_REFRESH_JOB_MS) {
    return job;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_notebook_refresh_jobs")
    .update({
      status: "failed",
      error_code: "stale_refresh_job",
      error_message: "노트북 정리 작업이 오래 응답하지 않아 중단되었습니다.",
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select(REFRESH_JOB_SELECT)
    .single<UserCompanyNotebookRefreshJobRow>();

  if (error || !data) return job;
  return data;
}

async function touchMark(userId: string, ticker: string) {
  const now = new Date().toISOString();
  await getSupabaseAdmin()
    .from("user_company_marks")
    .upsert(
      {
        user_id: userId,
        ticker,
        is_watchlisted: true,
        last_activity_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,ticker" },
    );
}
