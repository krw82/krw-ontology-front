"use client";

import { useEffect, useState } from "react";

import { normalizeTicker } from "@/lib/ontology/ticker";
import type {
  UserCompanyCoverageStatus,
  UserCompanyNotebook,
  UserCompanyMark,
} from "@/types/api-contracts";

type CoverageStatus = UserCompanyCoverageStatus;

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
  const [pending, setPending] = useState(false);

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

  async function saveCoverageStatus(coverageStatus: CoverageStatus) {
    if (!normalizedTicker || pending) return;

    setPending(true);
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(normalizedTicker)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coverage_status: coverageStatus }),
        },
      );
      if (!response.ok) throw new Error("Failed to save watchlist mark");
      const payload = (await response.json()) as { mark?: UserCompanyMark };
      if (payload.mark) setMark(payload.mark);
    } finally {
      setPending(false);
    }
  }

  const notebookHasBeenUsed =
    notebookUsage?.ticker === normalizedTicker ? notebookUsage.hasBeenUsed : null;
  const shouldShowNotebookHint =
    showNotebookOnboarding &&
    (forceShowNotebookOnboarding || notebookHasBeenUsed === false);
  const currentCoverageStatus = coverageStatusOf(mark);
  const hasSavedMark = Boolean(
    currentCoverageStatus && currentCoverageStatus !== "closed",
  );

  return (
    <div
      className="relative flex items-center gap-1"
      data-onboarding-target="chat-notebook-actions"
    >
      <label className="relative inline-flex min-h-11 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-2 text-[12px] font-extrabold text-ink transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:px-3 sm:text-[13px]">
        <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-primary">radar</span>
        <select
          value={currentCoverageStatus ?? ""}
          disabled={pending}
          onChange={(event) => {
            const nextStatus = event.target.value as CoverageStatus;
            if (nextStatus) void saveCoverageStatus(nextStatus);
          }}
          className="min-h-11 appearance-none bg-transparent pr-5 font-extrabold outline-none disabled:cursor-wait"
          aria-label="이 회사의 커버리지 상태"
        >
          <option value="" disabled>{pending ? "저장 중" : "커버리지"}</option>
          <option value="exploring">탐색 중</option>
          <option value="watching">관찰 중</option>
          <option value="holding">보유 중</option>
          <option value="closed">종료</option>
        </select>
        <span aria-hidden="true" className="pointer-events-none absolute right-1 material-symbols-outlined text-[16px] text-muted">expand_more</span>
      </label>
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
              ? "이 리서치를 커버리지에 남기세요"
              : "저장하고 커버리지에서 이어가세요"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function coverageStatusOf(mark: UserCompanyMark | null): CoverageStatus | null {
  return mark?.coverage_status ?? null;
}
