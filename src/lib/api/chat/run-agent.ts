import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { tryAcquireLease, releaseLease } from "@/lib/concurrency/lease";
import { recordUsage, getQuotaStatus, estimateCost } from "@/lib/concurrency/quota";
import { registerRun, cleanupRun } from "@/lib/agent/abort-manager";
import { runAgent } from "@/lib/agent/runner";
import type { SdkDiagnostics } from "@/lib/agent/runner";
import type { AccumulatedRun, StreamWriter } from "@/lib/agent/stream-handler";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import type { QuotaCheckResult } from "@/lib/concurrency/quota";
import type { ResolvedSession } from "./resolve-session";
import type { HistoryResult } from "./fetch-history";
import { toErrorCode } from "@/types/api-contracts";

export interface RunAgentParams {
  request: NextRequest;
  session: ResolvedSession;
  content: string;
  requestId: string;
  history: HistoryResult;
  quota: QuotaCheckResult;
  mcpHealth: McpHealthResult;
}

/**
 * Acquires a lease, creates a ReadableStream, runs the agent,
 * persists results, and returns the stream as a Response.
 *
 * This function owns the full streaming lifecycle.
 */
export function executeRun(params: RunAgentParams): Response {
  const {
    request,
    session,
    content,
    requestId,
    history,
    quota,
    mcpHealth,
  } = params;

  const admin = getSupabaseAdmin();
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const encoder = new TextEncoder();

  let streamAbortController: AbortController | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const writer: StreamWriter = {
        write: async (chunk: Uint8Array) => {
          controller.enqueue(chunk);
        },
      };

      const sendEvent = async (event: string, data: unknown) => {
        await writer.write(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Acquire lease inside the stream so we can report errors via SSE
      const leaseResult = await tryAcquireLease(
        session.id,
        history.userMessageId,
        requestId,
        model,
        process.env.WEB_COMMIT || "dev",
        process.env.KRW_ONTOLOGY_COMMIT || "dev"
      );

      if (!leaseResult.acquired) {
        // Clean up user message since run won't proceed
        await admin.from("messages").delete().eq("id", history.userMessageId);

        // Send error as a regular JSON response by closing the stream with error
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: {
                code: toErrorCode(leaseResult.reason ?? "internal_error"),
                message:
                  leaseResult.reason === "active_run_exists"
                    ? "Session already has an active run"
                    : leaseResult.reason === "concurrency_limit"
                      ? "Global concurrent run limit reached"
                      : "Could not acquire run lease",
              },
              request_id: requestId,
            })
          )
        );
        controller.close();
        return;
      }

      const runId = leaseResult.runId!;
      const runStartedAt = new Date().toISOString();

      streamAbortController = registerRun(runId);

      // Link request abort to our controller
      request.signal.addEventListener("abort", () => {
        streamAbortController?.abort();
      });

      // Update agent_run with release metadata
      await admin
        .from("agent_runs")
        .update({
          ontology_release_id: mcpHealth.releaseId,
          index_generated_at: mcpHealth.indexGeneratedAt,
          company_count: mcpHealth.companyCount,
          document_count: mcpHealth.documentCount,
        })
        .eq("id", runId);

      try {
        const recordSdkDiagnostics = createDevSdkDiagnosticsRecorder(admin, runId);
        const result = await runAgent(
          {
            sessionId: session.id,
            userMessage: content,
            scopeType: session.scopeType,
            defaultTickers: session.defaultTickers,
            defaultDocumentTypes: session.defaultDocumentTypes,
            history: history.history,
            abortSignal: streamAbortController!.signal,
            onSdkDiagnostics: recordSdkDiagnostics,
          },
          writer
        );

        const finishedAt = new Date().toISOString();

        if (result.status === "completed") {
          await handleCompletedRun({
            admin,
            runId,
            sessionId: session.id,
            finishedAt,
            runStartedAt,
            result,
            mcpHealth,
            quota,
            userId: session.userId,
            sendEvent,
          });
        } else if (result.status === "cancelled") {
          await handleCancelledRun({
            admin,
            runId,
            sessionId: session.id,
            finishedAt,
            result,
            sendEvent,
          });
        } else {
          await handleFailedRun({
            admin,
            runId,
            finishedAt,
            result,
            sendEvent,
          });
        }
      } catch (err) {
        const finishedAt = new Date().toISOString();
        const errorMessage =
          err instanceof Error ? err.message : "Internal error";

        await admin
          .from("agent_runs")
          .update({
            status: "failed",
            finished_at: finishedAt,
            error_code: "internal_error",
            error_message: errorMessage,
          })
          .eq("id", runId);

        try {
          await sendEvent("error", {
            run_id: runId,
            error_code: "internal_error",
            error_message: errorMessage,
          });
        } catch {
          // Stream may already be closed
        }
      } finally {
        await releaseLease(runId);
        cleanupRun(runId);
        try {
          controller.close();
        } catch {
          // Controller may already be closed on cancel
        }
      }
    },
    cancel() {
      streamAbortController?.abort();
      // Cleanup (releaseLease + unregisterRun) is handled by the finally block
      // in the start() callback, which runs when the abort signal fires.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// --- Helper functions for each terminal state ---

function isDevSdkDiagnosticsEnabled(): boolean {
  return (
    process.env.CLAUDE_SDK_DIAGNOSTICS === "1" ||
    process.env.NODE_ENV === "development" ||
    process.env.WEB_COMMIT === "dev"
  );
}

function createDevSdkDiagnosticsRecorder(
  admin: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
): ((diagnostics: SdkDiagnostics) => Promise<void>) | undefined {
  if (!isDevSdkDiagnosticsEnabled()) return undefined;

  let mergedDiagnostics: Record<string, unknown> = {};

  return async (diagnostics: SdkDiagnostics) => {
    mergedDiagnostics = {
      ...mergedDiagnostics,
      ...diagnostics,
      observedModels:
        diagnostics.observedModels ??
        (mergedDiagnostics.observedModels as string[] | undefined),
      updatedAt: new Date().toISOString(),
    };

    console.info("[claude-sdk-diagnostics]", {
      runId,
      ...mergedDiagnostics,
    });

    const { error } = await admin
      .from("agent_runs")
      .update({ sdk_diagnostics: mergedDiagnostics })
      .eq("id", runId);

    if (error) {
      console.warn("[claude-sdk-diagnostics] failed to persist", {
        runId,
        error: error.message,
      });
    }
  };
}

interface CompletedRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  sessionId: string;
  finishedAt: string;
  runStartedAt: string;
  result: { acc: AccumulatedRun };
  mcpHealth: McpHealthResult;
  quota: QuotaCheckResult;
  userId: string;
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleCompletedRun(params: CompletedRunParams) {
  const { admin, runId, sessionId, finishedAt, runStartedAt, result, mcpHealth, quota, userId, sendEvent } = params;
  const { acc } = result;

  // Save assistant message
  const { data: assistantMsg } = await admin
    .from("messages")
    .insert({
      session_id: sessionId,
      role: "assistant",
      content: acc.fullText,
      status: "completed",
    })
    .select("id")
    .single();

  // Save tool calls
  if (acc.toolCalls.length > 0 && assistantMsg) {
    await admin.from("tool_calls").insert(
      acc.toolCalls.map((tc) => ({
        run_id: runId,
        tool_name: tc.toolName,
        arguments_json: tc.argumentsJson,
        result_summary: tc.resultSummary,
        started_at: tc.startedAt,
        finished_at: tc.finishedAt,
        error_message: tc.errorMessage,
      }))
    );

    // Save citations
    if (acc.citations.length > 0) {
      await admin.from("citations").insert(
        acc.citations.map((c) => ({
          message_id: assistantMsg.id,
          run_id: runId,
          object_id: c.object_id,
          ticker: c.ticker,
          document_type: c.document_type,
          period: c.period,
          section: c.section,
          quote_text: c.quote_text,
          claim_text: c.claim_text,
          evidence_grade: c.evidence_grade,
          source_quality: c.source_quality,
        }))
      );
    }
  }

  // Update agent_run
  const estimatedCost = estimateCost(acc.inputTokens, acc.outputTokens);
  const latencyMs = Date.now() - new Date(runStartedAt).getTime();

  await admin
    .from("agent_runs")
    .update({
      status: "completed",
      assistant_message_id: assistantMsg?.id ?? null,
      finished_at: finishedAt,
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      estimated_cost_usd: estimatedCost,
      latency_ms: latencyMs,
    })
    .eq("id", runId);

  // Record daily usage
  await recordUsage(userId, estimatedCost);

  // Send done event
  await sendEvent("done", {
    run_id: runId,
    message_id: assistantMsg?.id ?? "",
    release: {
      ontology_release_id: mcpHealth.releaseId ?? "",
      index_generated_at: mcpHealth.indexGeneratedAt ?? "",
      company_count: mcpHealth.companyCount ?? 0,
      document_count: mcpHealth.documentCount ?? 0,
      krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "dev",
      web_commit: process.env.WEB_COMMIT || "dev",
    },
    usage: {
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      estimated_cost_usd: estimatedCost,
      latency_ms: latencyMs,
    },
    quota: getQuotaStatus(quota.questionsUsed, quota.costUsed, estimatedCost),
  });
}

interface CancelledRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  sessionId: string;
  finishedAt: string;
  result: { acc: AccumulatedRun };
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleCancelledRun(params: CancelledRunParams) {
  const { admin, runId, sessionId, finishedAt, result, sendEvent } = params;

  const { data: partialMsg } = await admin
    .from("messages")
    .insert({
      session_id: sessionId,
      role: "assistant",
      content: result.acc.fullText || "",
      status: "pending",
    })
    .select("id")
    .single();

  await admin
    .from("agent_runs")
    .update({
      status: "cancelled",
      assistant_message_id: partialMsg?.id ?? null,
      finished_at: finishedAt,
      error_code: "cancelled",
    })
    .eq("id", runId);

  await sendEvent("cancelled", {
    run_id: runId,
    message_id: partialMsg?.id ?? null,
  });
}

interface FailedRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  finishedAt: string;
  result: { acc: AccumulatedRun; errorCode?: string; errorMessage?: string };
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleFailedRun(params: FailedRunParams) {
  const { admin, runId, finishedAt, result, sendEvent } = params;

  await admin
    .from("agent_runs")
    .update({
      status: "failed",
      finished_at: finishedAt,
      error_code: result.errorCode || "claude_api_error",
      error_message: result.errorMessage || "Run failed",
    })
    .eq("id", runId);

  await sendEvent("error", {
    run_id: runId,
    error_code: result.errorCode || "claude_api_error",
    error_message: result.errorMessage || "Run failed",
  });
}
