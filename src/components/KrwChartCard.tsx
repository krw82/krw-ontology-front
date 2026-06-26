"use client";

import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveLine } from "@nivo/line";
import type { ChatMessageChart, KrwChartV1 } from "@/types/api-contracts";

const CHART_COLORS = [
  "#0052ff",
  "#0f9f6e",
  "#c2410c",
  "#6d28d9",
  "#b45309",
];

interface KrwChartCardProps {
  chart: ChatMessageChart;
}

interface LinePointDatum {
  x: string;
  y: number;
  period: string;
  formatted_value?: string | null;
  unit?: string | null;
  evidence_ref: string;
}

type ChartBarDatum = {
  period: string;
  [key: string]: string | number;
};

const chartTheme = {
  text: {
    fill: "var(--color-body)",
    fontFamily: "inherit",
    fontSize: 12,
  },
  axis: {
    ticks: {
      line: {
        stroke: "var(--color-hairline)",
      },
      text: {
        fill: "var(--color-muted)",
        fontSize: 11,
      },
    },
    legend: {
      text: {
        fill: "var(--color-body)",
        fontSize: 12,
        fontWeight: 700,
      },
    },
  },
  grid: {
    line: {
      stroke: "var(--color-hairline-soft)",
      strokeWidth: 1,
    },
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

export default function KrwChartCard({ chart }: KrwChartCardProps) {
  const payload = chart.payload_json;

  return (
    <figure className="my-lg w-full max-w-[820px] overflow-hidden rounded-[8px] border border-hairline bg-canvas shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-1 border-b border-hairline px-md py-sm sm:px-lg sm:py-md">
        <div className="flex min-w-0 items-start justify-between gap-sm">
          <figcaption className="min-w-0 text-[15px] font-black leading-5 text-ink sm:text-[16px]">
            {payload.title}
          </figcaption>
          <span className="shrink-0 rounded-[6px] border border-hairline bg-surface px-2 py-1 text-[10px] font-black uppercase leading-none text-muted">
            {payload.chart_type}
          </span>
        </div>
        {payload.subtitle ? (
          <p className="max-w-[72ch] text-[12px] font-semibold leading-5 text-muted sm:text-[13px]">
            {payload.subtitle}
          </p>
        ) : null}
      </div>
      <div className="h-[300px] w-full px-xs py-sm sm:h-[340px] sm:px-sm sm:py-md">
        {payload.chart_type === "bar" ? (
          <BarChart payload={payload} />
        ) : (
          <LineChart payload={payload} />
        )}
      </div>
      {payload.quality.warnings.length > 0 ? (
        <div className="border-t border-hairline px-md py-xs text-[11px] font-semibold leading-4 text-muted sm:px-lg">
          {payload.quality.warnings[0]}
        </div>
      ) : null}
    </figure>
  );
}

function LineChart({ payload }: { payload: KrwChartV1 }) {
  const data = payload.series.map((series) => ({
    id: series.label,
    data: series.points.map((point) => ({
      x: point.period,
      y: point.value,
      period: point.period,
      formatted_value: point.formatted_value,
      unit: series.unit ?? payload.unit,
      evidence_ref: point.evidence_ref,
    })),
  }));

  return (
    <ResponsiveLine
      data={data}
      margin={{ top: 18, right: 22, bottom: 52, left: 66 }}
      xScale={{ type: "point" }}
      yScale={{ type: "linear", min: "auto", max: "auto", stacked: false }}
      curve="monotoneX"
      colors={CHART_COLORS}
      theme={chartTheme}
      axisTop={null}
      axisRight={null}
      axisBottom={{
        tickSize: 0,
        tickPadding: 10,
        tickRotation: -32,
      }}
      axisLeft={{
        tickSize: 0,
        tickPadding: 8,
        format: formatAxisValue,
        legend: payload.unit ?? undefined,
        legendOffset: -52,
        legendPosition: "middle",
      }}
      enableGridX={false}
      enableSlices={false}
      pointSize={7}
      pointBorderWidth={2}
      pointBorderColor={{ from: "serieColor" }}
      pointColor="var(--color-canvas)"
      useMesh
      legends={buildLineLegend(data.length)}
      tooltip={({ point }) => {
        const datum = point.data as unknown as LinePointDatum;
        return (
          <ChartTooltip
            color={point.seriesColor}
            label={String(point.seriesId)}
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

function BarChart({ payload }: { payload: KrwChartV1 }) {
  const keys = payload.series.map((series) => series.series_key);
  const labelByKey = new Map(
    payload.series.map((series) => [series.series_key, series.label] as const),
  );
  const periodSet = new Set<string>();
  for (const series of payload.series) {
    for (const point of series.points) periodSet.add(point.period);
  }

  const rows: ChartBarDatum[] = Array.from(periodSet)
    .sort()
    .map((period) => {
      const row: ChartBarDatum = { period };
      for (const series of payload.series) {
        const point = series.points.find((item) => item.period === period);
        if (point) {
          row[series.series_key] = point.value;
        }
        if (point?.formatted_value) {
          row[`${series.series_key}__formatted`] = point.formatted_value;
        }
        if (series.unit ?? payload.unit) {
          row[`${series.series_key}__unit`] = series.unit ?? payload.unit ?? "";
        }
      }
      return row;
    });

  return (
    <ResponsiveBar
      data={rows}
      keys={keys}
      indexBy="period"
      margin={{ top: 18, right: 22, bottom: 52, left: 66 }}
      padding={0.24}
      groupMode="grouped"
      colors={({ id }) => colorForKey(String(id), keys)}
      theme={chartTheme}
      axisTop={null}
      axisRight={null}
      axisBottom={{
        tickSize: 0,
        tickPadding: 10,
        tickRotation: -32,
      }}
      axisLeft={{
        tickSize: 0,
        tickPadding: 8,
        format: formatAxisValue,
        legend: payload.unit ?? undefined,
        legendOffset: -52,
        legendPosition: "middle",
      }}
      enableGridX={false}
      enableLabel={false}
      legends={buildBarLegend(keys.length)}
      tooltip={(bar) => {
        const key = String(bar.id);
        return (
          <ChartTooltip
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

function ChartTooltip({
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
    <div className="min-w-[180px] px-sm py-xs">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate text-[12px] font-black leading-5 text-ink">
          {label}
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px] leading-5">
        <dt className="font-bold text-muted">기간</dt>
        <dd className="font-extrabold text-ink">{period}</dd>
        <dt className="font-bold text-muted">값</dt>
        <dd className="font-extrabold text-ink">
          {formattedValue || formatDisplayValue(value)}
        </dd>
        {unit ? (
          <>
            <dt className="font-bold text-muted">단위</dt>
            <dd className="font-extrabold text-ink">{unit}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function buildLineLegend(seriesCount: number) {
  if (seriesCount <= 1) return [];
  return [
    {
      anchor: "top-left" as const,
      direction: "row" as const,
      translateY: -16,
      itemWidth: 120,
      itemHeight: 14,
      symbolSize: 8,
      symbolShape: "circle" as const,
      itemTextColor: "var(--color-body)",
    },
  ];
}

function buildBarLegend(seriesCount: number) {
  if (seriesCount <= 1) return [];
  return [
    {
      anchor: "top-left" as const,
      direction: "row" as const,
      translateY: -16,
      itemWidth: 120,
      itemHeight: 14,
      symbolSize: 8,
      symbolShape: "circle" as const,
      itemTextColor: "var(--color-body)",
      dataFrom: "keys" as const,
    },
  ];
}

function colorForKey(key: string, keys: string[]) {
  const index = Math.max(0, keys.indexOf(key));
  return CHART_COLORS[index % CHART_COLORS.length];
}

function formatAxisValue(value: number | string) {
  if (typeof value !== "number") return String(value);
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trimNumber(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimNumber(value / 1_000)}K`;
  return trimNumber(value);
}

function formatDisplayValue(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function trimNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
