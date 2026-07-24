import type {
  KrwVisualizationArtifact,
  PresentationBlock,
} from "./contracts";

const LEGACY_CHART_TOKEN = /\[\[krw-chart:[A-Za-z0-9_-]+\]\]/g;

/**
 * Converts a final Markdown answer and created artifacts into stable render
 * blocks. Models never need to emit an artifact placeholder.
 */
export function buildPresentationBlocks(params: {
  content: string;
  visualizations: KrwVisualizationArtifact[];
}): PresentationBlock[] {
  const markdownBlocks = splitMarkdownBlocks(stripLegacyChartTokens(params.content));
  const insertions = new Map<number, KrwVisualizationArtifact[]>();

  for (const visualization of params.visualizations) {
    const index = placementIndex(markdownBlocks, visualization);
    insertions.set(index, [...(insertions.get(index) ?? []), visualization]);
  }

  const blocks: PresentationBlock[] = [];
  markdownBlocks.forEach((content, index) => {
    blocks.push({ id: `markdown_${index + 1}`, type: "markdown", content });
    for (const visualization of insertions.get(index) ?? []) {
      blocks.push({
        id: `visualization_${visualization.artifact_ref}`,
        type: "visualization",
        artifact_ref: visualization.artifact_ref,
      });
    }
  });

  if (markdownBlocks.length === 0) {
    for (const visualization of params.visualizations) {
      blocks.push({
        id: `visualization_${visualization.artifact_ref}`,
        type: "visualization",
        artifact_ref: visualization.artifact_ref,
      });
    }
  }
  return blocks;
}

export function stripLegacyChartTokens(content: string): string {
  return content
    .replace(LEGACY_CHART_TOKEN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitMarkdownBlocks(content: string): string[] {
  if (!content.trim()) return [];
  const blocks: string[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    const value = current.join("\n").trim();
    if (value) blocks.push(value);
    current = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && !line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

function placementIndex(
  markdownBlocks: string[],
  visualization: KrwVisualizationArtifact,
): number {
  if (markdownBlocks.length === 0) return -1;
  const keywords = visualizationKeywords(visualization);
  let bestIndex = markdownBlocks.length - 1;
  let bestScore = 0;

  for (let index = 0; index < markdownBlocks.length; index += 1) {
    const score = scoreMarkdownBlock(markdownBlocks[index] ?? "", keywords);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  // A chart without an unambiguous textual anchor belongs after the answer,
  // never before its conclusion or source context.
  return bestScore > 0 ? bestIndex : markdownBlocks.length - 1;
}

function visualizationKeywords(visualization: KrwVisualizationArtifact): string[] {
  const raw = [
    visualization.title,
    visualization.intent.goal,
    ...visualization.views.flatMap((view) => [
      view.title,
      ...view.series.flatMap((series) => [
        series.label,
        series.metric_name ?? "",
        series.canonical_metric ?? "",
      ]),
    ]),
  ];
  return Array.from(
    new Set(
      raw
        .flatMap((value) => value.split(/[\s·,:/()\-]+/))
        .map(normalize)
        .filter((value) => value.length >= 2),
    ),
  );
}

function scoreMarkdownBlock(content: string, keywords: string[]): number {
  const normalized = normalize(content);
  return keywords.reduce(
    (score, keyword) => score + (normalized.includes(keyword) ? 1 : 0),
    0,
  );
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[\s_\-|/()[\]{}.,:;]+/g, "")
    .trim();
}
