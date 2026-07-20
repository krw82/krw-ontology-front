export const DOCUMENT_ATTACHMENT_POLL_DELAYS_MS = [2_000, 3_000, 5_000] as const;

export function getDocumentAttachmentPollDelay(attempt: number): number {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  return DOCUMENT_ATTACHMENT_POLL_DELAYS_MS[
    Math.min(normalizedAttempt, DOCUMENT_ATTACHMENT_POLL_DELAYS_MS.length - 1)
  ];
}

export function canPollDocumentAttachments(
  visibilityState: DocumentVisibilityState,
  online: boolean,
): boolean {
  return visibilityState !== "hidden" && online;
}
