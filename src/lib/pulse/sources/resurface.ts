import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type { Database } from "@/types/database";

const NOTE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const NOTEBOOK_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Returns raw candidates. Rotation happens only after per-item state filtering. */
export async function getRawResurfaceCandidates(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date,
): Promise<PulseCandidate[]> {
  const [notesResult, notebooksResult] = await Promise.all([
    supabase
      .from("user_research_notes")
      .select("id,ticker,title,body,updated_at")
      .eq("user_id", userId)
      .lte("updated_at", new Date(now.getTime() - NOTE_AGE_MS).toISOString())
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase
      .from("user_company_notebooks")
      .select("id,ticker,title,content_md,updated_at")
      .eq("user_id", userId)
      .lte("updated_at", new Date(now.getTime() - NOTEBOOK_AGE_MS).toISOString())
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);
  if (notesResult.error) throw notesResult.error;
  if (notebooksResult.error) throw notebooksResult.error;

  const notes: PulseCandidate[] = notesResult.data.map((note) => ({
    item_key: makePulseItemKey("resurface", `note:${note.id}`),
    kind: "resurface",
    trigger: "state",
    source_type: "resurface",
    source_id: `note:${note.id}`,
    ticker: note.ticker,
    eyebrow: "다시 볼 메모",
    title: note.title,
    body: excerpt(note.body),
    reason_code: "saved_note_resurface",
    reason_label: `${daysAgo(note.updated_at, now)}일 전에 저장한 ${note.ticker} 메모입니다.`,
    priority: "low",
    occurred_at: note.updated_at,
    available_at: note.updated_at,
    expires_at: null,
    read_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: `resurface:${note.ticker}`,
    primary_action: { type: "link", label: "메모 보기", href: `/watchlist/${encodeURIComponent(note.ticker)}?tab=notes` },
    secondary_actions: [
      { type: "mutation", label: "다시 저장", action: "save" },
      { type: "mutation", label: "이번에는 숨기기", action: "dismiss" },
    ],
    metadata: { resurface_type: "note" },
  }));

  const notebooks: PulseCandidate[] = notebooksResult.data
    .filter((notebook) => notebook.content_md.trim().length > 80)
    .map((notebook) => ({
      item_key: makePulseItemKey("resurface", `notebook:${notebook.id}`),
      kind: "resurface",
      trigger: "state",
      source_type: "resurface",
      source_id: `notebook:${notebook.id}`,
      ticker: notebook.ticker,
      eyebrow: "오래된 관점",
      title: `${notebook.ticker} 투자 관점을 다시 확인할 때입니다`,
      body: excerpt(notebook.content_md.replace(/^#+\s+/gm, "")),
      reason_code: "stale_notebook_resurface",
      reason_label: `${daysAgo(notebook.updated_at, now)}일 동안 업데이트되지 않은 노트북입니다.`,
      priority: "low",
      occurred_at: notebook.updated_at,
      available_at: notebook.updated_at,
      expires_at: null,
      read_at: null,
      saved_at: null,
      snoozed_until: null,
      group_key: `resurface:${notebook.ticker}`,
      primary_action: { type: "link", label: "노트북 보기", href: `/watchlist/${encodeURIComponent(notebook.ticker)}` },
      secondary_actions: [
        { type: "mutation", label: "저장", action: "save" },
        { type: "mutation", label: "7일 뒤 다시 보기", action: "snooze" },
      ],
      metadata: { resurface_type: "notebook" },
    }));

  return [...notes, ...notebooks];
}

export function selectResurfaceCandidate(
  input: PulseCandidate[],
  userId: string,
  now: Date,
  cadence: "weekly" | "biweekly" = "weekly",
): PulseCandidate[] {
  const candidates = [...input].sort((left, right) => left.item_key.localeCompare(right.item_key));
  if (candidates.length === 0) return [];
  const cadenceWeeks = cadence === "biweekly" ? 2 : 1;
  const week = Math.floor((Math.floor(now.getTime() / 86_400_000) + 3) / 7);
  if (cadence === "biweekly" && week % 2 !== 0) return [];
  return [candidates[stableIndex(`${userId}:${Math.floor(week / cadenceWeeks)}`, candidates.length)]];
}

function excerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function daysAgo(iso: string, now: Date): number {
  return Math.max(1, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000));
}

function stableIndex(seed: string, size: number): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % size;
}
