"use client";

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
  onSelectNewsEvent,
}: {
  artifactId: string;
  event: AtomicNewsEventCard;
  selected: boolean;
  disabled?: boolean;
  onSelectNewsEvent?: ChatArtifactsProps["onSelectNewsEvent"];
}) {
  const source = event.primary_source ?? event.source_previews?.[0];
  const dateText = compactDate(
    source?.published_at || event.event_date || event.source_date,
  );
  const eventTitle = event.event_title_ko || event.event_title;
  const summary = event.summary_ko || event.short_summary;
  const originalHeadline =
    event.original_headline || source?.title_original || source?.title;
  const sourceName = source?.publisher || source?.domain;
  const impactLabel = event.ui?.badge_ko || impactBadgeLabel(event.price_impact_direction);

  return (
    <article className="rounded-[8px] border border-hairline bg-canvas p-base transition-colors hover:border-primary/35 sm:p-lg">
      <div className="flex flex-wrap items-center gap-xs">
        {event.ticker ? (
          <span className="font-mono text-[12px] font-black leading-none tracking-[0.08em] text-primary">
            {event.ticker}
          </span>
        ) : null}
        {sourceName ? (
          <span className="rounded-full border border-hairline px-2 py-1 text-[11px] font-bold leading-none text-muted">
            {sourceName}
          </span>
        ) : null}
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

      <h3 className="mt-sm text-[16px] font-black leading-[1.35] text-ink sm:text-[17px]">
        {eventTitle}
      </h3>

      {originalHeadline ? (
        <div className="mt-base border-t border-hairline pt-sm">
          <p className="font-mono text-[11px] font-black leading-none tracking-[0.08em] text-primary">
            원문 기사
          </p>
          <div className="mt-xs text-[13px] font-bold leading-[1.45] text-ink">
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
        <div className="mt-base border-t border-hairline pt-sm">
          <p className="font-mono text-[11px] font-black leading-none tracking-[0.08em] text-primary">
            내용 요약
          </p>
          <p className="mt-xs text-[14px] leading-[1.6] text-body">{summary}</p>
        </div>
      ) : null}

      <div className="mt-base flex justify-end">
        <button
          type="button"
          className={[
            "inline-flex min-h-9 items-center gap-xs rounded-[8px] px-3 text-[13px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            selected
              ? "bg-primary-container/12 text-primary"
              : "border border-hairline bg-surface text-ink hover:border-primary/35 hover:text-primary",
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
        {events.map((event) => (
          <EventCard
            key={event.id}
            artifactId={artifact.id}
            event={event}
            selected={selectedIds.has(event.id)}
            disabled={disabled}
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
