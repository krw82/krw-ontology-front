"use client";

import { useState } from "react";
import { signalPwaInstallEngagement } from "@/components/pwa/lifecycle";
import { trackClientEventSilently } from "@/lib/analytics/client";

type FirstValueFilingActionsProps = {
  ticker: string;
  filingEventId: string;
  sourceHref: string;
};

export default function FirstValueFilingActions({
  ticker,
  filingEventId,
  sourceHref,
}: FirstValueFilingActionsProps) {
  const [sourceOpened, setSourceOpened] = useState(false);
  const [followState, setFollowState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const followCompany = async () => {
    if (followState === "saving" || followState === "saved") return;
    setFollowState("saving");
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(ticker)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, coverage_level: "interest" }),
      });
      if (!response.ok) throw new Error("follow_failed");
      setFollowState("saved");
      signalPwaInstallEngagement("watch_added", "filing_first_value");
      trackClientEventSilently("company_followed", {
        ticker,
        filing_event_id: filingEventId,
        surface: "filing_first_value",
        source_opened: true,
      });
    } catch {
      setFollowState("error");
    }
  };

  return (
    <section
      className="mt-lg rounded-[10px] border border-primary/25 bg-primary-fixed/45 p-lg"
      aria-label="첫 리서치 다음 단계"
    >
      <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
        첫 리서치
      </p>
      <h2 className="mt-1 text-lg font-black tracking-[-0.03em] text-ink">
        먼저 원문 근거를 확인하세요
      </h2>
      <p className="mt-2 text-sm leading-6 text-body">
        요약은 출발점입니다. 이 변화가 나온 SEC 원문을 직접 열어 문맥을 확인해보세요.
      </p>
      <a
        href={sourceHref}
        target="_blank"
        rel="noreferrer"
        onClick={() => {
          setSourceOpened(true);
          trackClientEventSilently("cta_clicked", {
            cta_id: "first_value_sec_source",
            cta_label: "SEC 원문 열기",
            surface: "filing_first_value",
            ticker,
            filing_event_id: filingEventId,
            destination: sourceHref,
          });
        }}
        className="mt-md inline-flex min-h-11 items-center rounded-[7px] bg-primary px-base text-sm font-extrabold text-on-primary transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-primary-fixed"
      >
        SEC 원문 열기
        <span className="material-symbols-outlined ml-1 text-[16px]" aria-hidden="true">
          open_in_new
        </span>
      </a>
      {sourceOpened ? (
        <div className="mt-md border-t border-primary/20 pt-md" aria-live="polite">
          <p className="text-sm font-bold leading-6 text-ink">
            다음 공시 변화도 이 회사 기준으로 볼까요?
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            관심 기업으로 저장하면 이후 피드와 리서치 맥락에 이 회사를 반영합니다.
          </p>
          <button
            type="button"
            disabled={followState === "saving" || followState === "saved"}
            onClick={() => void followCompany()}
            className="mt-3 inline-flex min-h-11 items-center rounded-[7px] border border-hairline bg-canvas px-base text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {followState === "saving"
              ? "저장 중…"
              : followState === "saved"
                ? "관심 기업으로 저장됨"
                : "이 회사를 관심 기업으로 저장"}
          </button>
          {followState === "error" ? (
            <p className="mt-2 text-xs font-bold leading-5 text-error">
              관심 기업으로 저장하지 못했습니다. 다시 시도해주세요.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
