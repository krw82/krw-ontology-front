"use client";

import { useEffect, useState } from "react";

import { normalizeTicker } from "@/lib/ontology/ticker";
import type {
  UserCompanyCoverageLevel,
  UserCompanyNotebook,
  UserCompanyMark,
} from "@/types/api-contracts";

type CoverageLevel = UserCompanyCoverageLevel;

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

  async function saveCoverageLevel(coverageLevel: CoverageLevel | null) {
    if (!normalizedTicker || pending) return;

    setPending(true);
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(normalizedTicker)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coverage_level: coverageLevel }),
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
  const currentCoverageLevel = coverageLevelOf(mark);
  const hasSavedMark = Boolean(
    currentCoverageLevel,
  );

  return (
    <div
      className="relative flex items-center gap-1"
      data-onboarding-target="chat-notebook-actions"
    >
      <div className="inline-flex items-center rounded-[8px] border border-hairline bg-canvas p-1" role="group" aria-label="이 회사의 커버리지 수준">
        <button type="button" disabled={pending} onClick={() => void saveCoverageLevel("interest")} className={`min-h-9 rounded-[6px] px-2 text-[12px] font-extrabold ${currentCoverageLevel === "interest" ? "bg-primary-fixed text-on-primary-fixed" : "text-muted hover:text-primary"}`}>관심</button>
        <button type="button" disabled={pending} onClick={() => void saveCoverageLevel("holding")} className={`min-h-9 rounded-[6px] px-2 text-[12px] font-extrabold ${currentCoverageLevel === "holding" ? "bg-primary-fixed text-on-primary-fixed" : "text-muted hover:text-primary"}`}>보유</button>
        {currentCoverageLevel !== null ? <button type="button" disabled={pending} onClick={() => void saveCoverageLevel(null)} className="min-h-9 px-2 text-[11px] font-extrabold text-muted hover:text-error">해제</button> : null}
      </div>
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

function coverageLevelOf(mark: UserCompanyMark | null): CoverageLevel | null {
  return mark?.coverage_level ?? null;
}
