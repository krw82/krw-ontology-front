"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { filingClassificationReason, filingEventTagLabel } from "@/lib/filing-notifications/classification";
import { trackClientEventSilently } from "@/lib/analytics/client";

type Filing = {
  id: string;
  display_ticker: string;
  form_type: "8-K" | "8-K/A" | "6-K" | "6-K/A";
  filing_date: string;
  accepted_at: string | null;
  is_amendment: boolean;
  primary_event_tag: string | null;
  sec_items: string[];
  source_metadata: { primaryDocDescription?: string | null; classificationRulePhrases?: unknown };
  filing_detail_url: string;
  primary_document_url: string | null;
  enrichment_status: string;
};

type FilingDocument = {
  id: string;
  document_name: string;
  document_type: string | null;
  description: string | null;
  document_url: string;
  is_primary: boolean;
  recommendation_score: number;
};

type KeywordMatch = {
  id: string;
  document_name: string | null;
  matched_context: string;
};

type AmendmentComparison = {
  available: boolean;
  message?: string;
  original?: { id: string; filing_date: string; form_type: string };
  match_reason?: "amendment_text" | "same_report_date" | "single_recent_original";
  text_diff?: {
    addedLines: number;
    removedLines: number;
    comparedOriginalLines: number;
    comparedAmendmentLines: number;
    lines: Array<{ kind: "added" | "removed"; text: string }>;
  } | null;
  document_changes?: { added: string[]; removed: string[] };
  note?: string;
};

export default function FilingDetail({ eventId }: { eventId: string }) {
  const searchParams = useSearchParams();
  const notificationId = searchParams.get("notification");
  const [filing, setFiling] = useState<Filing | null>(null);
  const [documents, setDocuments] = useState<FilingDocument[]>([]);
  const [keywordMatches, setKeywordMatches] = useState<KeywordMatch[]>([]);
  const [amendmentComparison, setAmendmentComparison] = useState<AmendmentComparison | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/filings/${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("filing_unavailable");
        return response.json() as Promise<{ filing: Filing; documents: FilingDocument[]; keyword_matches?: KeywordMatch[]; unread_count?: number }>;
      })
      .then((payload) => {
        if (!active) return;
        setFiling(payload.filing);
        setDocuments(payload.documents ?? []);
        setKeywordMatches(payload.keyword_matches ?? []);
        syncAppBadge(payload.unread_count ?? 0);
        trackClientEventSilently("filing_detail_viewed", { filing_event_id: eventId, ticker: payload.filing.display_ticker, form_type: payload.filing.form_type });
        if (notificationId) {
          trackClientEventSilently("push_notification_clicked", { filing_event_id: eventId, ticker: payload.filing.display_ticker });
        }
      })
      .catch(() => {
        if (active) setError("공시 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      });
    return () => { active = false; };
  }, [eventId, notificationId]);

  if (error) return <p className="rounded-[8px] bg-surface-soft p-md text-sm text-muted">{error}</p>;
  if (!filing) return <p className="text-sm text-muted">공시 정보를 불러오는 중…</p>;

  const eventLabel = filingEventTagLabel(filing.primary_event_tag);
  const description = typeof filing.source_metadata?.primaryDocDescription === "string" ? filing.source_metadata.primaryDocDescription : null;
  const metadataRulePhrases = Array.isArray(filing.source_metadata?.classificationRulePhrases)
    ? filing.source_metadata.classificationRulePhrases.filter((phrase): phrase is string => typeof phrase === "string")
    : [];
  const reason = filingClassificationReason({ formType: filing.form_type, secItems: filing.sec_items, primaryEventTag: filing.primary_event_tag, primaryDocDescription: description, metadataRulePhrases });
  const recommended = documents.find((document) => document.recommendation_score > 0) ?? null;
  const analysisQuery = `${filing.display_ticker}의 ${filing.form_type} 공시(${formatDate(filing.filing_date)})가 기존 투자 논지에 미치는 영향을 SEC 원문 근거로 분석해줘.`;
  const loadAmendmentComparison = async () => {
    if (loadingComparison || amendmentComparison) return;
    setLoadingComparison(true);
    try {
      const response = await fetch(`/api/filings/${encodeURIComponent(filing.id)}/amendment-comparison`, { cache: "no-store" });
      const payload = await response.json() as AmendmentComparison;
      if (!response.ok) throw new Error("comparison_unavailable");
      setAmendmentComparison(payload);
    } catch {
      setAmendmentComparison({ available: false, message: "원본 비교를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." });
    } finally {
      setLoadingComparison(false);
    }
  };

  return <article>
    <Link href="/filings" className="inline-flex text-sm font-bold text-primary underline underline-offset-4">← 공시함</Link>
    <div className="mt-lg rounded-[10px] border border-hairline bg-canvas p-lg shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.04em] text-primary"><span>{filing.display_ticker}</span><span className="rounded-[5px] border border-current/20 px-1.5 py-0.5">{filing.form_type}</span></div>
      <h1 className="mt-sm text-2xl font-black tracking-[-0.04em] text-ink">{eventLabel ?? "새 SEC 공시"}</h1>
      <p className="mt-sm text-sm leading-6 text-muted">{reason}</p>
      <p className="mt-xs text-xs text-muted">{filing.accepted_at ? formatDateTime(filing.accepted_at) : formatDate(filing.filing_date)} 제출</p>
      {filing.sec_items.length ? <div className="mt-md flex flex-wrap gap-2">{filing.sec_items.map((item) => <span key={item} className="rounded-[5px] bg-surface-soft px-2 py-1 text-xs font-bold text-muted">Item {item}</span>)}</div> : null}
      {keywordMatches.length ? <div className="mt-md rounded-[7px] bg-surface-soft px-sm py-sm"><p className="text-xs font-extrabold text-ink">내 키워드 규칙 일치</p>{keywordMatches.slice(0, 2).map((match) => <p key={match.id} className="mt-1 text-xs leading-5 text-muted">{match.matched_context}</p>)}</div> : null}
    </div>

    <section className="mt-lg rounded-[10px] border border-hairline bg-canvas p-lg">
      <h2 className="text-base font-extrabold text-ink">권장 첨부문서</h2>
      {recommended ? <DocumentLink document={recommended} eventId={filing.id} recommended /> : <p className="mt-sm text-sm leading-6 text-muted">{filing.enrichment_status === "failed" ? "첨부 목록을 불러오지 못했습니다. SEC 제출목록에서 원문을 확인해주세요." : "추천할 별도 첨부가 없거나, SEC 제출목록에서 원문을 확인해야 합니다."}</p>}
      {filing.primary_document_url ? <a href={outboundFilingHref(filing.id, { target: "primary" })} target="_blank" rel="noreferrer" className="mt-md inline-flex min-h-10 items-center rounded-[7px] border border-hairline px-base text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary">주요 제출문서 열기<span aria-hidden="true" className="material-symbols-outlined ml-1 text-[16px]">open_in_new</span></a> : null}
      {documents.length ? <details className="mt-md"><summary className="cursor-pointer text-sm font-bold text-primary">전체 제출문서 {documents.length}개</summary><div className="mt-sm space-y-sm">{documents.map((document) => <DocumentLink key={document.id} document={document} eventId={filing.id} />)}</div></details> : null}
      <a href={outboundFilingHref(filing.id, { target: "index" })} target="_blank" rel="noreferrer" className="mt-md inline-flex min-h-10 items-center rounded-[7px] border border-hairline px-base text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary">전체 SEC 제출목록 열기<span aria-hidden="true" className="material-symbols-outlined ml-1 text-[16px]">open_in_new</span></a>
    </section>

    {filing.is_amendment ? <section className="mt-lg rounded-[10px] border border-hairline bg-canvas p-lg">
      <div className="flex flex-wrap items-center justify-between gap-sm"><div><h2 className="text-base font-extrabold text-ink">정정 전과 비교</h2><p className="mt-xs text-sm leading-6 text-muted">SEC가 원본을 명확히 연결할 수 있을 때만 원본과 정정본의 문서 차이를 보여줍니다.</p></div>{!amendmentComparison ? <button type="button" onClick={() => void loadAmendmentComparison()} disabled={loadingComparison} className="min-h-10 rounded-[7px] border border-hairline px-base text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60">{loadingComparison ? "비교 준비 중…" : "원본과 비교"}</button> : null}</div>
      {amendmentComparison ? <AmendmentComparisonPanel comparison={amendmentComparison} /> : null}
    </section> : null}

    <section className="mt-lg rounded-[10px] border border-primary/25 bg-primary-fixed p-lg">
      <h2 className="text-base font-extrabold text-ink">이 공시를 KRW.O로 더 확인하기</h2>
      <p className="mt-xs text-sm leading-6 text-muted">자동 분석은 실행하지 않습니다. 필요할 때만 기존 리서치 사용량으로 질문을 시작합니다.</p>
      <Link href={`/chat/new?${new URLSearchParams({ ticker: filing.display_ticker, query: analysisQuery }).toString()}`} onClick={() => trackClientEventSilently("filing_analysis_started", { filing_event_id: filing.id, ticker: filing.display_ticker })} className="mt-md inline-flex min-h-10 items-center rounded-[7px] bg-primary px-base text-sm font-extrabold text-on-primary hover:bg-primary-active">이 공시 분석 시작</Link>
    </section>
  </article>;
}

function AmendmentComparisonPanel({ comparison }: { comparison: AmendmentComparison }) {
  if (!comparison.available) return <p className="mt-md rounded-[7px] bg-surface-soft px-sm py-sm text-sm leading-6 text-muted">{comparison.message ?? "비교 가능한 원본 공시를 찾지 못했습니다."}</p>;
  const textDiff = comparison.text_diff;
  return <div className="mt-md space-y-sm">
    {comparison.original ? <Link href={`/filings/${encodeURIComponent(comparison.original.id)}`} className="inline-flex text-sm font-bold text-primary underline underline-offset-4">원본 {comparison.original.form_type} · {formatDate(comparison.original.filing_date)} 보기</Link> : null}
    {textDiff ? <div className="rounded-[7px] bg-surface-soft px-sm py-sm"><p className="text-sm font-extrabold text-ink">원본 대비 <span className="text-emerald-700">{textDiff.addedLines}줄 추가</span> · <span className="text-rose-700">{textDiff.removedLines}줄 삭제</span></p><p className="mt-1 text-xs leading-5 text-muted">원본 {textDiff.comparedOriginalLines}줄과 정정본 {textDiff.comparedAmendmentLines}줄의 정규화된 앞부분을 비교했습니다.</p>{textDiff.lines.length ? <div className="mt-sm space-y-1">{textDiff.lines.map((line, index) => <p key={`${line.kind}-${index}`} className={`rounded-[5px] px-2 py-1 text-xs leading-5 ${line.kind === "added" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}><span className="mr-1 font-black" aria-hidden="true">{line.kind === "added" ? "+" : "−"}</span>{line.text}</p>)}</div> : null}</div> : null}
    {comparison.document_changes && (comparison.document_changes.added.length || comparison.document_changes.removed.length) ? <div className="rounded-[7px] border border-hairline px-sm py-sm text-xs leading-5 text-muted">{comparison.document_changes.added.length ? <p>새 첨부: {comparison.document_changes.added.join(", ")}</p> : null}{comparison.document_changes.removed.length ? <p>제외된 첨부: {comparison.document_changes.removed.join(", ")}</p> : null}</div> : null}
    {comparison.note ? <p className="text-xs leading-5 text-muted">{comparison.note}</p> : null}
  </div>;
}

function DocumentLink({ document, eventId, recommended = false }: { document: FilingDocument; eventId: string; recommended?: boolean }) {
  return <a href={outboundFilingHref(eventId, { document: document.id })} target="_blank" rel="noreferrer" className={`flex items-center justify-between gap-sm rounded-[8px] border px-base py-sm transition-colors hover:border-primary ${recommended ? "border-primary/35 bg-primary-fixed" : "border-hairline"}`}><span className="min-w-0"><span className="block truncate text-sm font-extrabold text-ink">{recommended ? "주요 첨부문서 · " : ""}{document.description || document.document_name}</span><span className="mt-0.5 block truncate text-xs text-muted">{document.document_type || "SEC 문서"} · {document.document_name}</span></span><span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px] text-muted">open_in_new</span></a>;
}

function outboundFilingHref(eventId: string, params: Record<string, string>) {
  return `/api/out/filings/${encodeURIComponent(eventId)}?${new URLSearchParams(params).toString()}`;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function syncAppBadge(unreadCount: number) {
  if (typeof navigator === "undefined") return;
  const badgeNavigator = navigator as Navigator & { setAppBadge?: (contents?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (unreadCount > 0) void badgeNavigator.setAppBadge?.(unreadCount).catch(() => undefined);
  else void badgeNavigator.clearAppBadge?.().catch(() => undefined);
}
