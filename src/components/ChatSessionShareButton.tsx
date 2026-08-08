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
  const [copiedUrl, setCopiedUrl] = useState<string>("");

  useEffect(() => {
    if (
      shareState !== "shared" &&
      shareState !== "failed" &&
      shareState !== "auth_required"
    ) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setShareState("idle");
      setCopiedUrl("");
    }, 1800);
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
        if (copied) {
          setCopiedUrl(shareUrl);
          setShareState("shared");
        } else {
          setShareState("failed");
        }
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
      if (copied) {
        setCopiedUrl(shareUrl);
        setShareState("shared");
      } else {
        setShareState("failed");
      }
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
  const label =
    shareState === "shared"
      ? "복사됨"
      : shareState === "failed"
        ? "실패"
        : shareState === "auth_required"
          ? "로그인"
          : shareState === "sharing"
            ? "생성 중"
            : "공유";

  return (
    <div className="relative">
      <button
        type="button"
        className={[
          "inline-flex h-9 items-center justify-center gap-1 rounded-[8px] border px-2 text-[12px] font-extrabold leading-4 transition-colors disabled:cursor-not-allowed disabled:opacity-55 sm:h-10 sm:px-3 sm:text-[13px]",
          shareState === "shared"
            ? "border-primary bg-primary-fixed text-on-primary-fixed"
            : "border-hairline bg-canvas text-ink hover:border-primary hover:text-primary",
        ].join(" ")}
        aria-label={ariaLabel}
        disabled={shareState === "sharing"}
        onClick={handleShare}
      >
        <span
          aria-hidden="true"
          className={[
            "material-symbols-outlined text-[17px]",
            shareState === "sharing" ? "animate-spin" : "",
          ].join(" ")}
        >
          {iconName}
        </span>
        <span>{label}</span>
      </button>
      {shareState === "shared" && copiedUrl ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-max max-w-[320px] items-center gap-2 rounded-[8px] border border-hairline bg-surface px-3 py-2 shadow-lg">
          <span className="min-w-0 truncate text-[12px] font-medium text-muted">
            {copiedUrl}
          </span>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center rounded-[6px] border border-hairline px-2 text-[11px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary"
            onClick={() => void copyTextToClipboard(copiedUrl)}
          >
            복사
          </button>
        </div>
      ) : null}
    </div>
  );
}
