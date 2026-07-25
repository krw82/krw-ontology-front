import "server-only";

import { createHash } from "node:crypto";
import type {
  KrwVisualizationArtifact,
  VisualizationEvent,
  VisualizationIntent,
  VisualizationSeries,
  VisualizationScopeMode,
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
  if (!intent.goal && !intent.measures?.length) {
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

  const semanticFingerprint = createSemanticFingerprint({
    intent,
    views: build.views,
    transforms: transformed.appliedTransforms,
  });
  const artifactRef = `viz_${semanticFingerprint.slice(0, 16)}`;
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
    semantic_fingerprint: semanticFingerprint,
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
    scope_mode: normalizeScopeMode(intent.scope_mode),
    group_by: intent.group_by?.trim().slice(0, 120) || null,
    include_scopes: normalizeScopeFilters(intent.include_scopes),
    exclude_scopes: normalizeScopeFilters(intent.exclude_scopes),
    transform_hints: intent.transform_hints,
    event_overlay: intent.event_overlay,
    preferred_form: intent.preferred_form ?? "auto",
    title_hint: intent.title_hint?.trim().slice(0, 120) || null,
    metric_label_hint: intent.metric_label_hint?.trim().slice(0, 60) || null,
    group_label_hint: intent.group_label_hint?.trim().slice(0, 60) || null,
    series_label_hints: normalizeSeriesLabelHints(intent.series_label_hints),
  };
}

function normalizeScopeMode(value: VisualizationIntent["scope_mode"]): VisualizationScopeMode {
  return value === "total" || value === "breakdown" || value === "explicit" ? value : "auto";
}

function normalizeScopeFilters(value: string[] | undefined): string[] | undefined {
  const normalized = Array.from(
    new Set((value ?? []).map((item) => item.trim()).filter(Boolean)),
  ).slice(0, MAX_SERIES_PER_ARTIFACT);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSeriesLabelHints(
  value: VisualizationIntent["series_label_hints"],
): VisualizationIntent["series_label_hints"] {
  const seen = new Set<string>();
  const normalized = (value ?? []).flatMap((hint) => {
    const source = hint.source?.trim().slice(0, 160);
    const label = cleanDisplayText(hint.label, 48);
    if (!source || !label || seen.has(normalizeSearch(source))) return [];
    seen.add(normalizeSearch(source));
    return [{ source, label }];
  });
  return normalized.length > 0 ? normalized.slice(0, MAX_SERIES_PER_ARTIFACT) : undefined;
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
    const metricGroups = groupByMetric(matches);
    const exactMetricGroups = metricGroups.filter((group) =>
      group.some((series) => isExactMetricMatch(series, measure)),
    );
    const matchingGroups = exactMetricGroups.length > 0 ? exactMetricGroups : metricGroups;
    if (matchingGroups.length > 1) {
      return {
        kind: "skipped",
        reasonCode: "ambiguous_metric",
        explanation: `${measure}에 여러 지표가 대응되어 임의로 선택하지 않았습니다.`,
      };
    }
    for (const match of matchingGroups[0] ?? []) {
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
  const deduped = dedupeSemanticSeries(selected);
  const scoped = selectScopes(intent, deduped);
  if (scoped.kind === "skipped") {
    return scoped;
  }
  if (scoped.series.length > MAX_SERIES_PER_ARTIFACT) {
    return {
      kind: "skipped",
      reasonCode: "too_many_series",
      explanation: `표시할 시리즈가 ${MAX_SERIES_PER_ARTIFACT}개를 넘어 차트를 임의로 줄이지 않았습니다. 범위를 좁혀 다시 요청해 주세요.`,
    };
  }

  if (deduped.length !== selected.length) {
    warnings.push("동일한 검증 시계열은 단위 표기를 정규화해 한 번만 사용했습니다.");
  }
  return {
    kind: "resolved",
    series: scoped.series,
    sourceSeries: scoped.series,
    warnings,
  };
}

function groupByMetric(series: RegisteredVisualizationSeries[]): RegisteredVisualizationSeries[][] {
  const groups = new Map<string, RegisteredVisualizationSeries[]>();
  for (const item of series) {
    const key = normalizeSearch(item.canonical_metric ?? item.metric_name ?? item.source_label ?? item.label);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.values());
}

function isExactMetricMatch(series: RegisteredVisualizationSeries, query: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  return [series.canonical_metric, series.metric_name, series.source_label, series.label]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeSearch(value) === normalizedQuery);
}

function dedupeSemanticSeries(series: RegisteredVisualizationSeries[]): RegisteredVisualizationSeries[] {
  const best = new Map<string, RegisteredVisualizationSeries>();
  for (const item of series) {
    const key = [
      item.ticker ?? "",
      item.canonical_metric ?? item.metric_name ?? item.source_label ?? item.label,
      item.scope.kind,
      item.scope.key,
      normalizedUnitKey(item.unit),
      item.period_type ?? "",
      item.duration ?? "",
    ].map(normalizeSearch).join("|");
    const current = best.get(key);
    if (!current || compareSeriesCompleteness(item, current) > 0) best.set(key, item);
  }
  return Array.from(best.values());
}

function compareSeriesCompleteness(
  left: RegisteredVisualizationSeries,
  right: RegisteredVisualizationSeries,
): number {
  if (left.points.length !== right.points.length) return left.points.length - right.points.length;
  const leftEvidence = left.points.filter((point) => Boolean(point.evidence_ref)).length;
  const rightEvidence = right.points.filter((point) => Boolean(point.evidence_ref)).length;
  return leftEvidence - rightEvidence;
}

function selectScopes(
  intent: VisualizationIntent,
  series: RegisteredVisualizationSeries[],
):
  | { kind: "resolved"; series: RegisteredVisualizationSeries[] }
  | { kind: "skipped"; reasonCode: string; explanation: string } {
  const mode = effectiveScopeMode(intent);
  const included = intent.include_scopes?.map(normalizeSearch) ?? [];
  const excluded = new Set(intent.exclude_scopes?.map(normalizeSearch) ?? []);
  const filtered = series.filter((item) => {
    const aliases = scopeAliases(item);
    if (aliases.some((alias) => excluded.has(alias))) return false;
    if (mode === "total") return item.scope.kind === "company_total";
    if (mode === "breakdown") {
      return item.scope.kind !== "company_total" && matchesGroup(item, intent.group_by);
    }
    if (mode === "explicit") {
      return included.length > 0 && aliases.some((alias) => included.includes(alias));
    }
    return true;
  });

  if (mode === "auto") {
    const auto = selectAutomaticScope(filtered);
    if (auto.length === 0) {
      return {
        kind: "skipped",
        reasonCode: "ambiguous_scope",
        explanation: "회사 전체와 세부 항목 중 무엇을 그릴지 명확하지 않아 임의로 선택하지 않았습니다.",
      };
    }
    return { kind: "resolved", series: auto };
  }
  if (filtered.length === 0) {
    return {
      kind: "skipped",
      reasonCode: mode === "breakdown" ? "no_matching_breakdown" : "no_matching_scope",
      explanation: "요청한 범위에 맞는 검증 시계열을 찾지 못했습니다.",
    };
  }
  return { kind: "resolved", series: filtered };
}

function effectiveScopeMode(intent: VisualizationIntent): VisualizationScopeMode {
  if (intent.scope_mode !== "auto") return intent.scope_mode ?? "auto";
  if (intent.group_by) return "breakdown";
  if (intent.relationship === "composition" || intent.relationship === "decomposition") {
    return "breakdown";
  }
  return "auto";
}

function scopeAliases(series: RegisteredVisualizationSeries): string[] {
  return [series.scope.kind, series.scope.key, series.scope.label, series.source_label, series.label]
    .filter((value): value is string => Boolean(value))
    .map(normalizeSearch);
}

function matchesGroup(series: RegisteredVisualizationSeries, groupBy: string | null | undefined): boolean {
  if (!groupBy) return true;
  const query = normalizeSearch(groupBy);
  return scopeAliases(series)
    .concat(scopeKindAliases(series.scope.kind))
    .some((alias) => alias === query || alias.includes(query) || query.includes(alias));
}

function scopeKindAliases(kind: string): string[] {
  const normalizedKind = normalizeSearch(kind);
  const aliases: Record<string, string[]> = {
    geography: ["geography", "geographic", "region", "지역", "지역별", "지리"],
    region: ["geography", "geographic", "region", "지역", "지역별", "지리"],
    segment: ["segment", "business", "businessunit", "사업부", "사업부별", "부문", "세그먼트"],
    product: ["product", "productline", "제품", "제품별", "제품군"],
    channel: ["channel", "판매채널", "채널", "채널별"],
  };
  return aliases[normalizedKind]?.map(normalizeSearch) ?? [normalizedKind];
}

function selectAutomaticScope(series: RegisteredVisualizationSeries[]): RegisteredVisualizationSeries[] {
  const groups = new Map<string, RegisteredVisualizationSeries[]>();
  for (const item of series) {
    const key = [item.ticker ?? "", item.canonical_metric ?? item.metric_name ?? item.source_label ?? item.label]
      .map(normalizeSearch)
      .join("|");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const selected: RegisteredVisualizationSeries[] = [];
  for (const candidates of groups.values()) {
    const totals = candidates.filter((item) => item.scope.kind === "company_total");
    if (totals.length > 0) {
      selected.push(totals.sort(compareSeriesCompleteness).at(-1)!);
      continue;
    }
    if (candidates.length === 1) {
      selected.push(candidates[0]!);
      continue;
    }
    return [];
  }
  return selected;
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
  const metricGroups = groupByMetric(matches);
  // A low-capability model may omit measures even when the question names one
  // clear metric. Total and dimensional variants are one semantic metric, so
  // infer it without treating each scope as a separate measure.
  if (metricGroups.length === 1) {
    const representative = metricGroups[0]?.[0];
    if (representative) {
      return [
        representative.canonical_metric ??
          representative.metric_name ??
          representative.source_label ??
          representative.label,
      ];
    }
  }
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
  const displaySeries = applyDisplayLabels(params.series, params.intent);
  const unitGroups = groupByUnit(displaySeries);
  const title = displayTitle(params.intent, displaySeries);
  const entries = Array.from(unitGroups.entries());
  if (entries.length > 1 && !hasIndexTransform(params.series)) {
    warnings.push("서로 다른 단위는 같은 축에 그리지 않고 분리했습니다.");
  }
  const split = entries.length > 1 && !hasIndexTransform(params.series);
  const views = entries.flatMap(([unit, series], index) => {
    const view = buildView({
      viewId: `view_${index + 1}`,
      title: split ? viewTitleForUnit(unit, series, params.intent) : title,
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

function displayTitle(intent: VisualizationIntent, series: VisualizationSeries[]): string {
  const hinted = cleanDisplayText(intent.title_hint, 50);
  if (hinted && isDisplayTitleAcceptable(hinted, intent)) return hinted;

  const ticker = uniqueValues(series.map((item) => item.ticker).filter(Boolean)).at(0);
  const metric = cleanDisplayText(intent.metric_label_hint, 32) ?? metricDisplayLabel(intent, series);
  const group = cleanDisplayText(intent.group_label_hint, 24) ?? groupDisplayLabel(intent, series);
  const subject = [ticker, group, metric].filter(Boolean).join(" ").trim() || "검증된 데이터";
  return `${subject} ${relationshipSuffix(intent.relationship)}`.slice(0, 50);
}

function isDisplayTitleAcceptable(title: string, intent: VisualizationIntent): boolean {
  if (/\||(?:^|\s)(?:segment|scope|series)(?:\s|:|$)/i.test(title)) return false;
  // Korean questions should not surface a model's accidental English raw title
  // when a deterministic Korean construction is available.
  const asksInKorean = /[가-힣]/.test(intent.goal);
  return !asksInKorean || /[가-힣]/.test(title);
}

function metricDisplayLabel(intent: VisualizationIntent, series: VisualizationSeries[]): string {
  const requested = intent.measures?.[0];
  if (requested && /[가-힣]/.test(requested)) return requested;
  const canonical = series[0]?.canonical_metric ?? series[0]?.metric_name ?? requested ?? "지표";
  const normalized = normalizeSearch(canonical);
  const known: Record<string, string> = {
    revenue: "매출",
    sales: "매출",
    operatingincome: "영업이익",
    operatingmargin: "영업이익률",
    grossprofit: "매출총이익",
    grossmargin: "매출총이익률",
    netincome: "순이익",
    freecashflow: "잉여현금흐름",
    capitalexpenditure: "설비투자",
    earningspershare: "주당순이익",
  };
  return known[normalized] ?? cleanDisplayText(requested, 32) ?? cleanDisplayText(series[0]?.source_label, 32) ?? "지표";
}

function groupDisplayLabel(intent: VisualizationIntent, series: VisualizationSeries[]): string | null {
  if (intent.scope_mode !== "breakdown" && !intent.group_by) return null;
  if (intent.group_by && /[가-힣]/.test(intent.group_by)) return intent.group_by;
  const kinds = uniqueValues(series.map((item) => item.scope.kind));
  if (kinds.length !== 1) return null;
  const known: Record<string, string> = {
    geography: "지역별",
    region: "지역별",
    segment: "사업부별",
    product: "제품별",
  };
  return known[kinds[0] ?? ""] ?? null;
}

function relationshipSuffix(relationship: VisualizationIntent["relationship"]): string {
  if (relationship === "comparison") return "비교";
  if (relationship === "composition") return "구성";
  if (relationship === "decomposition") return "분해";
  if (relationship === "exact_values") return "데이터";
  return "추이";
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
    const key = normalizedUnitKey(item.unit);
    const normalized = { ...item, unit: displayUnit(item.unit) };
    groups.set(key, [...(groups.get(key) ?? []), normalized]);
  }
  return groups;
}

function applyDisplayLabels(
  series: VisualizationSeries[],
  intent: VisualizationIntent,
): VisualizationSeries[] {
  const hints = intent.series_label_hints ?? [];
  const tentative = series.map((item) => {
    const hint = hints.find((candidate) => scopeMatchesHint(item, candidate.source));
    return {
      ...item,
      source_label: item.source_label ?? item.label,
      label: hint?.label ?? defaultSeriesLabel(item, series),
    };
  });
  const counts = new Map<string, number>();
  for (const item of tentative) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  return tentative.map((item) => {
    if ((counts.get(item.label) ?? 0) <= 1) return item;
    const ticker = item.ticker?.trim();
    return { ...item, label: ticker ? `${item.label} · ${ticker}` : item.label };
  });
}

function scopeMatchesHint(series: VisualizationSeries, source: string): boolean {
  const query = normalizeSearch(source);
  return [series.scope.key, series.scope.label, series.source_label, series.label]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeSearch(value) === query);
}

function defaultSeriesLabel(series: VisualizationSeries, allSeries: VisualizationSeries[]): string {
  if (series.scope.kind === "company_total") {
    const tickers = uniqueValues(allSeries.map((item) => item.ticker).filter(Boolean));
    return tickers.length > 1 ? series.ticker ?? "회사 전체" : "회사 전체";
  }
  return cleanDisplayText(series.scope.label, 48)
    ?? cleanDisplayText(series.source_label, 48)
    ?? cleanDisplayText(series.label, 48)
    ?? "시리즈";
}

function viewTitleForUnit(
  unit: string,
  series: VisualizationSeries[],
  intent: VisualizationIntent,
): string {
  if (unit === "%") return "비율";
  if (series.every((item) => item.canonical_metric?.includes("margin"))) return "비율";
  if (unit) return "금액";
  return relationshipSuffix(intent.relationship);
}

function normalizedUnitKey(unit: string | null | undefined): string {
  const normalized = unit?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") ?? "";
  if (["%", "percent", "percentage"].includes(normalized)) return "%";
  if (["usd", "us dollar", "us dollars", "$"].includes(normalized)) return "usd";
  return normalized;
}

function displayUnit(unit: string | null | undefined): string | null {
  const key = normalizedUnitKey(unit);
  if (key === "usd") return "USD";
  if (key === "%") return "%";
  return unit?.trim() || null;
}

function cleanDisplayText(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text || text.includes("|") || /(?:^|\s)(?:scope|series)(?:\s|:|$)/i.test(text)) return null;
  return text.slice(0, maxLength);
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function hasIndexTransform(series: VisualizationSeries[]): boolean {
  return series.every((item) => item.unit === "index (first period = 100)");
}

function createSemanticFingerprint(params: {
  intent: VisualizationIntent;
  views: VisualizationView[];
  transforms: VisualizationTransform[];
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      transforms: params.transforms,
      series: params.views.flatMap((view) => view.series.map((series) => ({
        ticker: series.ticker,
        metric: series.canonical_metric ?? series.metric_name,
        scope: [series.scope.kind, series.scope.key],
        unit: normalizedUnitKey(series.unit),
        points: series.points.map((point) => [point.period, point.value, point.evidence_ref]),
      }))).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    }))
    .digest("hex")
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
