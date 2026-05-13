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
import {
  buildResearchArtifacts,
  deriveVisibleAnswer,
} from "@/lib/artifacts/build-research-artifact";
import { toResearchArtifact } from "@/lib/artifacts/db";
import {
  parseResearchAgentOutput,
  parseResearchAgentOutputText,
} from "@/lib/artifacts/schema";
import {
  compileDisplayPlanAnswer,
  parseDisplayPlanOutput,
  parseDisplayPlanOutputText,
  parseResearchSynthesisOutput,
  parseResearchSynthesisOutputText,
} from "@/lib/artifacts/display-plan";
import type { Json, ResearchArtifactRow } from "@/types/database";
import type {
  DisplayPlanOutput,
  ResearchAgentOutput,
  ResearchArtifact,
  ResearchSynthesis,
} from "@/types/api-contracts";
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
  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      const writer: StreamWriter = {
        write: async (chunk: Uint8Array) => {
          if (!clientConnected) return;
          try {
            controller.enqueue(chunk);
          } catch {
            clientConnected = false;
          }
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

        await sendEvent("error", {
          run_id: "",
          error_code: toErrorCode(leaseResult.reason ?? "internal_error"),
          error_message:
            leaseResult.reason === "active_run_exists"
              ? "Session already has an active run"
              : leaseResult.reason === "concurrency_limit"
                ? "Global concurrent run limit reached"
                : "Could not acquire run lease",
        });
        controller.close();
        return;
      }

      const runId = leaseResult.runId;
      const runStartedAt = new Date().toISOString();

      streamAbortController = registerRun(runId);

      const { data: assistantMsg, error: assistantMsgError } = await admin
        .from("messages")
        .insert({
          session_id: session.id,
          role: "assistant",
          content: "",
          status: "streaming",
        })
        .select("id")
        .single();

      if (assistantMsgError || !assistantMsg) {
        await admin
          .from("agent_runs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_code: "internal_error",
            error_message: "응답 메시지를 만들지 못했습니다.",
          })
          .eq("id", runId);
        await sendEvent("error", {
          run_id: runId,
          error_code: "internal_error",
          error_message: "응답 메시지를 만들지 못했습니다.",
        });
        await releaseLease(runId);
        cleanupRun(runId);
        controller.close();
        return;
      }

      const assistantMessageId = assistantMsg.id as string;

      // Update agent_run with release metadata
      await admin
        .from("agent_runs")
        .update({
          assistant_message_id: assistantMessageId,
          ontology_release_id: mcpHealth.releaseId,
          index_generated_at: mcpHealth.indexGeneratedAt,
          company_count: mcpHealth.companyCount,
          document_count: mcpHealth.documentCount,
        })
        .eq("id", runId);

      try {
        await sendEvent("run_started", {
          run_id: runId,
          message_id: assistantMessageId,
          session_id: session.id,
        });
        await sendEvent("activity_update", {
          stage: "preparing",
          label: "분석 준비 중",
        });
        const recordSdkDiagnostics = createDevSdkDiagnosticsRecorder(admin, runId);
        const persistPartialText = createPartialMessagePersister(
          admin,
          assistantMessageId,
        );
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
            onTextDelta: persistPartialText,
          },
          writer
        );

        await persistPartialText.flush();

        const finishedAt = new Date().toISOString();

        if (result.status === "completed") {
          await handleCompletedRun({
            admin,
            runId,
            assistantMessageId,
            finishedAt,
            runStartedAt,
            result,
            mcpHealth,
            quota,
            session,
            userId: session.userId,
            sendEvent,
          });
        } else if (result.status === "cancelled") {
          await handleCancelledRun({
            admin,
            runId,
            assistantMessageId,
            finishedAt,
            result,
            sendEvent,
          });
        } else {
          await handleFailedRun({
            admin,
            runId,
            assistantMessageId,
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
        await admin
          .from("messages")
          .update({
            status: "failed",
            content: errorMessage,
          })
          .eq("id", assistantMessageId);

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
      clientConnected = false;
      // The agent keeps running after a transport disconnect so refresh/reconnect
      // can recover from persisted partial content. Explicit cancel uses the
      // cancel route, which aborts the registered run controller.
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

function createPartialMessagePersister(
  admin: ReturnType<typeof getSupabaseAdmin>,
  messageId: string,
) {
  const MIN_INTERVAL_MS = 750;
  let latestText = "";
  let lastPersistedText = "";
  let lastPersistAt = 0;
  let pending: Promise<void> = Promise.resolve();

  const persist = async (force = false) => {
    if (!force && Date.now() - lastPersistAt < MIN_INTERVAL_MS) return;
    if (latestText === lastPersistedText) return;

    const textToPersist = latestText;
    lastPersistedText = textToPersist;
    lastPersistAt = Date.now();

    pending = pending.then(async () => {
      await admin
        .from("messages")
        .update({
          content: textToPersist,
          status: "streaming",
        })
        .eq("id", messageId);
    });

    await pending;
  };

  const callback = async (_delta: string, fullText: string) => {
    latestText = fullText;
    await persist(false);
  };

  callback.flush = async () => {
    await persist(true);
    await pending;
  };

  return callback;
}

interface CompletedRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  assistantMessageId: string;
  finishedAt: string;
  runStartedAt: string;
  result: { acc: AccumulatedRun };
  mcpHealth: McpHealthResult;
  quota: QuotaCheckResult;
  session: ResolvedSession;
  userId: string;
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleCompletedRun(params: CompletedRunParams) {
  const { admin, runId, assistantMessageId, finishedAt, runStartedAt, result, mcpHealth, quota, session, userId, sendEvent } = params;
  const { acc } = result;
  const researchSynthesis =
    parseResearchSynthesisOutput(acc.researchSynthesisOutput) ??
    parseResearchSynthesisOutputText(acc.researchSynthesisText ?? "");
  const displayPlan =
    parseDisplayPlanOutput(acc.displayPlanOutput ?? acc.structuredOutput) ??
    parseDisplayPlanOutputText(acc.fullText);
  const structuredOutput =
    compileDisplayPlanAnswer(researchSynthesis, displayPlan) ??
    parseResearchAgentOutput(acc.structuredOutput) ??
    parseResearchAgentOutputText(acc.fullText);

  // Save tool calls
  if (acc.toolCalls.length > 0) {
    await admin.from("tool_calls").insert(
        acc.toolCalls.map((tc) => ({
          run_id: runId,
          tool_use_id: tc.id,
          tool_name: tc.toolName,
          arguments_json: parseJsonStringForDb(tc.argumentsJson),
          result_summary: tc.resultSummary,
          result_json: jsonForDb(tc.resultJson),
          result_text: tc.resultText,
          started_at: tc.startedAt,
          finished_at: tc.finishedAt,
          error_message: tc.errorMessage,
        }))
      );
  }

  // Save citations
  if (acc.citations.length > 0) {
    await admin.from("citations").insert(
      acc.citations.map((c) => ({
        message_id: assistantMessageId,
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
        trace_json: jsonForDb(c.trace_json),
      }))
    );
  }

  const artifacts = await persistResearchArtifacts({
    admin,
    session,
    runId,
    assistantMessageId,
    acc,
    structuredAnswer: structuredOutput,
    researchSynthesis,
    displayPlan,
    fallbackWhenMissing: !structuredOutput,
  });

  const visibleAnswer = deriveVisibleAnswer(
    acc.fullText,
    artifacts[0]?.title,
    structuredOutput ? answerBlocksToMarkdown(structuredOutput.answer_blocks) : null,
    artifacts[0]?.summary,
  );

  await admin
    .from("messages")
    .update({
      content: visibleAnswer,
      status: "completed",
    })
    .eq("id", assistantMessageId);

  // Update agent_run
  const estimatedCost = estimateCost(acc.inputTokens, acc.outputTokens);
  const latencyMs = Date.now() - new Date(runStartedAt).getTime();

  await admin
    .from("agent_runs")
    .update({
      status: "completed",
      assistant_message_id: assistantMessageId,
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
    message_id: assistantMessageId,
    content: visibleAnswer,
    rich_answers: artifacts,
    artifacts,
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

async function persistResearchArtifacts(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  session: ResolvedSession;
  runId: string;
  assistantMessageId: string;
  acc: AccumulatedRun;
  structuredAnswer?: ResearchAgentOutput | null;
  researchSynthesis?: ResearchSynthesis | null;
  displayPlan?: DisplayPlanOutput | null;
  fallbackWhenMissing: boolean;
}): Promise<ResearchArtifact[]> {
  const {
    admin,
    session,
    runId,
    assistantMessageId,
    acc,
    structuredAnswer,
    researchSynthesis,
    displayPlan,
    fallbackWhenMissing,
  } = params;
  const drafts = buildResearchArtifacts({
    sessionId: session.id,
    runId,
    messageId: assistantMessageId,
    finalText: acc.fullText,
    defaultTickers: session.defaultTickers,
    toolCalls: acc.toolCalls,
    citations: acc.citations,
    structuredAnswer,
    researchSynthesis,
    displayPlan,
    fallbackWhenMissing,
  });

  if (drafts.length === 0) return [];

  const { data, error } = await admin
    .from("research_artifacts")
    .insert(
      drafts.map((artifact) => ({
        session_id: artifact.session_id,
        run_id: artifact.run_id,
        message_id: artifact.message_id,
        artifact_version: artifact.artifact_version,
        artifact_type: artifact.artifact_type,
        title: artifact.title,
        summary: artifact.summary,
        tickers: artifact.tickers,
        source_scope: jsonForDb(artifact.source_scope),
        answer_alignment: jsonForDb(artifact.answer_alignment),
        artifact_json: jsonForDb(artifact.artifact_json),
        blocks_json: jsonForDb(artifact.blocks_json) ?? [],
        evidence_refs: jsonForDb(artifact.evidence_refs),
        quality_json: jsonForDb(artifact.quality_json),
        source_json: jsonForDb(artifact.source_json),
        html_snapshot: artifact.html_snapshot,
      })),
    )
    .select("*")
    .returns<ResearchArtifactRow[]>();

  if (error || !data) {
    console.warn("[research-artifacts] failed to persist", {
      runId,
      error: error?.message,
    });
    return [];
  }

  return data.map(toResearchArtifact);
}

function answerBlocksToMarkdown(blocks: ResearchAgentOutput["answer_blocks"]): string {
  return blocks
    .filter(
      (
        block,
      ): block is Extract<ResearchAgentOutput["answer_blocks"][number], { type: "markdown" }> =>
        block.type === "markdown",
    )
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

function jsonForDb(value: unknown): Json | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}

function parseJsonStringForDb(value: string): Json {
  try {
    return jsonForDb(JSON.parse(value)) ?? {};
  } catch {
    return value;
  }
}

interface CancelledRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  assistantMessageId: string;
  finishedAt: string;
  result: { acc: AccumulatedRun };
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleCancelledRun(params: CancelledRunParams) {
  const { admin, runId, assistantMessageId, finishedAt, result, sendEvent } = params;

  await admin
    .from("messages")
    .update({
      content: result.acc.fullText || "",
      status: "failed",
    })
    .eq("id", assistantMessageId);

  await admin
    .from("agent_runs")
    .update({
      status: "cancelled",
      assistant_message_id: assistantMessageId,
      finished_at: finishedAt,
      error_code: "cancelled",
    })
    .eq("id", runId);

  await sendEvent("cancelled", {
    run_id: runId,
    message_id: assistantMessageId,
  });
}

interface FailedRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  assistantMessageId: string;
  finishedAt: string;
  result: { acc: AccumulatedRun; errorCode?: string; errorMessage?: string };
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleFailedRun(params: FailedRunParams) {
  const { admin, runId, assistantMessageId, finishedAt, result, sendEvent } = params;
  const errorMessage = result.errorMessage || "실행에 실패했습니다.";

  await admin
    .from("agent_runs")
    .update({
      status: "failed",
      finished_at: finishedAt,
      error_code: result.errorCode || "claude_api_error",
      error_message: errorMessage,
    })
    .eq("id", runId);

  await admin
    .from("messages")
    .update({
      content: errorMessage,
      status: "failed",
    })
    .eq("id", assistantMessageId);

  await sendEvent("error", {
    run_id: runId,
    error_code: result.errorCode || "claude_api_error",
    error_message: errorMessage,
  });
}
