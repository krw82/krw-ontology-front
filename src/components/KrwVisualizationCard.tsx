"use client";

import { useMemo, useState } from "react";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveLine } from "@nivo/line";
import type {
  ChatMessageVisualization,
  VisualizationSeries,
  VisualizationView,
} from "@/types/api-contracts";

const VISUALIZATION_COLORS = [
  "#0052ff",
  "#0f9f6e",
  "#c2410c",
  "#6d28d9",
  "#b45309",
  "#be185d",
  "#0369a1",
  "#4d7c0f",
];

const visualizationTheme = {
  text: {
    fill: "var(--color-body)",
    fontFamily: "inherit",
    fontSize: 12,
  },
  axis: {
    ticks: {
      line: { stroke: "var(--color-hairline)" },
      text: { fill: "var(--color-muted)", fontSize: 11 },
    },
    legend: {
      text: { fill: "var(--color-body)", fontSize: 12, fontWeight: 700 },
    },
  },
  grid: {
    line: { stroke: "var(--color-hairline-soft)", strokeWidth: 1 },
  },
  tooltip: {
    container: {
      background: "var(--color-canvas)",
      border: "1px solid var(--color-hairline)",
      borderRadius: 8,
      boxShadow: "0 16px 40px rgba(10,11,13,0.12)",
      color: "var(--color-ink)",
      fontFamily: "inherit",
      fontSize: 12,
    },
  },
} as const;

type BarDatum = { period: string; [key: string]: string | number };

interface LinePointDatum {
  x: string;
  y: number;
  period: string;
  formatted_value?: string | null;
  unit?: string | null;
}

export default function KrwVisualizationCard({
  visualization,
}: {
  visualization: ChatMessageVisualization;
}) {
  const [showData, setShowData] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const artifact = visualization.payload_json;
  const warning = artifact.quality.warnings[0];
  const activeView = artifact.views.find((view) => view.view_id === activeViewId)
    ?? artifact.views[0];

  return (
    <figure className="my-lg w-full max-w-[820px] overflow-hidden rounded-[8px] border border-hairline bg-canvas shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-1 border-b border-hairline px-md py-sm sm:px-lg sm:py-md">
        <div className="flex min-w-0 items-start justify-between gap-sm">
          <figcaption className="min-w-0 text-[15px] font-black leading-5 text-ink sm:text-[16px]">
            {artifact.title}
          </figcaption>
          <button
            type="button"
            className="shrink-0 rounded-[6px] border border-hairline bg-surface px-2 py-1 text-[11px] font-bold leading-none text-muted transition-colors hover:border-primary/45 hover:text-ink"
            aria-expanded={showData}
            onClick={() => setShowData((value) => !value)}
          >
            {showData ? "차트" : "데이터 표"}
          </button>
        </div>
        <p className="max-w-[72ch] text-[12px] font-semibold leading-5 text-muted sm:text-[13px]">
          검증된 기간별 데이터 · 근거 {artifact.provenance.evidence_refs.length}개
        </p>
      </div>

      <div className="px-xs py-sm sm:px-sm sm:py-md">
        {artifact.views.length > 1 ? (
          <div
            className="mb-sm flex gap-1 overflow-x-auto px-sm pb-1 sm:px-md"
            role="tablist"
            aria-label="표시 단위 선택"
          >
            {artifact.views.map((view) => {
              const selected = view.view_id === activeView?.view_id;
              return (
                <button
                  key={view.view_id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black leading-none transition-colors sm:text-[12px] ${
                    selected
                      ? "bg-primary text-white"
                      : "bg-surface text-muted hover:bg-primary-fixed/55 hover:text-ink"
                  }`}
                  onClick={() => setActiveViewId(view.view_id)}
                >
                  {view.title}
                </button>
              );
            })}
          </div>
        ) : null}
        {activeView ? (
          <VisualizationViewCard view={activeView} showData={showData} />
        ) : null}
      </div>

      {warning ? (
        <div className="border-t border-hairline px-md py-xs text-[11px] font-semibold leading-4 text-muted sm:px-lg">
          {warning}
        </div>
      ) : null}
    </figure>
  );
}

function VisualizationViewCard({
  view,
  showData,
}: {
  view: VisualizationView;
  showData: boolean;
}) {
  const isDataOnly = view.chart_type === "table" || !isRenderableChart(view);

  return (
    <section className="min-w-0">
      <div className="mb-sm flex flex-wrap items-start justify-between gap-x-md gap-y-1 px-sm sm:px-md">
        {view.subtitle ? (
          <p className="text-[11px] font-semibold leading-4 text-muted sm:text-[12px]">
            {view.subtitle}
          </p>
        ) : <span />}
        {view.unit ? (
          <span className="rounded-[5px] bg-surface px-2 py-1 text-[10px] font-bold leading-none text-muted">
            {view.unit}
          </span>
        ) : null}
      </div>

      {showData || isDataOnly ? (
        <VisualizationDataTable view={view} />
      ) : (
        <>
          <VisualizationLegend series={view.series} />
          <div className="h-[250px] w-full sm:h-[304px]">
            {isLineLike(view) ? <LineVisualization view={view} /> : <BarVisualization view={view} />}
          </div>
        </>
      )}

      {view.events && view.events.length > 0 ? (
        <div className="mx-sm mt-sm rounded-[6px] border border-hairline-soft bg-surface/60 px-sm py-xs sm:mx-md">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-muted">
            관련 이벤트
          </p>
          <ul className="mt-1 space-y-1 text-[11px] leading-4 text-body sm:text-[12px]">
            {view.events.map((event) => (
              <li key={`${event.source_kind}-${event.date}-${event.evidence_ref}`}>
                <span className="font-bold text-ink">{event.date}</span>{" "}
                {event.href && safeHref(event.href) ? (
                  <a
                    className="font-semibold text-primary underline decoration-primary/30 underline-offset-2"
                    href={safeHref(event.href) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {event.label}
                  </a>
                ) : (
                  <span>{event.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function isRenderableChart(view: VisualizationView) {
  return ["line", "area", "bar", "stacked_bar", "stacked_100"].includes(
    view.chart_type,
  );
}

function isLineLike(view: VisualizationView) {
  return view.chart_type === "line" || view.chart_type === "area";
}

function LineVisualization({ view }: { view: VisualizationView }) {
  const labelByKey = useMemo(
    () => new Map(view.series.map((series) => [series.series_key, series.label])),
    [view.series],
  );
  const data = useMemo(
    () => view.series.map((series) => ({
      id: series.series_key,
      data: series.points.map((point) => ({
        x: point.period,
        y: point.value,
        period: point.period,
        formatted_value: point.formatted_value,
        unit: series.unit ?? view.unit,
      })),
    })),
    [view],
  );
  const area = view.chart_type === "area";

  return (
    <ResponsiveLine
      data={data}
      margin={{ top: 12, right: 12, bottom: xAxisIsCrowded(view) ? 56 : 42, left: 52 }}
      xScale={{ type: "point" }}
      yScale={{ type: "linear", min: "auto", max: "auto", stacked: false }}
      curve="monotoneX"
      colors={VISUALIZATION_COLORS}
      theme={visualizationTheme}
      axisTop={null}
      axisRight={null}
      axisBottom={{ tickSize: 0, tickPadding: 8, tickRotation: xAxisIsCrowded(view) ? -32 : 0 }}
      axisLeft={{
        tickSize: 0,
        tickPadding: 8,
        format: formatAxisValue,
      }}
      enableGridX={false}
      enableArea={area}
      areaOpacity={0.13}
      pointSize={area ? 5 : 7}
      pointBorderWidth={2}
      pointBorderColor={{ from: "serieColor" }}
      pointColor="var(--color-canvas)"
      enableSlices={false}
      useMesh
      tooltip={({ point }) => {
        const datum = point.data as unknown as LinePointDatum;
        return (
          <VisualizationTooltip
            color={point.seriesColor}
            label={labelByKey.get(String(point.seriesId)) ?? String(point.seriesId)}
            period={datum.period}
            value={datum.y}
            formattedValue={datum.formatted_value}
            unit={datum.unit}
          />
        );
      }}
    />
  );
}

function BarVisualization({ view }: { view: VisualizationView }) {
  const keys = view.series.map((series) => series.series_key);
  const labelByKey = useMemo(
    () => new Map(view.series.map((series) => [series.series_key, series.label])),
    [view.series],
  );
  const rows = useMemo(() => rowsForSeries(view.series, view.unit), [view.series, view.unit]);
  const stacked = view.chart_type === "stacked_bar" || view.chart_type === "stacked_100";

  return (
    <ResponsiveBar
      data={rows}
      keys={keys}
      indexBy="period"
      margin={{ top: 12, right: 12, bottom: xAxisIsCrowded(view) ? 56 : 42, left: 52 }}
      padding={0.24}
      groupMode={stacked ? "stacked" : "grouped"}
      colors={({ id }) => colorForKey(String(id), keys)}
      theme={visualizationTheme}
      axisTop={null}
      axisRight={null}
      axisBottom={{ tickSize: 0, tickPadding: 8, tickRotation: xAxisIsCrowded(view) ? -32 : 0 }}
      axisLeft={{
        tickSize: 0,
        tickPadding: 8,
        format: formatAxisValue,
      }}
      enableGridX={false}
      enableLabel={false}
      tooltip={(bar) => {
        const key = String(bar.id);
        return (
          <VisualizationTooltip
            color={bar.color}
            label={labelByKey.get(key) ?? key}
            period={String(bar.indexValue)}
            value={Number(bar.value)}
            formattedValue={stringValue(bar.data[`${key}__formatted`])}
            unit={stringValue(bar.data[`${key}__unit`])}
          />
        );
      }}
    />
  );
}

function VisualizationLegend({ series }: { series: VisualizationSeries[] }) {
  if (series.length <= 1) return null;
  return (
    <ul className="mb-xs flex max-h-[52px] flex-wrap gap-x-3 gap-y-1 overflow-y-auto px-sm text-[10px] font-bold leading-4 text-muted sm:px-md sm:text-[11px]">
      {series.map((item, index) => (
        <li key={item.series_key} className="flex min-w-0 max-w-full items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: colorForSeriesIndex(index) }}
          />
          <span className="truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function VisualizationDataTable({ view }: { view: VisualizationView }) {
  const periods = useMemo(
    () => Array.from(new Set(view.series.flatMap((series) => series.points.map((point) => point.period)))).sort(),
    [view.series],
  );
  return (
    <div className="mx-sm overflow-x-auto rounded-[7px] border border-hairline sm:mx-md">
      <table className="w-full min-w-[520px] border-collapse text-left text-[11px] leading-5 sm:text-[12px]">
        <thead className="bg-surface text-muted">
          <tr>
            <th className="sticky left-0 bg-surface px-sm py-xs font-black">기간</th>
            {view.series.map((series) => (
              <th key={series.series_key} className="px-sm py-xs font-black">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period} className="border-t border-hairline-soft">
              <th className="sticky left-0 bg-canvas px-sm py-xs font-bold text-ink">{period}</th>
              {view.series.map((series) => {
                const point = series.points.find((item) => item.period === period);
                return (
                  <td key={series.series_key} className="px-sm py-xs text-body">
                    {point ? point.formatted_value || formatDisplayValue(point.value) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function rowsForSeries(series: VisualizationSeries[], fallbackUnit?: string | null): BarDatum[] {
  const periods = Array.from(new Set(series.flatMap((item) => item.points.map((point) => point.period)))).sort();
  return periods.map((period) => {
    const row: BarDatum = { period };
    for (const item of series) {
      const point = item.points.find((candidate) => candidate.period === period);
      if (!point) continue;
      row[item.series_key] = point.value;
      if (point.formatted_value) row[`${item.series_key}__formatted`] = point.formatted_value;
      row[`${item.series_key}__unit`] = item.unit ?? fallbackUnit ?? "";
    }
    return row;
  });
}

function VisualizationTooltip({
  color,
  label,
  period,
  value,
  formattedValue,
  unit,
}: {
  color: string;
  label: string;
  period: string;
  value: number;
  formattedValue?: string | null;
  unit?: string | null;
}) {
  return (
    <div className="min-w-[178px] px-sm py-xs">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-[12px] font-black leading-5 text-ink">{label}</span>
      </div>
      <dl className="mt-1 grid grid-cols-[48px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px] leading-5">
        <dt className="font-bold text-muted">기간</dt>
        <dd className="font-extrabold text-ink">{period}</dd>
        <dt className="font-bold text-muted">값</dt>
        <dd className="font-extrabold text-ink">{formattedValue || formatDisplayValue(value)}</dd>
        {unit ? <><dt className="font-bold text-muted">단위</dt><dd className="font-extrabold text-ink">{unit}</dd></> : null}
      </dl>
    </div>
  );
}

function formatAxisValue(value: number | string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(numeric);
}

function formatDisplayValue(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function colorForKey(key: string, keys: string[]) {
  const index = Math.max(0, keys.indexOf(key));
  return colorForSeriesIndex(index);
}

function colorForSeriesIndex(index: number) {
  return VISUALIZATION_COLORS[index % VISUALIZATION_COLORS.length] ?? VISUALIZATION_COLORS[0];
}

function xAxisIsCrowded(view: VisualizationView) {
  return Math.max(...view.series.map((series) => series.points.length), 0) > 5;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
