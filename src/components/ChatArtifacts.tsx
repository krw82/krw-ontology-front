"use client";

import { buildNewsEventDisplayText } from "@/lib/chat-artifacts/news-event-selection";
import { normalizeTicker } from "@/lib/ontology/ticker";
import type {
  AtomicNewsEventCard,
  ChatArtifact,
  ChatArtifactSelection,
  NewsEventSelectionArtifactPayload,
} from "@/types/api-contracts";

type NewsEventSelectionParams = {
  artifactId: string;
  eventId: string;
};

interface ChatArtifactsProps {
  artifacts?: ChatArtifact[];
  selections?: ChatArtifactSelection[];
  disabled?: boolean;
  onSelectNewsEvent?: (params: NewsEventSelectionParams) => void | Promise<void>;
}

function isNewsEventSelectionPayload(
  payload: ChatArtifact["payload_json"],
): payload is NewsEventSelectionArtifactPayload {
  return (
    Boolean(payload) &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as { kind?: unknown }).kind === "news_event_selection" &&
    Array.isArray((payload as { events?: unknown }).events)
  );
}

function compactDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function impactBadgeLabel(
  direction?: AtomicNewsEventCard["price_impact_direction"],
): string | null {
  if (direction === "negative") return "약세 요인";
  if (direction === "positive") return "강세 요인";
  if (direction === "mixed") return "혼재";
  if (direction === "unclear") return "확인 필요";
  return null;
}

function impactBadgeClass(
  direction?: AtomicNewsEventCard["price_impact_direction"],
): string {
  if (direction === "negative") return "border-red-200 bg-red-50 text-red-700";
  if (direction === "positive") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (direction === "mixed") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-hairline bg-surface-dim text-muted";
}

const AXIS_LABELS: Record<string, string> = {
  revenue: "매출",
  sales: "매출",
  demand: "수요",
  pricing: "가격",
  gross_margin: "매출총이익률",
  operating_margin: "영업마진",
  margin: "마진",
  cash_flow: "현금흐름",
  free_cash_flow: "FCF",
  capex: "CAPEX",
  guidance: "가이던스",
  risk_factors: "리스크",
  competition: "경쟁",
  supply_chain: "공급망",
  ai_infrastructure: "AI 인프라",
};

function analysisAxisLabels(event: AtomicNewsEventCard): string[] {
  const bridge = event.ontology_bridge_brief_en;
  const axes = [
    ...(event.investment_axes ?? []),
    ...(bridge?.likely_financial_axes ?? []),
    ...(bridge?.likely_business_axes ?? []),
  ];
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const axis of axes) {
    const key = axis.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const label = AXIS_LABELS[key] ?? AXIS_LABELS[axis.toLowerCase()] ?? axis;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= 4) break;
  }

  return labels;
}

function selectedEventIdsForArtifact(
  artifactId: string,
  selections?: ChatArtifactSelection[],
) {
  return new Set(
    (selections ?? [])
      .filter((selection) => selection.artifact_id === artifactId)
      .map((selection) => selection.event_id),
  );
}

function EventCard({
  artifactId,
  event,
  selected,
  disabled,
  index,
  onSelectNewsEvent,
}: {
  artifactId: string;
  event: AtomicNewsEventCard;
  selected: boolean;
  disabled?: boolean;
  index: number;
  onSelectNewsEvent?: ChatArtifactsProps["onSelectNewsEvent"];
}) {
  const source = event.primary_source ?? event.source_previews?.[0];
  const dateText = compactDate(
    source?.published_at || event.event_date || event.source_date,
  );
  const display = buildNewsEventDisplayText(event);
  const eventTitle = display.title;
  const summary = display.summary;
  const originalHeadline = display.originalHeadline;
  const sourceName = source?.publisher || source?.domain;
  const impactLabel = event.ui?.badge_ko || impactBadgeLabel(event.price_impact_direction);
  const axisLabels = analysisAxisLabels(event);
  const ticker = normalizeTicker(event.ticker ?? "");

  return (
    <article
      className="animate-fade-in-up group relative overflow-hidden rounded-[8px] border border-hairline bg-canvas p-base opacity-0 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-[background-color,border-color,transform] duration-200 ease-out hover:-translate-y-[1px] hover:border-primary/35 hover:bg-surface/45 sm:p-lg"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex flex-wrap items-center gap-x-sm gap-y-xs">
        <div className="flex min-w-0 items-center gap-xs">
          {ticker ? (
            <span className="font-mono text-[12px] font-black leading-none tracking-[0.08em] text-primary">
              {ticker}
            </span>
          ) : null}
          {sourceName ? (
            <span className="rounded-full border border-hairline bg-canvas px-2 py-1 text-[11px] font-bold leading-none text-muted">
              {sourceName}
            </span>
          ) : null}
        </div>
        {impactLabel ? (
          <span
            className={[
              "rounded-full border px-2 py-1 text-[11px] font-bold leading-none",
              impactBadgeClass(event.price_impact_direction),
            ].join(" ")}
          >
            {impactLabel}
          </span>
        ) : null}
        {dateText ? (
          <time className="text-[12px] font-semibold leading-none text-muted">
            {dateText}
          </time>
        ) : null}
      </div>

      <h3 className="mt-sm max-w-[72ch] text-[17px] font-black leading-[1.38] text-ink text-wrap-pretty sm:text-[18px]">
        {eventTitle}
      </h3>

      <div className="mt-base grid gap-sm border-t border-hairline pt-sm">
        {originalHeadline ? (
          <div className="grid gap-1 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-base">
            <p className="font-mono text-[11px] font-black leading-[1.4] tracking-[0.08em] text-primary">
              원문
            </p>
            <div className="min-w-0 text-[13px] font-bold leading-[1.5] text-ink">
              {source?.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-hairline underline-offset-4 hover:text-primary"
                >
                  {originalHeadline}
                </a>
              ) : (
                <span>{originalHeadline}</span>
              )}
            </div>
          </div>
        ) : null}

        {summary ? (
          <div className="grid gap-1 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-base">
            <p className="font-mono text-[11px] font-black leading-[1.4] tracking-[0.08em] text-primary">
              {display.isSourceLanguageFallback ? "원문 요약" : "내용"}
            </p>
            <p className="min-w-0 text-[14px] leading-[1.62] text-body">
              {summary}
            </p>
          </div>
        ) : null}

        {axisLabels.length > 0 ? (
          <div className="grid gap-1 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-base">
            <p className="font-mono text-[11px] font-black leading-[1.4] tracking-[0.08em] text-primary">
              분석 포인트
            </p>
            <div className="flex min-w-0 flex-wrap gap-xs">
              {axisLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-hairline bg-surface px-2 py-1 text-[11px] font-bold leading-none text-muted"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-base flex justify-end border-t border-hairline pt-sm">
        <button
          type="button"
          className={[
            "inline-flex min-h-10 items-center gap-xs rounded-[8px] px-3 text-[13px] font-extrabold transition-[background-color,border-color,color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.985]",
            selected
              ? "border border-primary-container bg-primary-container/20 text-primary"
              : "border border-hairline bg-surface text-ink hover:border-primary/35 hover:bg-canvas hover:text-primary",
            disabled && !selected ? "cursor-not-allowed opacity-55" : "",
          ].join(" ")}
          disabled={Boolean(disabled || selected)}
          onClick={() => onSelectNewsEvent?.({ artifactId, eventId: event.id })}
        >
          <span>{selected ? "분석 시작됨" : "이 뉴스 공시 기준으로 분석"}</span>
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[16px]"
          >
            {selected ? "check" : "arrow_forward"}
          </span>
        </button>
      </div>
    </article>
  );
}

function NewsEventSelectionArtifact({
  artifact,
  selections,
  disabled,
  onSelectNewsEvent,
}: {
  artifact: ChatArtifact;
  selections?: ChatArtifactSelection[];
  disabled?: boolean;
  onSelectNewsEvent?: ChatArtifactsProps["onSelectNewsEvent"];
}) {
  if (!isNewsEventSelectionPayload(artifact.payload_json)) return null;
  const events = artifact.payload_json.events;
  if (events.length === 0) return null;

  const selectedIds = selectedEventIdsForArtifact(artifact.id, selections);

  return (
    <section className="mt-lg border-t border-hairline pt-lg">
      <div className="mb-sm flex items-baseline justify-between gap-base">
        <h2 className="font-mono text-[13px] font-black leading-none tracking-[0.08em] text-primary">
          뉴스 후보
        </h2>
        <span className="shrink-0 text-[12px] font-semibold leading-none text-muted">
          {events.length}개
        </span>
      </div>
      <div className="grid gap-sm">
        {events.map((event, index) => (
          <EventCard
            key={event.id}
            artifactId={artifact.id}
            event={event}
            selected={selectedIds.has(event.id)}
            disabled={disabled}
            index={index}
            onSelectNewsEvent={onSelectNewsEvent}
          />
        ))}
      </div>
    </section>
  );
}

export default function ChatArtifacts({
  artifacts,
  selections,
  disabled,
  onSelectNewsEvent,
}: ChatArtifactsProps) {
  const visibleArtifacts = (artifacts ?? []).filter(
    (artifact) =>
      artifact.type === "news_event_selection" &&
      isNewsEventSelectionPayload(artifact.payload_json),
  );

  if (visibleArtifacts.length === 0) return null;

  return (
    <div className="space-y-lg">
      {visibleArtifacts.map((artifact) => (
        <NewsEventSelectionArtifact
          key={artifact.id}
          artifact={artifact}
          selections={selections}
          disabled={disabled}
          onSelectNewsEvent={onSelectNewsEvent}
        />
      ))}
    </div>
  );
}
