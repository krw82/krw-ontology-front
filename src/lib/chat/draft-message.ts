import { createClientId } from "@/lib/client-id";
import { normalizeGuruLensKey, type GuruLensKey } from "@/lib/guru-lenses";
import { normalizeRunKind, type RunKind } from "@/lib/run-kind";

const DRAFT_MESSAGE_STORAGE_PREFIX = "krw:chat-draft-message:";

export type DraftMessagePayload = {
  content: string;
  requestId: string;
  runKind?: RunKind;
  guruLensKey?: GuruLensKey;
  userUrl?: string;
  userUrls?: string[];
  attachmentIds?: string[];
};

function draftMessageStorageKey(draftMessageId: string): string {
  return `${DRAFT_MESSAGE_STORAGE_PREFIX}${draftMessageId}`;
}

export function storeDraftMessage(
  draftMessageId: string,
  payload: DraftMessagePayload,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(
      draftMessageStorageKey(draftMessageId),
      JSON.stringify(payload),
    );
    return true;
  } catch {
    return false;
  }
}

export function readDraftMessage(
  draftMessageId: string,
): DraftMessagePayload | null {
  if (typeof window === "undefined") return null;
  const key = draftMessageStorageKey(draftMessageId);
  const rawPayload = window.sessionStorage.getItem(key);
  if (!rawPayload) return null;

  try {
    const payload = JSON.parse(rawPayload) as Partial<DraftMessagePayload>;
    const content = payload.content?.trim();
    const requestId = payload.requestId?.trim();
    const rawRunKind =
      typeof payload.runKind === "string" ? payload.runKind : undefined;
    const runKind = rawRunKind ? normalizeRunKind(rawRunKind) : undefined;
    const guruLensKey = normalizeGuruLensKey(payload.guruLensKey);
    const userUrls = Array.isArray(payload.userUrls)
      ? payload.userUrls
          .map((url) => (typeof url === "string" ? url.trim() : ""))
          .filter(Boolean)
      : [];
    const userUrl = payload.userUrl?.trim() || userUrls[0];
    const attachmentIds = Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds
          .map((id) => (typeof id === "string" ? id.trim() : ""))
          .filter(Boolean)
      : [];
    if (!content || !requestId) return null;
    return {
      content,
      requestId,
      ...(runKind ? { runKind } : {}),
      ...(guruLensKey ? { guruLensKey } : {}),
      ...(userUrl ? { userUrl } : {}),
      ...(userUrls.length > 0 ? { userUrls } : {}),
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    };
  } catch {
    const content = rawPayload.trim();
    return content ? { content, requestId: createClientId() } : null;
  }
}

export function removeDraftMessage(draftMessageId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(draftMessageStorageKey(draftMessageId));
}
