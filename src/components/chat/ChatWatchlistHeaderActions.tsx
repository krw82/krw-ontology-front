"use client";

import { useEffect, useState } from "react";

import { useCompanyFollow } from "@/lib/follow/use-company-follow";
import { normalizeTicker } from "@/lib/ontology/ticker";
import type { UserCompanyNotebook } from "@/types/api-contracts";

export interface ChatWatchlistHeaderActionsProps {
  ticker: string;
  notebookEnabled: boolean;
  showNotebookOnboarding: boolean;
  forceShowNotebookOnboarding: boolean;
}

export default function ChatWatchlistHeaderActions({
  ticker,
  notebookEnabled,
  showNotebookOnboarding,
  forceShowNotebookOnboarding,
}: ChatWatchlistHeaderActionsProps) {
  const normalizedTicker = normalizeTicker(ticker);
  const followState = useCompanyFollow(normalizedTicker, {
    surface: "chat_header",
  });
  const [notebookUsage, setNotebookUsage] = useState<{
    ticker: string;
    hasBeenUsed: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [limitNotice, setLimitNotice] = useState(false);

  useEffect(() => {
    if (
      !normalizedTicker ||
      !notebookEnabled ||
      !showNotebookOnboarding ||
      forceShowNotebookOnboarding
    ) {
      return;
    }

    let stale = false;
    const tickerForRequest = normalizedTicker;

    async function loadNotebookUsage() {
      try {
        const response = await fetch(
          `/api/watchlist/${encodeURIComponent(tickerForRequest)}/notebook`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          notebook?: UserCompanyNotebook;
        };
        if (!stale) {
          setNotebookUsage({
            ticker: tickerForRequest,
            hasBeenUsed: Boolean(payload.notebook?.updated_at),
          });
        }
      } catch {
        if (!stale) {
          setNotebookUsage({
            ticker: tickerForRequest,
            hasBeenUsed: false,
          });
        }
      }
    }

    void loadNotebookUsage();
    return () => {
      stale = true;
    };
  }, [forceShowNotebookOnboarding, normalizedTicker, notebookEnabled, showNotebookOnboarding]);

  useEffect(() => {
    if (!limitNotice) return;
    const timeoutId = window.setTimeout(() => setLimitNotice(false), 4_000);
    return () => window.clearTimeout(timeoutId);
  }, [limitNotice]);

  if (!normalizedTicker) return null;

  async function toggleFollow() {
    if (pending) return;
    setPending(true);
    try {
      const result = followState.following
        ? await followState.unfollow()
        : await followState.follow();
      if (!result.ok && "reason" in result && result.reason === "limit") {
        setLimitNotice(true);
      }
    } finally {
      setPending(false);
    }
  }

  const notebookHasBeenUsed =
    notebookUsage?.ticker === normalizedTicker ? notebookUsage.hasBeenUsed : null;
  const shouldShowNotebookHint =
    notebookEnabled &&
    showNotebookOnboarding &&
    (forceShowNotebookOnboarding || notebookHasBeenUsed === false);

  return (
    <div
      className="relative flex items-center gap-1"
      data-onboarding-target="chat-notebook-actions"
    >
      <ChatHeaderMarkButton
        active={followState.following}
        disabled={pending || followState.loading}
        icon={followState.following ? "check" : "bookmark"}
        label={pending ? "저장 중" : "관심"}
        onClick={() => void toggleFollow()}
      />
      {limitNotice ? (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-30 inline-flex max-w-[calc(100vw-32px)] items-center rounded-[8px] border border-primary/25 bg-canvas px-3 py-2 text-left shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
          role="status"
        >
          <span
            aria-hidden="true"
            className="absolute right-9 top-[-5px] h-2.5 w-2.5 rotate-45 border-l border-t border-primary/25 bg-canvas"
          />
          <p className="min-w-0 text-[12px] font-extrabold leading-5 text-ink">
            관심 기업은 무료 플랜 3개까지예요 · 무제한은 유료 플랜
          </p>
        </div>
      ) : null}
      {shouldShowNotebookHint ? (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-30 inline-flex max-w-[calc(100vw-32px)] items-center rounded-[8px] border border-primary/25 bg-canvas px-3 py-2 text-left shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
          role="status"
        >
          <span
            aria-hidden="true"
            className="absolute right-9 top-[-5px] h-2.5 w-2.5 rotate-45 border-l border-t border-primary/25 bg-canvas"
          />
          <p className="min-w-0 whitespace-nowrap text-[12px] font-extrabold leading-5 text-ink">
            {followState.following
              ? "이 리서치를 커버리지에 남기세요"
              : "저장하고 커버리지에서 이어가세요"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ChatHeaderMarkButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        "inline-flex h-9 items-center justify-center gap-1 rounded-[8px] border px-2 text-[12px] font-extrabold leading-4 transition-colors disabled:cursor-not-allowed disabled:opacity-55 sm:h-10 sm:px-3 sm:text-[13px]",
        active
          ? "border-primary bg-primary-fixed text-on-primary-fixed"
          : "border-hairline bg-canvas text-ink hover:border-primary hover:text-primary",
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
