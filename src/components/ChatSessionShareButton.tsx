"use client";

import { useCallback, useEffect, useState } from "react";

type ShareState =
  | "idle"
  | "sharing"
  | "shared"
  | "failed"
  | "auth_required";

class SessionShareCreationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SessionShareCreationError";
  }
}

// Inlined clipboard helper (mirrors src/components/ChatMessage.tsx).
// copyTextToClipboard is not exported from ChatMessage and @/lib/clipboard
// does not exist, so we replicate the same navigator.clipboard + fallback
// logic here to avoid touching existing files.
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";

    document.body.appendChild(textArea);
    textArea.select();
    textArea.setSelectionRange(0, text.length);

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }
}

async function createSessionShareUrl(sessionId: string): Promise<string> {
  const response = await fetch(
    `/api/share/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );

  if (!response.ok) {
    throw new SessionShareCreationError(
      response.status,
      `Session share failed: ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    share_url?: string;
    url?: string;
  };
  return data.share_url ?? data.url ?? "";
}

export default function ChatSessionShareButton({
  sessionId,
}: {
  sessionId: string;
}) {
  const [shareState, setShareState] = useState<ShareState>("idle");

  useEffect(() => {
    if (
      shareState !== "shared" &&
      shareState !== "failed" &&
      shareState !== "auth_required"
    ) {
      return;
    }
    const timeoutId = window.setTimeout(() => setShareState("idle"), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [shareState]);

  const handleShare = useCallback(async () => {
    if (shareState === "sharing") return;

    setShareState("sharing");
    let shareUrl = "";

    try {
      shareUrl = await createSessionShareUrl(sessionId);
      const shareData: ShareData = { title: "KRW.O", url: shareUrl };
      const useNativeShare =
        Boolean(navigator.share) &&
        (!navigator.canShare || navigator.canShare(shareData));

      if (useNativeShare) {
        await navigator.share(shareData);
        setShareState("shared");
      } else {
        const copied = await copyTextToClipboard(shareUrl);
        setShareState(copied ? "shared" : "failed");
      }
    } catch (error) {
      if ((error as DOMException).name === "AbortError") {
        setShareState("idle");
        return;
      }
      if (
        error instanceof SessionShareCreationError &&
        error.status === 401
      ) {
        setShareState("auth_required");
        return;
      }
      const copied = shareUrl
        ? await copyTextToClipboard(shareUrl)
        : false;
      setShareState(copied ? "shared" : "failed");
    }
  }, [sessionId, shareState]);

  const iconName =
    shareState === "shared"
      ? "check"
      : shareState === "failed"
        ? "error"
        : shareState === "auth_required"
          ? "lock"
          : shareState === "sharing"
            ? "progress_activity"
            : "forum";
  const ariaLabel =
    shareState === "shared"
      ? "대화 공유 완료"
      : shareState === "failed"
        ? "대화 공유 실패"
        : shareState === "auth_required"
          ? "로그인이 필요합니다"
          : shareState === "sharing"
            ? "대화 공유 링크 생성 중"
            : "이 대화 공유";

  return (
    <button
      type="button"
      className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
      aria-label={ariaLabel}
      disabled={shareState === "sharing"}
      onClick={handleShare}
    >
      <span
        aria-hidden="true"
        className={[
          "material-symbols-outlined text-[20px]",
          shareState === "sharing" ? "animate-spin" : "",
        ].join(" ")}
      >
        {iconName}
      </span>
    </button>
  );
}
