"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatIssueRelativeTime,
  normalizeMarketIssueDetail,
  type MarketIssueCard,
} from "@/components/news/news-model";

type DetailState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; issue: MarketIssueCard };

export default function MarketIssueDetail({ issueId }: { issueId: string }) {
  const [detail, setDetail] = useState<DetailState>({ kind: "loading" });
  const [draftError, setDraftError] = useState<string | null>(null);
  const [openingDraft, setOpeningDraft] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const loadDetail = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setDetail({ kind: "loading" });

    try {
      const response = await fetch(`/api/news/issues/${encodeURIComponent(issueId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("market_issue_detail_failed");
      const payload = normalizeMarketIssueDetail(await response.json());
      if (!payload || controller.signal.aborted) throw new Error("invalid_market_issue_detail");
      setDetail({ kind: "ready", issue: payload.issue });
    } catch {
      if (controller.signal.aborted) return;
      setDetail({ kind: "error" });
    }
  }, [issueId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadDetail();
    });
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
    };
  }, [loadDetail]);

  const openResearchDraft = async (researchPathId: string | null) => {
    if (detail.kind !== "ready" || openingDraft) return;
    setOpeningDraft(true);
    setDraftError(null);
    try {
      const response = await fetch(`/api/news/issues/${encodeURIComponent(detail.issue.id)}/research-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(researchPathId ? { researchPathId } : {}),
      });
      if (!response.ok) throw new Error("research_draft_failed");
      const payload: unknown = await response.json();
      const href = readDraftHref(payload);
      if (!href) throw new Error("research_draft_href_missing");
      window.location.assign(href);
    } catch {
      setDraftError("리서치 초안을 열지 못했습니다. 잠시 후 다시 시도해주세요.");
      setOpeningDraft(false);
    }
  };

  return (
    <main id="main-content" className="mx-auto w-full max-w-4xl px-base pb-3xl pt-xl sm:px-xl sm:pt-2xl">
      {detail.kind === "loading" ? <DetailSkeleton /> : null}
      {detail.kind === "error" ? <DetailLoadError onRetry={() => void loadDetail()} /> : null}
      {detail.kind === "ready" ? (
        <IssueDetailContent
          issue={detail.issue}
          openingDraft={openingDraft}
          draftError={draftError}
          onOpenResearchDraft={(researchPathId) => void openResearchDraft(researchPathId)}
        />
      ) : null}
    </main>
  );
}

function IssueDetailContent({
  issue,
  openingDraft,
  draftError,
  onOpenResearchDraft,
}: {
  issue: MarketIssueCard;
  openingDraft: boolean;
  draftError: string | null;
  onOpenResearchDraft: (researchPathId: string | null) => void;
}) {
  return (
    <article className="mt-base">
      <header className="border-b border-hairline pb-xl sm:pb-2xl">
        <div className="flex flex-wrap items-center gap-sm">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">fact_check</span>
            검토용 이슈
          </span>
          <time className="sr-only" dateTime={issue.updatedAt ?? issue.publishedAt ?? undefined}>
            {formatIssueRelativeTime(issue.updatedAt ?? issue.publishedAt)}
          </time>
        </div>
        <h1 className="mt-base max-w-3xl text-[30px] font-black leading-[1.22] tracking-[-0.055em] text-ink sm:text-[42px]">
          {issue.title}
        </h1>
        <p className="mt-base max-w-2xl text-[14px] leading-6 text-muted">
          시장의 변화와 기업의 연결고리를 검토하기 위한 리서치 화면입니다. 회사 공시와 실적 발표를 함께 확인해주세요.
        </p>
      </header>

      <section className="mt-xl rounded-[22px] border border-[#d8e4fa] bg-[#f6f9ff] p-base sm:p-lg" aria-labelledby="korean-context-title">
        <div className="flex items-center gap-xs text-[12px] font-extrabold text-primary">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">auto_awesome</span>
          <h2 id="korean-context-title">{issue.localNewsStage === "ai_verified" ? "AI가 검증해 정리한 한국어 맥락" : "한국어 맥락"}</h2>
        </div>
        <p className="mt-sm text-[16px] leading-7 text-body">{issue.summary}</p>
        <p className="mt-sm text-[12px] leading-5 text-muted">
          {issue.localNewsStage === "ai_verified"
            ? "AI가 원문과 대조해 정리한 맥락입니다. 투자 판단 전에는 회사 공시와 실적 발표를 확인해주세요."
            : "투자 판단 전에는 회사 공시와 실적 발표를 확인해주세요."}
        </p>
      </section>

      {issue.whyShown.length > 0 ? (
        <section className="mt-lg rounded-[18px] border border-hairline bg-white p-base" aria-labelledby="why-shown-title">
          <h2 id="why-shown-title" className="flex items-center gap-xs text-[14px] font-extrabold text-ink">
            <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">account_tree</span>
            내 리서치와 연결된 이유
          </h2>
          <ul className="mt-sm grid gap-xs text-[13px] leading-6 text-body">
            {issue.whyShown.map((reason, index) => <li key={`${reason}-${index}`} className="flex gap-sm"><span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />{reason}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="mt-xl overflow-hidden rounded-[22px] bg-ink text-white" aria-labelledby="next-research-title">
        <div className="px-lg py-xl sm:px-xl">
          <p className="text-[12px] font-extrabold tracking-[0.08em] text-[#adc8ff]">NEXT RESEARCH STEP</p>
          <h2 id="next-research-title" className="mt-1 text-[21px] font-extrabold tracking-[-0.035em]">
            {issue.researchPaths.length > 0 ? "다음 리서치 질문" : "이 소식이 어떤 영향을 미칠지 분석해보세요."}
          </h2>

          {issue.researchPaths.length > 0 ? (
            <div className="mt-base grid gap-sm" role="group" aria-label="다음 리서치 질문">
              {issue.researchPaths.map((path, index) => {
                const ticker = path.relatedTickers[0] ?? null;
                const params = new URLSearchParams({
                  query: path.chatQuery,
                  news_issue_id: issue.id,
                });
                if (ticker) params.set("ticker", ticker);
                const href = `/chat/new?${params.toString()}`;
                return (
                  <a
                    key={path.id}
                    href={href}
                    className="flex min-h-14 w-full items-center gap-sm rounded-[14px] border border-white/15 bg-white/[0.04] px-sm py-sm text-left transition hover:border-white/45 hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/15 text-[10px] font-black text-[#d9e5ff]" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] font-extrabold leading-5 text-white">{path.question}</span>
                    <span className="material-symbols-outlined shrink-0 text-[19px] text-[#adc8ff]" aria-hidden="true">arrow_forward</span>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-[13px] leading-6 text-[#d2d9ea]">이슈의 핵심을 담은 질문 초안을 열고, 직접 수정한 뒤 분석을 시작할 수 있습니다.</p>
          )}
        </div>
        {issue.researchPaths.length === 0 ? (
          <div className="border-t border-white/15 px-lg py-base sm:flex sm:items-center sm:justify-end sm:px-xl">
            <button type="button" onClick={() => onOpenResearchDraft(null)} disabled={openingDraft} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-lg text-[13px] font-extrabold text-ink transition hover:bg-[#dce8ff] disabled:cursor-not-allowed disabled:opacity-65 sm:w-auto">
              {openingDraft ? <span className="material-symbols-outlined animate-spin text-[18px]" aria-hidden="true">progress_activity</span> : <span className="material-symbols-outlined text-[18px]" aria-hidden="true">manage_search</span>}
              {openingDraft ? "질문 초안 여는 중" : "영향 분석하기"}
            </button>
            {draftError ? <p className="mt-2 max-w-xs text-[12px] leading-5 text-[#ffcfbf] sm:ml-base sm:mt-0" role="alert">{draftError}</p> : null}
          </div>
        ) : null}
      </section>

      {issue.confirmed.length > 0 ? (
        <section className="mt-xl" aria-label="확인된 내용">
          <EvidenceList title="확인된 내용" tone="confirmed" items={issue.confirmed} emptyCopy="별도로 정리된 확인 내용이 아직 없습니다." />
        </section>
      ) : null}

    </article>
  );
}

function EvidenceList({ title, icon, tone, items, emptyCopy }: { title: string; icon?: string; tone: "confirmed" | "caution"; items: readonly string[]; emptyCopy: string }) {
  const accent = tone === "confirmed" ? "text-[#287450]" : "text-[#8a6318]";
  const border = tone === "confirmed" ? "border-[#cbe3d6] bg-[#fbfefc]" : "border-[#eeddb6] bg-[#fffdf7]";
  return (
    <div className={`rounded-[18px] border p-base ${border}`}>
      <h3 className={`flex items-center gap-xs text-[14px] font-extrabold ${accent}`}>{icon ? <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span> : null}{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-sm grid gap-sm text-[13px] leading-6 text-body">
          {items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-sm"><span className={`mt-[9px] size-1.5 shrink-0 rounded-full ${tone === "confirmed" ? "bg-[#4e9d75]" : "bg-[#c69635]"}`} aria-hidden="true" />{item}</li>)}
        </ul>
      ) : <p className="mt-sm text-[13px] leading-6 text-muted">{emptyCopy}</p>}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-base animate-pulse" aria-label="시장 이슈를 불러오는 중" role="status">
      <div className="h-7 w-24 rounded-full bg-surface-soft" />
      <div className="mt-base h-12 w-5/6 rounded bg-surface-soft sm:h-16" />
      <div className="mt-xl h-44 rounded-[22px] bg-surface-soft" />
      <div className="mt-xl grid gap-base md:grid-cols-2"><div className="h-52 rounded-[18px] bg-surface-soft" /><div className="h-52 rounded-[18px] bg-surface-soft" /></div>
      <div className="mt-xl h-64 rounded-[22px] bg-surface-soft" />
    </div>
  );
}

function DetailLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-base rounded-[22px] border border-[#efd7b3] bg-[#fffaf2] px-lg py-xl text-center">
      <span className="material-symbols-outlined text-[30px] text-[#ae7521]" aria-hidden="true">find_in_page</span>
      <h1 className="mt-sm text-[20px] font-extrabold text-ink">이 이슈를 불러오지 못했습니다.</h1>
      <p className="mt-2 text-[13px] leading-6 text-body">삭제되었거나, 연결 상태가 일시적으로 좋지 않을 수 있습니다.</p>
      <button type="button" onClick={onRetry} className="mt-base min-h-10 rounded-full bg-ink px-base text-[13px] font-bold text-white transition hover:bg-primary">다시 시도</button>
    </div>
  );
}

function readDraftHref(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const directHref = typeof record.href === "string" ? record.href.trim() : "";
  const nestedDraft = record.draft !== null && typeof record.draft === "object" && !Array.isArray(record.draft)
    ? record.draft as Record<string, unknown>
    : null;
  const nestedHref = nestedDraft && typeof nestedDraft.href === "string" ? nestedDraft.href.trim() : "";
  const href = directHref || nestedHref;
  if (!href || !href.startsWith("/")) return null;
  return href;
}
