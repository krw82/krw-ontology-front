"use client";

import { useEffect, useState } from "react";

import { normalizeTicker } from "@/lib/ontology/ticker";
import type { UserCompanyNotebook, UserCompanyMark } from "@/types/api-contracts";

export interface ChatWatchlistHeaderActionsProps {
  ticker: string;
  showNotebookOnboarding: boolean;
  forceShowNotebookOnboarding: boolean;
}

export default function ChatWatchlistHeaderActions({
  ticker,
  showNotebookOnboarding,
  forceShowNotebookOnboarding,
}: ChatWatchlistHeaderActionsProps) {
  const normalizedTicker = normalizeTicker(ticker);
  const [mark, setMark] = useState<UserCompanyMark | null>(null);
  const [notebookUsage, setNotebookUsage] = useState<{
    ticker: string;
    hasBeenUsed: boolean;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<"watchlist" | "holding" | null>(
    null,
  );

  useEffect(() => {
    if (!normalizedTicker) return;

    let stale = false;
    const tickerForRequest = normalizedTicker;
    async function loadMark() {
      try {
        const response = await fetch(
          `/api/watchlist/${encodeURIComponent(tickerForRequest)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          company?: { mark?: UserCompanyMark };
        };
        if (!stale) setMark(payload.company?.mark ?? null);
      } catch {
        if (!stale) setMark(null);
      }
    }

    void loadMark();
    return () => {
      stale = true;
    };
  }, [normalizedTicker]);

  useEffect(() => {
    if (
      !normalizedTicker ||
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
  }, [forceShowNotebookOnboarding, normalizedTicker, showNotebookOnboarding]);

  if (!normalizedTicker) return null;

  async function saveMark(action: "watchlist" | "holding") {
    if (!normalizedTicker || pendingAction) return;

    setPendingAction(action);
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(normalizedTicker)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "holding"
              ? { is_watchlisted: true, is_holding: true }
              : { is_watchlisted: true },
          ),
        },
      );
      if (!response.ok) throw new Error("Failed to save watchlist mark");
      const payload = (await response.json()) as { mark?: UserCompanyMark };
      if (payload.mark) setMark(payload.mark);
    } finally {
      setPendingAction(null);
    }
  }

  const notebookHasBeenUsed =
    notebookUsage?.ticker === normalizedTicker ? notebookUsage.hasBeenUsed : null;
  const shouldShowNotebookHint =
    showNotebookOnboarding &&
    (forceShowNotebookOnboarding || notebookHasBeenUsed === false);
  const hasSavedMark = Boolean(mark?.is_watchlisted || mark?.is_holding);

  return (
    <div
      className="relative flex items-center gap-1"
      data-onboarding-target="chat-notebook-actions"
    >
      <ChatHeaderMarkButton
        active={Boolean(mark?.is_watchlisted)}
        disabled={pendingAction !== null}
        icon="bookmark"
        label={pendingAction === "watchlist" ? "저장" : "관심"}
        onClick={() => void saveMark("watchlist")}
      />
      <ChatHeaderMarkButton
        active={Boolean(mark?.is_holding)}
        disabled={pendingAction !== null}
        icon="inventory_2"
        label={pendingAction === "holding" ? "저장" : "보유"}
        onClick={() => void saveMark("holding")}
      />
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
            {hasSavedMark
              ? "이 리서치를 노트북에 남기세요"
              : "저장하고 노트북에서 이어가세요"}
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
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
