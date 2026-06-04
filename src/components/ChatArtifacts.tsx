"use client";

import type {
  AtomicNewsEventCard,
  ChatArtifact,
  ChatArtifactSelection,
  NewsEventSelectionArtifactPayload,
  SourcePreview,
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

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  const keys = [
    "text",
    "fact",
    "summary",
    "claim",
    "value",
    "description",
    "label",
  ];
  for (const key of keys) {
    const text = asText(record[key]);
    if (text) return text;
  }

  const entries = Object.entries(record)
    .map(([key, item]) => {
      const text = asText(item);
      return text ? `${key}: ${text}` : "";
    })
    .filter(Boolean);
  return entries.slice(0, 2).join(" · ");
}

function sourceLabel(source: SourcePreview): string {
  return (
    source.publisher ||
    source.domain ||
    source.title ||
    source.url ||
    "source"
  );
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
  const dateText = compactDate(event.event_date || event.source_date);
  const facts = (event.key_facts ?? []).map(asText).filter(Boolean).slice(0, 3);
  const sources = (event.source_previews ?? []).slice(0, 2);
  const axes = (event.investment_axes ?? []).slice(0, 3);

  return (
    <article className="rounded-[8px] border border-hairline bg-canvas p-base transition-colors hover:border-primary/35 sm:p-lg">
      <div className="flex flex-wrap items-center gap-xs">
        {event.ticker ? (
          <span className="font-mono text-[12px] font-black leading-none tracking-[0.08em] text-primary">
            {event.ticker}
          </span>
        ) : null}
        {event.event_type ? (
          <span className="rounded-full border border-hairline px-2 py-1 text-[11px] font-bold leading-none text-muted">
            {event.event_type}
          </span>
        ) : null}
        {dateText ? (
          <time className="text-[12px] font-semibold leading-none text-muted">
            {dateText}
          </time>
        ) : null}
      </div>

      <h3 className="mt-sm text-[16px] font-black leading-[1.35] text-ink sm:text-[17px]">
        {event.event_title}
      </h3>

      {event.short_summary ? (
        <p className="mt-xs text-[14px] leading-[1.55] text-body">
          {event.short_summary}
        </p>
      ) : null}

      {facts.length > 0 ? (
        <ul className="mt-sm space-y-xs text-[13px] leading-[1.5] text-body">
          {facts.map((fact, index) => (
            <li key={`${event.id}-fact-${index}`} className="flex gap-xs">
              <span
                aria-hidden="true"
                className="mt-[0.62em] h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              />
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {axes.length > 0 ? (
        <div className="mt-sm flex flex-wrap gap-xs">
          {axes.map((axis) => (
            <span
              key={`${event.id}-${axis}`}
              className="rounded-full bg-surface-dim px-2 py-1 text-[11px] font-bold leading-none text-body"
            >
              {axis}
            </span>
          ))}
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="mt-base border-t border-hairline pt-sm">
          <div className="grid gap-xs">
            {sources.map((source, index) => {
              const label = sourceLabel(source);
              const sourceDate = compactDate(source.published_at);
              return (
                <div
                  key={`${event.id}-source-${index}`}
                  className="min-w-0 text-[12px] leading-[1.45] text-muted"
                >
                  <span className="font-bold text-body">{label}</span>
                  {sourceDate ? <span> · {sourceDate}</span> : null}
                  {source.title && source.title !== label ? (
                    <span className="block truncate">{source.title}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
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
          <span>{selected ? "분석 시작됨" : "공시 기준으로 분석"}</span>
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
