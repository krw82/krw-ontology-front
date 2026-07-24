import "server-only";

import { createHash } from "node:crypto";
import type {
  KrwVisualizationArtifact,
  VisualizationEvent,
  VisualizationIntent,
  VisualizationSeries,
  VisualizationToolResult,
  VisualizationTransform,
  VisualizationView,
  VisualizationViewType,
} from "./contracts";
import {
  KRW_VISUALIZATION_ARTIFACT_FORMAT,
  KRW_VISUALIZATION_SCHEMA_VERSION,
} from "./contracts";
import type { RegisteredVisualizationSeries } from "./dataset-registry";
import type { VisualizationDatasetRegistry } from "./dataset-registry";

const MAX_SERIES_PER_ARTIFACT = 8;
const MAX_POINTS_PER_ARTIFACT = 500;
const MAX_EVENTS_PER_VIEW = 8;

export function compileVisualization(params: {
  intent: VisualizationIntent;
  registry: VisualizationDatasetRegistry;
  artifactIndex: number;
}): VisualizationToolResult {
  const intent = normalizeIntent(params.intent);
  if (!intent.goal) {
    return skipped("invalid_intent", "시각화 목적을 확인하지 못했습니다.");
  }

  const resolution = resolveSeries(intent, params.registry);
  if (resolution.kind === "skipped") {
    return skipped(resolution.reasonCode, resolution.explanation);
  }

  const transforms = normalizedTransforms(intent.transform_hints);
  const transformed = applyTransforms(resolution.series, transforms);
  if (transformed.series.length === 0) {
    return skipped("insufficient_data", "검증된 숫자 데이터가 충분하지 않아 차트를 만들지 않았습니다.");
  }

  const timeScoped = applyTimeScope(transformed.series, intent.time_scope);
  if (timeScoped.series.length === 0) {
    return skipped("insufficient_data", "요청한 기간에 표시할 검증된 숫자 데이터가 없습니다.");
  }
  const limited = limitSeriesAndPoints(timeScoped.series);
  const displayIntent = { ...intent, time_scope: timeScoped.displayScope };
  const build = buildViews({
    intent: displayIntent,
    series: limited.series,
    events: eventsForIntent(params.registry.allEvents(), intent.event_overlay),
  });
  if (build.views.length === 0) {
    return skipped("insufficient_data", "표시할 수 있는 기간별 숫자가 충분하지 않습니다.");
  }

  const artifactRef = createArtifactRef({
    artifactIndex: params.artifactIndex,
    intent,
    views: build.views,
  });
  const evidenceRefs = Array.from(
    new Set(
      build.views.flatMap((view) => [
        ...view.series.flatMap((series) =>
          series.points.flatMap((point) => [
            point.evidence_ref,
            ...(point.derived_from_evidence_refs ?? []),
          ]),
        ),
        ...(view.events?.map((event) => event.evidence_ref) ?? []),
      ]),
    ),
  );
  const sourceToolCallIds = Array.from(
    new Set(resolution.sourceSeries.map((series) => series.source_tool_call_id)),
  );
  const warnings = Array.from(
    new Set([
      ...resolution.warnings,
      ...transformed.warnings,
      ...timeScoped.warnings,
      ...limited.warnings,
      ...build.warnings,
    ]),
  );
  const artifact: KrwVisualizationArtifact = {
    artifact_format: KRW_VISUALIZATION_ARTIFACT_FORMAT,
    schema_version: KRW_VISUALIZATION_SCHEMA_VERSION,
    artifact_ref: artifactRef,
    intent,
    title: build.title,
    views: build.views,
    provenance: {
      source_tool_call_ids: sourceToolCallIds,
      evidence_refs: evidenceRefs,
      source_kinds: Array.from(
        new Set([
          "ontology" as const,
          ...build.views.flatMap((view) =>
            view.events?.map((event) => event.source_kind) ?? [],
          ),
          ...(transformed.appliedTransforms.length > 0 ? ["derived" as const] : []),
        ]),
      ),
    },
    quality: {
      series_count: build.views.reduce((total, view) => total + view.series.length, 0),
      point_count: build.views.reduce(
        (total, view) => total + view.series.reduce((count, series) => count + series.points.length, 0),
        0,
      ),
      warnings,
    },
  };

  return {
    kind: "compose_visualization_result",
    status: warnings.length > 0 ? "partial" : "created",
    artifact_ref: artifactRef,
    artifact,
    warnings,
  };
}

function normalizeIntent(intent: VisualizationIntent): VisualizationIntent {
  const measures = Array.from(
    new Set((intent.measures ?? []).map((value) => value.trim()).filter(Boolean)),
  ).slice(0, MAX_SERIES_PER_ARTIFACT);
  return {
    goal: intent.goal.trim().slice(0, 300),
    measures: measures.length > 0 ? measures : undefined,
    time_scope: intent.time_scope?.trim().slice(0, 120) || null,
    relationship: intent.relationship ?? "auto",
    transform_hints: intent.transform_hints,
    event_overlay: intent.event_overlay,
    preferred_form: intent.preferred_form ?? "auto",
    title_hint: intent.title_hint?.trim().slice(0, 120) || null,
  };
}

function resolveSeries(
  intent: VisualizationIntent,
  registry: VisualizationDatasetRegistry,
):
  | { kind: "resolved"; series: VisualizationSeries[]; sourceSeries: RegisteredVisualizationSeries[]; warnings: string[] }
  | { kind: "skipped"; reasonCode: string; explanation: string } {
  const available = registry.allSeries();
  if (available.length === 0) {
    return {
      kind: "skipped",
      reasonCode: "no_dataset",
      explanation: "먼저 검증된 기간별 지표 데이터를 가져와야 합니다.",
    };
  }

  const requestedMeasures = intent.measures?.length
    ? intent.measures
    : inferMeasuresFromGoal(intent.goal, available);
  if (requestedMeasures.length === 0) {
    return {
      kind: "skipped",
      reasonCode: "ambiguous_metric",
      explanation: "어떤 지표를 그릴지 명확하지 않습니다.",
    };
  }

  const selected: RegisteredVisualizationSeries[] = [];
  const warnings: string[] = [];
  for (const measure of requestedMeasures) {
    const matches = registry.findSeries(measure);
    if (matches.length === 0) {
      warnings.push(`${measure}에 대응하는 검증된 시계열을 찾지 못했습니다.`);
      continue;
    }
    const distinctMetrics = new Set(matches.map((series) => series.canonical_metric ?? series.metric_name ?? series.label));
    if (distinctMetrics.size > 1 && matches.length > 4) {
      return {
        kind: "skipped",
        reasonCode: "ambiguous_metric",
        explanation: `${measure}에 여러 지표가 대응되어 임의로 선택하지 않았습니다.`,
      };
    }
    for (const match of matches) {
      if (!selected.some((series) => series.series_key === match.series_key)) selected.push(match);
    }
  }

  if (selected.length === 0) {
    return {
      kind: "skipped",
      reasonCode: "no_matching_series",
      explanation: "요청한 지표와 일치하는 검증된 시계열을 찾지 못했습니다.",
    };
  }
  if (selected.length > MAX_SERIES_PER_ARTIFACT) {
    selected.splice(MAX_SERIES_PER_ARTIFACT);
    warnings.push(`표시 가능한 시리즈 수를 ${MAX_SERIES_PER_ARTIFACT}개로 제한했습니다.`);
  }

  return { kind: "resolved", series: selected, sourceSeries: selected, warnings };
}

function inferMeasuresFromGoal(
  goal: string,
  available: RegisteredVisualizationSeries[],
): string[] {
  const normalizedGoal = normalizeSearch(goal);
  const matches = available.filter((series) =>
    series.aliases.some((alias) => {
      const normalizedAlias = normalizeSearch(alias);
      return normalizedAlias.length >= 3 && normalizedGoal.includes(normalizedAlias);
    }),
  );
  const unique = Array.from(new Map(matches.map((series) => [series.series_key, series])).values());
  if (unique.length === 1) return [unique[0]!.series_key];
  return [];
}

function normalizedTransforms(value: VisualizationTransform[] | undefined): VisualizationTransform[] {
  return Array.from(new Set((value ?? []).filter((transform) => transform !== "identity")));
}

function applyTransforms(
  series: VisualizationSeries[],
  transforms: VisualizationTransform[],
): {
  series: VisualizationSeries[];
  warnings: string[];
  appliedTransforms: VisualizationTransform[];
} {
  let current = series.map(cloneSeries);
  const warnings: string[] = [];
  const appliedTransforms: VisualizationTransform[] = [];
  for (const transform of transforms) {
    const previous = current;
    if (transform === "index_to_100") {
      current = current.map((item) => indexSeries(item, warnings));
    } else if (transform === "yoy_percent" || transform === "qoq_percent") {
      current = current.map((item) => changeSeries(item, transform, warnings));
    } else if (transform === "cumulative") {
      current = current.map(cumulativeSeries);
    } else if (transform === "share_of_total") {
      current = shareSeries(current, warnings);
    }
    if (current.some((item, index) => item !== previous[index])) {
      appliedTransforms.push(transform);
    }
  }
  return {
    series: current.filter((item) => item.points.length > 0),
    warnings,
    appliedTransforms,
  };
}

function applyTimeScope(
  series: VisualizationSeries[],
  timeScope: string | null | undefined,
): {
  series: VisualizationSeries[];
  warnings: string[];
  displayScope: string | null;
} {
  const parsed = parseTimeScope(timeScope);
  if (!parsed) {
    return { series, warnings: [], displayScope: null };
  }

  if (parsed.kind === "last_count") {
    const hasShortSeries = series.some((item) => item.points.length < parsed.count);
    return {
      series: series
        .map((item) => ({ ...item, points: item.points.slice(-parsed.count) }))
        .filter((item) => item.points.length > 0),
      warnings: hasShortSeries
        ? [`요청한 최근 ${parsed.count}개 기간보다 적은 검증된 데이터만 있습니다.`]
        : [],
      displayScope: hasShortSeries ? null : timeScope ?? null,
    };
  }

  const scoped = series
    .map((item) => ({
      ...item,
      points: item.points.filter((point) => {
        const coordinate = periodCoordinate(point.period);
        return Boolean(
          coordinate &&
            coordinate.year >= parsed.startYear &&
            coordinate.year <= parsed.endYear,
        );
      }),
    }))
    .filter((item) => item.points.length > 0);
  return {
    series: scoped,
    warnings: scoped.length === 0
      ? [`${parsed.startYear}–${parsed.endYear} 기간의 검증된 시계열을 찾지 못했습니다.`]
      : [],
    displayScope: timeScope ?? null,
  };
}

function parseTimeScope(
  value: string | null | undefined,
):
  | { kind: "last_count"; count: number }
  | { kind: "year_range"; startYear: number; endYear: number }
  | null {
  const scope = value?.trim();
  if (!scope) return null;
  const range = /((?:19|20)\d{2})\s*(?:-|–|~|to|부터)\s*(?:fy|cy)?\s*((?:19|20)\d{2})/i.exec(scope);
  if (range?.[1] && range[2]) {
    const startYear = Number(range[1]);
    const endYear = Number(range[2]);
    if (startYear <= endYear) return { kind: "year_range", startYear, endYear };
  }
  const count = /(?:최근\s*)?(\d+)\s*(?:개\s*)?(?:회계\s*)?(?:년|회계연도|분기|기간)|(?:last|recent)\s+(\d+)\s+(?:fiscal\s+)?(?:years?|quarters?|periods?)/i.exec(scope);
  const numericCount = Number(count?.[1] ?? count?.[2] ?? 0);
  if (Number.isSafeInteger(numericCount) && numericCount >= 1 && numericCount <= MAX_POINTS_PER_ARTIFACT) {
    return { kind: "last_count", count: numericCount };
  }
  return null;
}

function indexSeries(series: VisualizationSeries, warnings: string[]): VisualizationSeries {
  const baseline = series.points.find((point) => point.value !== 0);
  if (!baseline) {
    warnings.push(`${series.label}은(는) 0이 아닌 기준값이 없어 지수화하지 않았습니다.`);
    return series;
  }
  return {
    ...series,
    label: `${series.label} (기준=100)`,
    unit: "index (first period = 100)",
    points: series.points.map((point) => ({
      ...point,
      value: Number(((point.value / baseline.value) * 100).toFixed(4)),
      formatted_value: null,
    })),
  };
}

function changeSeries(
  series: VisualizationSeries,
  transform: "yoy_percent" | "qoq_percent",
  warnings: string[],
): VisualizationSeries {
  const points = transform === "yoy_percent"
    ? yearOverYearPoints(series)
    : quarterOverQuarterPoints(series);
  if (points.length === 0) {
    warnings.push(
      transform === "yoy_percent"
        ? `${series.label}은(는) 같은 기간 전년 데이터를 확인할 수 없어 YoY를 계산하지 않았습니다.`
        : `${series.label}은(는) 직전 분기 데이터를 확인할 수 없어 QoQ를 계산하지 않았습니다.`,
    );
    return series;
  }
  return {
    ...series,
    label: `${series.label} ${transform === "yoy_percent" ? "YoY" : "QoQ"}`,
    unit: "%",
    points,
  };
}

function yearOverYearPoints(series: VisualizationSeries): VisualizationSeries["points"] {
  const pointsByPeriod = new Map(
    series.points.flatMap((point) => {
      const coordinate = periodCoordinate(point.period);
      return coordinate ? [[coordinateKey(coordinate), point] as const] : [];
    }),
  );
  return series.points.flatMap((point) => {
    const coordinate = periodCoordinate(point.period);
    if (!coordinate) return [];
    const previous = pointsByPeriod.get(coordinateKey({
      year: coordinate.year - 1,
      quarter: coordinate.quarter,
    }));
    return previous && previous.value !== 0
      ? [percentageChangePoint(point, previous)]
      : [];
  });
}

function quarterOverQuarterPoints(series: VisualizationSeries): VisualizationSeries["points"] {
  const pointsByPeriod = new Map(
    series.points.flatMap((point) => {
      const coordinate = periodCoordinate(point.period);
      return coordinate?.quarter
        ? [[coordinateKey(coordinate), point] as const]
        : [];
    }),
  );
  return series.points.flatMap((point) => {
    const coordinate = periodCoordinate(point.period);
    if (!coordinate?.quarter) return [];
    const previous = coordinate.quarter === 1
      ? pointsByPeriod.get(coordinateKey({ year: coordinate.year - 1, quarter: 4 }))
      : pointsByPeriod.get(coordinateKey({
          year: coordinate.year,
          quarter: coordinate.quarter - 1,
        }));
    return previous && previous.value !== 0
      ? [percentageChangePoint(point, previous)]
      : [];
  });
}

function percentageChangePoint(
  point: VisualizationSeries["points"][number],
  previous: VisualizationSeries["points"][number],
): VisualizationSeries["points"][number] {
  return {
    ...point,
    value: Number((((point.value - previous.value) / Math.abs(previous.value)) * 100).toFixed(4)),
    formatted_value: null,
    derived_from_evidence_refs: Array.from(
      new Set([
        point.evidence_ref,
        ...(point.derived_from_evidence_refs ?? []),
        previous.evidence_ref,
        ...(previous.derived_from_evidence_refs ?? []),
      ]),
    ),
  };
}

function periodCoordinate(period: string): { year: number; quarter: number | null } | null {
  const yearMatch = /(?:19|20)\d{2}/.exec(period);
  if (!yearMatch) return null;
  const prefixedQuarter = /q\s*([1-4])\b/i.exec(period)?.[1];
  const suffixedQuarter = /(?:^|[^0-9])([1-4])\s*q\b/i.exec(period)?.[1];
  const namedQuarter = /quarter\s*([1-4])\b/i.exec(period)?.[1];
  const quarter = Number(prefixedQuarter ?? suffixedQuarter ?? namedQuarter ?? 0);
  return {
    year: Number(yearMatch[0]),
    quarter: quarter >= 1 && quarter <= 4 ? quarter : null,
  };
}

function coordinateKey(coordinate: { year: number; quarter: number | null }): string {
  return `${coordinate.year}:${coordinate.quarter ?? "annual"}`;
}

function cumulativeSeries(series: VisualizationSeries): VisualizationSeries {
  let total = 0;
  return {
    ...series,
    label: `${series.label} 누적`,
    points: series.points.map((point) => {
      total += point.value;
      return { ...point, value: Number(total.toFixed(4)), formatted_value: null };
    }),
  };
}

function shareSeries(series: VisualizationSeries[], warnings: string[]): VisualizationSeries[] {
  if (series.length < 2) {
    warnings.push("구성비는 둘 이상의 시리즈가 있을 때만 계산할 수 있습니다.");
    return series;
  }
  const totals = new Map<string, number>();
  for (const item of series) {
    for (const point of item.points) {
      totals.set(point.period, (totals.get(point.period) ?? 0) + point.value);
    }
  }
  return series.map((item) => ({
    ...item,
    label: `${item.label} 비중`,
    unit: "%",
    points: item.points.flatMap((point) => {
      const total = totals.get(point.period) ?? 0;
      if (total === 0) return [];
      return [{ ...point, value: Number(((point.value / total) * 100).toFixed(4)), formatted_value: null }];
    }),
  }));
}

function limitSeriesAndPoints(series: VisualizationSeries[]): { series: VisualizationSeries[]; warnings: string[] } {
  const warnings: string[] = [];
  const pointBudget = Math.max(1, Math.floor(MAX_POINTS_PER_ARTIFACT / Math.max(1, series.length)));
  return {
    series: series.map((item) => {
      if (item.points.length <= pointBudget) return item;
      warnings.push(`${item.label}은(는) 최신 ${pointBudget}개 기간만 표시했습니다.`);
      return { ...item, points: item.points.slice(-pointBudget) };
    }),
    warnings,
  };
}

function eventsForIntent(
  events: VisualizationEvent[],
  overlay: VisualizationIntent["event_overlay"],
): VisualizationEvent[] {
  if (!overlay?.length) return [];
  const sourceKinds = new Set<VisualizationEvent["source_kind"]>();
  if (overlay.some((item) => item === "filing" || item === "8-K" || item === "6-K")) {
    sourceKinds.add("filing");
  }
  if (overlay.includes("news")) sourceKinds.add("news");
  return events.filter((event) => sourceKinds.has(event.source_kind));
}

function buildViews(params: {
  intent: VisualizationIntent;
  series: VisualizationSeries[];
  events: VisualizationEvent[];
}): { title: string; views: VisualizationView[]; warnings: string[] } {
  const warnings: string[] = [];
  const displaySeries = disambiguateSeriesLabels(params.series);
  const unitGroups = groupByUnit(displaySeries);
  const title = params.intent.title_hint || defaultTitle(params.intent, displaySeries);
  const entries = Array.from(unitGroups.entries());
  if (entries.length > 1 && !hasIndexTransform(params.series)) {
    warnings.push("서로 다른 단위는 같은 축에 그리지 않고 분리했습니다.");
  }
  const split = entries.length > 1 && !hasIndexTransform(params.series);
  const views = entries.flatMap(([unit, series], index) => {
    const view = buildView({
      viewId: `view_${index + 1}`,
      title: split ? `${title} · ${unit || "단위 미상"}` : title,
      series,
      intent: params.intent,
      events: params.events.slice(-MAX_EVENTS_PER_VIEW),
    });
    return view ? [view] : [];
  });
  return { title, views, warnings };
}

function buildView(params: {
  viewId: string;
  title: string;
  series: VisualizationSeries[];
  intent: VisualizationIntent;
  events: VisualizationEvent[];
}): VisualizationView | null {
  const pointCount = params.series.reduce((total, series) => total + series.points.length, 0);
  if (pointCount === 0) return null;
  const chartType = chooseViewType(params.intent, params.series);
  const unit = params.series[0]?.unit ?? null;
  const subtitle = buildSubtitle(params.intent, unit, params.series);
  return {
    view_id: params.viewId,
    chart_type: chartType,
    title: params.title,
    subtitle,
    unit,
    series: params.series,
    events: params.events.length > 0 ? params.events : undefined,
  };
}

function chooseViewType(intent: VisualizationIntent, series: VisualizationSeries[]): VisualizationViewType {
  if (intent.preferred_form && intent.preferred_form !== "auto") {
    if (isValidPreferredForm(intent.preferred_form, series)) {
      return intent.preferred_form;
    }
  }
  if (intent.relationship === "exact_values") return "table";
  if (intent.relationship === "composition") {
    if (series.length < 2) return "bar";
    return series.every((item) => item.unit === "%") ? "stacked_100" : "stacked_bar";
  }
  const maxPeriods = Math.max(...series.map((item) => item.points.length));
  if (intent.relationship === "trend" && maxPeriods >= 3) return "line";
  if (maxPeriods >= 8) return "line";
  if (maxPeriods < 3) return "table";
  return "bar";
}

function isValidPreferredForm(
  preferredForm: Exclude<VisualizationIntent["preferred_form"], "auto" | undefined>,
  series: VisualizationSeries[],
): boolean {
  if (["line", "area", "bar", "table"].includes(preferredForm)) return true;
  if (preferredForm === "stacked_bar") return series.length >= 2;
  return preferredForm === "stacked_100" &&
    series.length >= 2 &&
    series.every((item) => item.unit === "%");
}

function defaultTitle(intent: VisualizationIntent, series: VisualizationSeries[]): string {
  if (intent.relationship === "comparison") return `${series.map((item) => item.label).join(" · ")} 비교`;
  if (intent.relationship === "composition") return `${series.map((item) => item.label).join(" · ")} 구성`;
  if (intent.relationship === "exact_values") return `${series.map((item) => item.label).join(" · ")} 데이터`;
  return `${series.map((item) => item.label).join(" · ")} 추이`;
}

function buildSubtitle(
  intent: VisualizationIntent,
  unit: string | null,
  series: VisualizationSeries[],
): string | null {
  const periods = series.flatMap((item) => item.points.map((point) => point.period)).sort();
  const first = periods[0];
  const last = periods.at(-1);
  const scope = intent.time_scope || (first && last ? `${first}–${last}` : null);
  const parts = [unit, scope].filter((item): item is string => Boolean(item));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function groupByUnit(series: VisualizationSeries[]): Map<string, VisualizationSeries[]> {
  const groups = new Map<string, VisualizationSeries[]>();
  for (const item of series) {
    const key = item.unit?.trim() || "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function disambiguateSeriesLabels(series: VisualizationSeries[]): VisualizationSeries[] {
  const counts = new Map<string, number>();
  for (const item of series) {
    counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  }
  return series.map((item) => {
    if ((counts.get(item.label) ?? 0) <= 1) return item;
    const parts = item.series_key.split("|").filter(Boolean);
    const ticker = parts[0] ?? item.series_key;
    const dimension = parts[2]?.split(":")[0]?.replaceAll("_", " ");
    return {
      ...item,
      label: dimension ? `${item.label} · ${ticker} · ${dimension}` : `${item.label} · ${ticker}`,
    };
  });
}

function hasIndexTransform(series: VisualizationSeries[]): boolean {
  return series.every((item) => item.unit === "index (first period = 100)");
}

function createArtifactRef(params: {
  artifactIndex: number;
  intent: VisualizationIntent;
  views: VisualizationView[];
}): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({
      goal: params.intent.goal,
      relationship: params.intent.relationship,
      transforms: params.intent.transform_hints,
      series: params.views.flatMap((view) => view.series.map((series) => ({
        key: series.series_key,
        points: series.points.map((point) => [point.period, point.value, point.evidence_ref]),
      }))),
    }))
    .digest("hex")
    .slice(0, 12);
  return `viz_${params.artifactIndex}_${hash}`;
}

function cloneSeries(series: VisualizationSeries): VisualizationSeries {
  return { ...series, points: series.points.map((point) => ({ ...point })) };
}

function skipped(reasonCode: string, explanation: string): VisualizationToolResult {
  return {
    kind: "compose_visualization_result",
    status: "skipped",
    reason_code: reasonCode,
    explanation,
    warnings: [],
  };
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[\s_\-|/()[\]{}.,:;]+/g, "")
    .trim();
}
