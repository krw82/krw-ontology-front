"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatIssueDate,
  formatIssueRelativeTime,
  marketIssueStatusClass,
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
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setDetail({ kind: "error" });
    }
  }, [issueId]);

  useEffect(() => {
    void loadDetail();
    return () => controllerRef.current?.abort();
  }, [loadDetail]);

  const openResearchDraft = async () => {
    if (detail.kind !== "ready" || openingDraft) return;
    setOpeningDraft(true);
    setDraftError(null);
    try {
      const response = await fetch(`/api/news/issues/${encodeURIComponent(detail.issue.id)}/research-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      <Link href="/news" className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-bold text-muted transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
        시장 이슈
      </Link>

      {detail.kind === "loading" ? <DetailSkeleton /> : null}
      {detail.kind === "error" ? <DetailLoadError onRetry={() => void loadDetail()} /> : null}
      {detail.kind === "ready" ? (
        <IssueDetailContent
          issue={detail.issue}
          openingDraft={openingDraft}
          draftError={draftError}
          onOpenResearchDraft={() => void openResearchDraft()}
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
  onOpenResearchDraft: () => void;
}) {
  const sourceCount = Math.max(issue.sourceCount, issue.sources.length);
  const impactPath = issue.impactPath.slice(0, 5);

  return (
    <article className="mt-base">
      <header className="border-b border-hairline pb-xl sm:pb-2xl">
        <div className="flex flex-wrap items-center gap-sm">
          <span className={`inline-flex min-h-7 items-center rounded-full border px-sm text-[11px] font-extrabold ${marketIssueStatusClass(issue.statusTone)}`}>
            {issue.statusLabel}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">source</span>
            원문 {sourceCount}개
          </span>
          <time className="text-[12px] font-medium text-muted" dateTime={issue.updatedAt ?? issue.publishedAt ?? undefined}>
            {formatIssueRelativeTime(issue.updatedAt ?? issue.publishedAt)}
          </time>
        </div>
        <h1 className="mt-base max-w-3xl text-[30px] font-black leading-[1.22] tracking-[-0.055em] text-ink sm:text-[42px]">
          {issue.title}
        </h1>
        <p className="mt-base max-w-2xl text-[14px] leading-6 text-muted">
          시장의 변화와 기업의 연결고리를 검토하기 위한 리서치 화면입니다. 아래 원문과 공시를 함께 확인해주세요.
        </p>
      </header>

      <section className="mt-xl rounded-[22px] border border-[#d8e4fa] bg-[#f6f9ff] p-base sm:p-lg" aria-labelledby="korean-context-title">
        <div className="flex items-center gap-xs text-[12px] font-extrabold text-primary">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">auto_awesome</span>
          <h2 id="korean-context-title">AI가 정리한 한국어 맥락</h2>
        </div>
        <p className="mt-sm text-[16px] leading-7 text-body">{issue.summary}</p>
        <p className="mt-sm text-[12px] leading-5 text-muted">이 문단은 원문을 대신하지 않습니다. 아래 원문 출처와 회사 공시를 함께 확인해주세요.</p>
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

      {(issue.confirmed.length > 0 || issue.unconfirmed.length > 0) ? (
        <section className="mt-xl" aria-labelledby="confirmation-title">
          <div className="flex items-baseline justify-between gap-base">
            <h2 id="confirmation-title" className="text-[20px] font-extrabold tracking-[-0.035em] text-ink">확인 범위</h2>
            <span className="text-[11px] font-medium text-muted">사실과 추가 검토 항목을 나눠 봅니다.</span>
          </div>
          <div className="mt-base grid gap-base md:grid-cols-2">
            <EvidenceList title="원문에서 확인된 내용" icon="verified" tone="confirmed" items={issue.confirmed} emptyCopy="원문에서 별도로 확인된 항목이 아직 정리되지 않았습니다." />
            <EvidenceList title="추가 확인이 필요한 부분" icon="rule" tone="caution" items={issue.unconfirmed} emptyCopy="현재 별도로 표시된 추가 확인 항목은 없습니다." />
          </div>
        </section>
      ) : null}

      {impactPath.length > 0 ? (
        <section className="mt-xl" aria-labelledby="impact-path-title">
          <h2 id="impact-path-title" className="text-[20px] font-extrabold tracking-[-0.035em] text-ink">검토할 영향 경로</h2>
          <p className="mt-1 text-[13px] leading-6 text-muted">연결은 확정된 결론이 아니라, 공시와 실적콜에서 다시 확인할 질문입니다.</p>
          <ol className="mt-base flex flex-wrap items-center gap-sm rounded-[18px] border border-hairline bg-white p-base">
            {impactPath.map((step, index) => (
              <li key={`${step}-${index}`} className="flex items-center gap-sm">
                <span className="rounded-full bg-surface-soft px-sm py-1.5 text-[12px] font-bold text-body">{step}</span>
                {index < impactPath.length - 1 ? <span className="material-symbols-outlined text-[18px] text-muted" aria-hidden="true">arrow_forward</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {issue.companies.length > 0 ? (
        <section className="mt-xl" aria-labelledby="companies-title">
          <h2 id="companies-title" className="text-[20px] font-extrabold tracking-[-0.035em] text-ink">관련 기업</h2>
          <p className="mt-1 text-[13px] leading-6 text-muted">직접적인 수혜나 피해를 의미하지 않으며, 이슈를 검토할 때 함께 볼 기업입니다.</p>
          <div className="mt-base grid gap-sm sm:grid-cols-2">
            {issue.companies.map((company) => {
              const content = (
                <>
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#eff5ff] text-[11px] font-black text-primary">
                    {company.ticker ?? company.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-extrabold text-ink">{company.name}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-muted">{[company.ticker, company.relationship].filter(Boolean).join(" · ") || "관련 기업"}</span>
                  </span>
                  {company.href ? <span className="material-symbols-outlined ml-auto text-[17px] text-muted" aria-hidden="true">arrow_forward</span> : null}
                </>
              );
              return company.href ? (
                <a key={`${company.id ?? company.name}-${company.ticker ?? ""}`} href={company.href} className="flex min-h-16 items-center gap-sm rounded-[16px] border border-hairline bg-white px-sm py-sm transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" >{content}</a>
              ) : (
                <div key={`${company.id ?? company.name}-${company.ticker ?? ""}`} className="flex min-h-16 items-center gap-sm rounded-[16px] border border-hairline bg-white px-sm py-sm">{content}</div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mt-xl" aria-labelledby="sources-title">
        <div className="flex items-baseline justify-between gap-base">
          <div>
            <p className="text-[11px] font-extrabold tracking-[0.08em] text-primary">SOURCE ORIGINALS</p>
            <h2 id="sources-title" className="mt-1 text-[20px] font-extrabold tracking-[-0.035em] text-ink">원문 출처</h2>
          </div>
          <span className="text-[12px] font-medium text-muted">한국어 요약과 분리해 표시합니다.</span>
        </div>
        {issue.sources.length > 0 ? (
          <div className="mt-base grid gap-sm">
            {issue.sources.map((source, index) => <SourceOriginal key={source.id} source={source} index={index} />)}
          </div>
        ) : (
          <div className="mt-base rounded-[18px] border border-dashed border-hairline bg-white p-base text-[13px] leading-6 text-muted">
            연결된 원문 출처가 아직 표시되지 않았습니다. 이 이슈는 공시·실적콜에서 한 번 더 검증해주세요.
          </div>
        )}
      </section>

      <section className="mt-xl rounded-[22px] bg-ink px-lg py-xl text-white sm:flex sm:items-center sm:justify-between sm:gap-xl">
        <div className="max-w-xl">
          <p className="text-[12px] font-extrabold tracking-[0.08em] text-[#adc8ff]">NEXT RESEARCH STEP</p>
          <h2 className="mt-1 text-[21px] font-extrabold tracking-[-0.035em]">공시와 실적콜에서 이 연결을 검증해보세요.</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#d2d9ea]">이슈의 핵심을 담은 질문 초안을 열고, 직접 수정한 뒤 분석을 시작할 수 있습니다.</p>
        </div>
        <div className="mt-base shrink-0 sm:mt-0">
          <button type="button" onClick={onOpenResearchDraft} disabled={openingDraft} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-lg text-[13px] font-extrabold text-ink transition hover:bg-[#dce8ff] disabled:cursor-not-allowed disabled:opacity-65">
            {openingDraft ? <span className="material-symbols-outlined animate-spin text-[18px]" aria-hidden="true">progress_activity</span> : <span className="material-symbols-outlined text-[18px]" aria-hidden="true">manage_search</span>}
            {openingDraft ? "질문 초안 여는 중" : "공시·실적콜로 검증하기"}
          </button>
          {draftError ? <p className="mt-2 max-w-xs text-[12px] leading-5 text-[#ffcfbf]" role="alert">{draftError}</p> : null}
        </div>
      </section>
    </article>
  );
}

function EvidenceList({ title, icon, tone, items, emptyCopy }: { title: string; icon: string; tone: "confirmed" | "caution"; items: readonly string[]; emptyCopy: string }) {
  const accent = tone === "confirmed" ? "text-[#287450]" : "text-[#8a6318]";
  const border = tone === "confirmed" ? "border-[#cbe3d6] bg-[#fbfefc]" : "border-[#eeddb6] bg-[#fffdf7]";
  return (
    <div className={`rounded-[18px] border p-base ${border}`}>
      <h3 className={`flex items-center gap-xs text-[14px] font-extrabold ${accent}`}><span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-sm grid gap-sm text-[13px] leading-6 text-body">
          {items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-sm"><span className={`mt-[9px] size-1.5 shrink-0 rounded-full ${tone === "confirmed" ? "bg-[#4e9d75]" : "bg-[#c69635]"}`} aria-hidden="true" />{item}</li>)}
        </ul>
      ) : <p className="mt-sm text-[13px] leading-6 text-muted">{emptyCopy}</p>}
    </div>
  );
}

function SourceOriginal({ source, index }: { source: MarketIssueCard["sources"][number]; index: number }) {
  const identity = [source.publisher, source.author].filter(Boolean).join(" · ") || `출처 ${index + 1}`;
  const sourceType = source.sourceType ?? "원문";
  return (
    <article className="rounded-[18px] border border-hairline bg-white p-base sm:p-lg">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-[12px] font-extrabold text-ink">{identity}</p>
        <div className="flex items-center gap-sm">
          <span className="rounded-full bg-surface-soft px-sm py-1 text-[10px] font-bold text-muted">{sourceType}</span>
          {source.publishedAt ? <time className="text-[11px] text-muted" dateTime={source.publishedAt}>{formatIssueDate(source.publishedAt)}</time> : null}
        </div>
      </div>
      {source.originalTitle ? <h3 className="mt-sm text-[15px] font-bold leading-6 text-ink">{source.originalTitle}</h3> : null}
      {source.originalText ? (
        <blockquote className="mt-sm border-l-2 border-[#c5d7fb] pl-sm text-[13px] leading-6 text-body">
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted">Original</p>
          {source.originalText}
        </blockquote>
      ) : null}
      {source.href ? (
        <a href={source.href} target="_blank" rel="noreferrer" className="mt-sm inline-flex min-h-10 items-center gap-1 text-[12px] font-extrabold text-primary transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          원문 열기
          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">open_in_new</span>
        </a>
      ) : null}
    </article>
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
