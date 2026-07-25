import type {
  VisualizationCompositionDataset,
  VisualizationDataset,
  VisualizationMatrixDataset,
  VisualizationSeries,
  VisualizationViewType,
  VisualizationXYDataset,
} from "./contracts";

const MAX_COMPOSITION_SLICES = 6;
const MAX_MATRIX_COLUMNS = 12;
const MAX_BRIDGE_PERIODS = 7;
const MIN_SCATTER_POINTS = 3;

export type VisualizationDatasetRecipeResult =
  | {
      kind: "ready";
      dataset: VisualizationDataset;
      warnings: string[];
    }
  | {
      kind: "unsupported";
      explanation: string;
    };

/**
 * Converts already verified series into the small renderer dataset required by
 * each chart family. This is deliberately deterministic: no renderer-facing
 * value, label, or relationship is supplied by the model.
 */
export function buildDatasetForChart(
  chartType: VisualizationViewType,
  series: VisualizationSeries[],
): VisualizationDatasetRecipeResult {
  if (["line", "area", "bar", "stacked_bar", "stacked_100", "table"].includes(chartType)) {
    return { kind: "ready", dataset: { kind: "series" }, warnings: [] };
  }
  if (chartType === "pie" || chartType === "donut") {
    return buildCompositionDataset(series);
  }
  if (chartType === "scatter") {
    return buildXYDataset(series);
  }
  if (chartType === "heatmap") {
    return buildMatrixDataset(series);
  }
  if (chartType === "waterfall") {
    return buildBridgeDataset(series);
  }
  return { kind: "unsupported", explanation: "지원하지 않는 차트 형태입니다." };
}

function buildCompositionDataset(
  series: VisualizationSeries[],
): VisualizationDatasetRecipeResult {
  if (series.length < 2) {
    return unsupported("원형 차트는 둘 이상의 같은 시점 구성 항목이 필요합니다.");
  }
  if (series.length > MAX_COMPOSITION_SLICES) {
    return unsupported(`원형 차트는 모바일에서 최대 ${MAX_COMPOSITION_SLICES}개 항목까지만 안전하게 표시합니다.`);
  }
  const period = latestCommonPeriod(series);
  if (!period) {
    return unsupported("원형 차트에 필요한 동일 시점의 검증된 구성비 데이터를 찾지 못했습니다.");
  }

  const slices = series.flatMap((item) => {
    const point = item.points.find((candidate) => candidate.period === period);
    if (!point || point.value < 0) return [];
    return [{
      id: item.series_key,
      label: item.label,
      value: point.value,
      formatted_value: point.formatted_value,
      evidence_refs: evidenceRefsForPoint(point),
    }];
  });
  if (slices.length !== series.length || slices.reduce((total, slice) => total + slice.value, 0) <= 0) {
    return unsupported("원형 차트에는 같은 시점의 양수 구성값이 모두 필요합니다.");
  }

  const dataset: VisualizationCompositionDataset = {
    kind: "composition",
    period,
    slices,
  };
  return { kind: "ready", dataset, warnings: [] };
}

function buildXYDataset(series: VisualizationSeries[]): VisualizationDatasetRecipeResult {
  const metricGroups = groupByMetric(series);
  if (metricGroups.length === 2) {
    const [xGroup, yGroup] = metricGroups;
    if (xGroup && yGroup) {
      const entityPairs = sharedEntityPairs(xGroup, yGroup);
      const entityPoints = entityPairs.flatMap(({ key, label, xSeries, ySeries }) => {
        const period = latestSharedPeriod(xSeries, ySeries);
        if (!period) return [];
        const x = xSeries.points.find((point) => point.period === period);
        const y = ySeries.points.find((point) => point.period === period);
        if (!x || !y) return [];
        return [{
          id: `${key}:${period}`,
          label,
          x: x.value,
          y: y.value,
          x_formatted_value: x.formatted_value,
          y_formatted_value: y.formatted_value,
          evidence_refs: uniqueEvidenceRefs([...evidenceRefsForPoint(x), ...evidenceRefsForPoint(y)]),
        }];
      });
      if (entityPoints.length >= MIN_SCATTER_POINTS) {
        return {
          kind: "ready",
          dataset: {
            kind: "xy",
            x_label: metricLabel(xGroup[0]!),
            y_label: metricLabel(yGroup[0]! ),
            x_unit: xGroup[0]?.unit ?? null,
            y_unit: yGroup[0]?.unit ?? null,
            points: entityPoints,
          },
          warnings: [],
        };
      }

      // A single company can still show how two verified metrics move together
      // across several matching periods.
      const xSeries = xGroup[0];
      const ySeries = yGroup[0];
      if (xSeries && ySeries) {
        const periodPoints = pairedPeriodPoints(xSeries, ySeries);
        if (periodPoints.length >= MIN_SCATTER_POINTS) {
          return {
            kind: "ready",
            dataset: {
              kind: "xy",
              x_label: metricLabel(xSeries),
              y_label: metricLabel(ySeries),
              x_unit: xSeries.unit ?? null,
              y_unit: ySeries.unit ?? null,
              points: periodPoints,
            },
            warnings: [],
          };
        }
      }
    }
  }

  if (metricGroups.length === 1 && series.length === 2) {
    const [xSeries, ySeries] = series;
    if (xSeries && ySeries) {
      const points = pairedPeriodPoints(xSeries, ySeries);
      if (points.length >= MIN_SCATTER_POINTS) {
        return {
          kind: "ready",
          dataset: {
            kind: "xy",
            x_label: xSeries.label,
            y_label: ySeries.label,
            x_unit: xSeries.unit ?? null,
            y_unit: ySeries.unit ?? null,
            points,
          },
          warnings: [],
        };
      }
    }
  }

  return unsupported("산점도는 두 검증 지표가 같은 기업 또는 기간 단위로 최소 3개 이상 짝지어져야 합니다.");
}

function buildMatrixDataset(
  series: VisualizationSeries[],
): VisualizationDatasetRecipeResult {
  if (series.length < 2) {
    return unsupported("히트맵은 둘 이상의 비교 항목이 필요합니다.");
  }
  const allColumns = Array.from(
    new Set(series.flatMap((item) => item.points.map((point) => point.period))),
  ).sort();
  if (allColumns.length < 2) {
    return unsupported("히트맵은 둘 이상의 기간 또는 비교 열이 필요합니다.");
  }
  const columns = allColumns.slice(-MAX_MATRIX_COLUMNS);
  const rows = series.map((item) => ({
    id: item.series_key,
    label: item.label,
    cells: item.points
      .filter((point) => columns.includes(point.period))
      .map((point) => ({
        column: point.period,
        value: point.value,
        formatted_value: point.formatted_value,
        evidence_refs: evidenceRefsForPoint(point),
      })),
  }));
  const cellCount = rows.reduce((total, row) => total + row.cells.length, 0);
  if (cellCount < 4) {
    return unsupported("히트맵을 만들 만큼 채워진 검증 행렬 데이터가 없습니다.");
  }

  const dataset: VisualizationMatrixDataset = { kind: "matrix", columns, rows };
  return {
    kind: "ready",
    dataset,
    warnings: allColumns.length > columns.length
      ? [`히트맵은 모바일 가독성을 위해 최근 ${MAX_MATRIX_COLUMNS}개 기간만 표시했습니다.`]
      : [],
  };
}

function buildBridgeDataset(
  series: VisualizationSeries[],
): VisualizationDatasetRecipeResult {
  if (series.length !== 1) {
    return unsupported("워터폴은 하나의 검증 시계열에서만 시작값과 증감값을 안전하게 계산합니다.");
  }
  const source = series[0];
  if (!source || source.points.length < 2) {
    return unsupported("워터폴은 둘 이상의 기간 값이 필요합니다.");
  }
  const points = source.points.slice(-MAX_BRIDGE_PERIODS);
  if (points.some((point) => point.value < 0)) {
    return unsupported("워터폴은 음수 잔액이 없는 검증 시계열에서만 안전하게 계산합니다.");
  }
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return unsupported("워터폴을 만들 수 있는 검증 기간 값이 없습니다.");

  const steps = [
    {
      id: `start:${first.period}`,
      label: first.period,
      kind: "start" as const,
      value: first.value,
      formatted_value: first.formatted_value,
      evidence_refs: evidenceRefsForPoint(first),
    },
    ...points.slice(1).map((point, index) => {
      const previous = points[index]!;
      const delta = Number((point.value - previous.value).toFixed(8));
      return {
        id: `change:${previous.period}:${point.period}`,
        label: `${point.period} 증감`,
        kind: delta >= 0 ? "increase" as const : "decrease" as const,
        delta,
        evidence_refs: uniqueEvidenceRefs([
          ...evidenceRefsForPoint(previous),
          ...evidenceRefsForPoint(point),
        ]),
      };
    }),
    {
      id: `end:${last.period}`,
      label: `${last.period} 결과`,
      kind: "end" as const,
      value: last.value,
      formatted_value: last.formatted_value,
      evidence_refs: evidenceRefsForPoint(last),
    },
  ];

  return {
    kind: "ready",
    dataset: { kind: "bridge", steps },
    warnings: source.points.length > points.length
      ? [`워터폴은 최근 ${MAX_BRIDGE_PERIODS}개 기간의 증감만 표시했습니다.`]
      : [],
  };
}

function groupByMetric(series: VisualizationSeries[]): VisualizationSeries[][] {
  const groups = new Map<string, VisualizationSeries[]>();
  for (const item of series) {
    const key = normalize(item.canonical_metric ?? item.metric_name ?? item.source_label ?? item.label);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.values());
}

function sharedEntityPairs(
  xGroup: VisualizationSeries[],
  yGroup: VisualizationSeries[],
): Array<{ key: string; label: string; xSeries: VisualizationSeries; ySeries: VisualizationSeries }> {
  const xByEntity = bestSeriesByEntity(xGroup);
  const yByEntity = bestSeriesByEntity(yGroup);
  return Array.from(xByEntity.entries()).flatMap(([key, xSeries]) => {
    const ySeries = yByEntity.get(key);
    if (!ySeries) return [];
    return [{ key, label: entityLabel(xSeries), xSeries, ySeries }];
  });
}

function bestSeriesByEntity(series: VisualizationSeries[]): Map<string, VisualizationSeries> {
  const result = new Map<string, VisualizationSeries>();
  for (const item of series) {
    const key = entityKey(item);
    const current = result.get(key);
    if (!current || item.points.length > current.points.length) result.set(key, item);
  }
  return result;
}

function entityKey(series: VisualizationSeries): string {
  return normalize(series.ticker ?? `${series.scope.kind}:${series.scope.key}`);
}

function entityLabel(series: VisualizationSeries): string {
  return series.ticker ?? series.scope.label ?? series.scope.key ?? series.label;
}

function pairedPeriodPoints(
  xSeries: VisualizationSeries,
  ySeries: VisualizationSeries,
): VisualizationXYDataset["points"] {
  const yByPeriod = new Map(ySeries.points.map((point) => [point.period, point]));
  return xSeries.points.flatMap((xPoint) => {
    const yPoint = yByPeriod.get(xPoint.period);
    if (!yPoint) return [];
    return [{
      id: `${xSeries.series_key}:${ySeries.series_key}:${xPoint.period}`,
      label: xPoint.period,
      x: xPoint.value,
      y: yPoint.value,
      x_formatted_value: xPoint.formatted_value,
      y_formatted_value: yPoint.formatted_value,
      evidence_refs: uniqueEvidenceRefs([
        ...evidenceRefsForPoint(xPoint),
        ...evidenceRefsForPoint(yPoint),
      ]),
    }];
  });
}

function latestCommonPeriod(series: VisualizationSeries[]): string | null {
  if (series.length === 0) return null;
  const common = new Set(series[0]?.points.map((point) => point.period) ?? []);
  for (const item of series.slice(1)) {
    const periods = new Set(item.points.map((point) => point.period));
    for (const period of common) {
      if (!periods.has(period)) common.delete(period);
    }
  }
  return Array.from(common).sort().at(-1) ?? null;
}

function latestSharedPeriod(left: VisualizationSeries, right: VisualizationSeries): string | null {
  return latestCommonPeriod([left, right]);
}

function metricLabel(series: VisualizationSeries): string {
  return series.canonical_metric ?? series.metric_name ?? series.source_label ?? series.label;
}

function evidenceRefsForPoint(point: VisualizationSeries["points"][number]): string[] {
  return uniqueEvidenceRefs([point.evidence_ref, ...(point.derived_from_evidence_refs ?? [])]);
}

function uniqueEvidenceRefs(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[\s_\-|/()[\]{}.,:;]+/g, "").trim();
}

function unsupported(explanation: string): VisualizationDatasetRecipeResult {
  return { kind: "unsupported", explanation };
}
