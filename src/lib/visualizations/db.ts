import "server-only";

import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatMessagePresentation,
  ChatMessageVisualization,
  KrwVisualizationArtifact,
  PresentationBlock,
} from "./contracts";
import { isKrwVisualizationArtifact } from "./contracts";
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

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
