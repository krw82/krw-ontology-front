import "server-only";

import type { AccumulatedRun } from "@/lib/agent/stream-handler";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatMessagePresentation,
  ChatMessageVisualization,
  KrwVisualizationArtifact,
  PresentationBlock,
  VisualizationToolResult,
} from "./contracts";
import { isKrwVisualizationArtifact } from "./contracts";
import { COMPOSE_VISUALIZATION_TOOL_NAME } from "./create-visualization-tool";
import { buildPresentationBlocks } from "./presentation";
import type {
  ChatMessagePresentationRow,
  ChatMessageVisualizationRow,
  Json,
} from "@/types/database";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
type UnknownRecord = Record<string, unknown>;

export function toPublicChatVisualization(
  row: ChatMessageVisualizationRow,
): ChatMessageVisualization {
  const artifact = isKrwVisualizationArtifact(row.payload_json)
    ? row.payload_json
    : null;
  if (!artifact) {
    throw new Error(`Invalid visualization payload for row ${row.id}`);
  }
  return {
    id: row.id,
    session_id: row.session_id,
    message_id: row.message_id,
    run_id: row.run_id,
    artifact_ref: row.artifact_ref,
    payload_json: artifact,
    created_at: row.created_at,
  };
}
export function toPublicChatPresentation(
  row: ChatMessagePresentationRow,
): ChatMessagePresentation {
  return {
    message_id: row.message_id,
    session_id: row.session_id,
    run_id: row.run_id,
    blocks: parsePresentationBlocks(row.blocks_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Persists exactly the compiler-owned artifacts returned by compose_visualization.
 * The final answer text is deliberately not inspected for markers or chart JSON.
 */
export async function persistCreatedVisualizations(params: {
  admin: SupabaseAdmin;
  acc: AccumulatedRun;
  sessionId: string;
  messageId: string;
  runId: string;
}): Promise<ChatMessageVisualization[]> {
  const artifacts = extractCreatedVisualizationArtifacts(params.acc);
  if (artifacts.length === 0) return [];

  const rows = artifacts.map((artifact) => ({
    session_id: params.sessionId,
    message_id: params.messageId,
    run_id: params.runId,
    artifact_ref: artifact.artifact_ref,
    payload_json: jsonForDb(artifact) ?? {},
  }));
  const { data, error } = await params.admin
    .from("chat_message_visualizations")
    .upsert(rows, { onConflict: "message_id,artifact_ref" })
    .select("id, session_id, message_id, run_id, artifact_ref, payload_json, created_at")
    .returns<ChatMessageVisualizationRow[]>();

  if (error || !data) {
    console.warn("[agent-worker] failed to persist visualizations", {
      runId: params.runId,
      error: error?.message,
    });
    return [];
  }

  return data.flatMap((row) => {
    try {
      return [toPublicChatVisualization(row)];
    } catch (error) {
      console.warn("[agent-worker] invalid persisted visualization payload", {
        runId: params.runId,
        rowId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });
}

/**
 * Presentation placement is deterministic and persisted separately from the
 * answer Markdown so reconnects, shared answers, and exports all agree.
 */
export async function persistMessagePresentation(params: {
  admin: SupabaseAdmin;
  sessionId: string;
  messageId: string;
  runId: string;
  content: string;
  visualizations: ChatMessageVisualization[];
}): Promise<ChatMessagePresentation | null> {
  const visualizations = params.visualizations
    .map((visualization) => visualization.payload_json)
    .filter(isKrwVisualizationArtifact);
  const blocks = buildPresentationBlocks({
    content: params.content,
    visualizations,
  });

  const { data, error } = await params.admin
    .from("chat_message_presentations")
    .upsert(
      {
        message_id: params.messageId,
        session_id: params.sessionId,
        run_id: params.runId,
        blocks_json: jsonForDb(blocks) ?? [],
      },
      { onConflict: "message_id" },
    )
    .select("message_id, session_id, run_id, blocks_json, created_at, updated_at")
    .maybeSingle<ChatMessagePresentationRow>();

  if (error || !data) {
    console.warn("[agent-worker] failed to persist message presentation", {
      runId: params.runId,
      error: error?.message,
    });
    return null;
  }
  return toPublicChatPresentation(data);
}

export function extractCreatedVisualizationArtifacts(
  acc: Pick<AccumulatedRun, "toolCalls">,
): KrwVisualizationArtifact[] {
  const artifacts: KrwVisualizationArtifact[] = [];
  const seenRefs = new Set<string>();
  const seenFingerprints = new Set<string>();

  for (const toolCall of acc.toolCalls) {
    if (toolCall.toolName !== COMPOSE_VISUALIZATION_TOOL_NAME) continue;
    for (const payload of [toolCall.resultJson, parseJson(toolCall.resultText)]) {
      const result = parseVisualizationToolResult(payload);
      if (!result?.artifact || result.status === "skipped") continue;
      if (
        seenRefs.has(result.artifact.artifact_ref) ||
        seenFingerprints.has(result.artifact.semantic_fingerprint)
      ) continue;
      seenRefs.add(result.artifact.artifact_ref);
      seenFingerprints.add(result.artifact.semantic_fingerprint);
      artifacts.push(result.artifact);
    }
  }
  return artifacts;
}

function parseVisualizationToolResult(value: unknown): VisualizationToolResult | null {
  if (!isRecord(value) || value.kind !== "compose_visualization_result") return null;
  if (
    value.status !== "created" &&
    value.status !== "partial" &&
    value.status !== "skipped"
  ) {
    return null;
  }
  const artifact = isKrwVisualizationArtifact(value.artifact)
    ? value.artifact
    : undefined;
  if (value.status !== "skipped" && !artifact) return null;
  if (artifact && value.artifact_ref !== artifact.artifact_ref) return null;
  return {
    kind: "compose_visualization_result",
    status: value.status,
    artifact_ref: artifact?.artifact_ref,
    artifact,
    reason_code: stringValue(value.reason_code),
    explanation: stringValue(value.explanation),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

function parsePresentationBlocks(value: unknown): PresentationBlock[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const blocks: PresentationBlock[] = [];
  for (const block of value) {
    if (!isRecord(block) || typeof block.id !== "string" || ids.has(block.id)) {
      continue;
    }
    if (block.type === "markdown" && typeof block.content === "string") {
      ids.add(block.id);
      blocks.push({ id: block.id, type: "markdown", content: block.content });
      continue;
    }
    if (
      block.type === "visualization" &&
      typeof block.artifact_ref === "string"
    ) {
      ids.add(block.id);
      blocks.push({
        id: block.id,
        type: "visualization",
        artifact_ref: block.artifact_ref,
      });
    }
  }
  return blocks;
}

function jsonForDb(value: unknown): Json | null {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
