import type {
  ResearchArtifactBlock,
  ResearchArtifactEnvelope,
} from "@/types/api-contracts";
import {
  getArtifactEvidenceStatus,
  getArtifactTypeLabel,
  getConfidenceLabel,
  getDirectionLabel,
  getRiskKindLabel,
  getSeverityLabel,
} from "./presentation";

type ExportableArtifact = Pick<
  ResearchArtifactEnvelope,
  "title" | "summary" | "artifact_type"
> & {
  evidence_refs?: ResearchArtifactEnvelope["evidence_refs"];
  quality?: ResearchArtifactEnvelope["quality"];
  blocks?: ResearchArtifactBlock[];
  blocks_json?: ResearchArtifactBlock[];
  source_json?: Record<string, unknown> | null;
  created_at?: string;
};

export function generateArtifactHtml(artifact: ExportableArtifact): string {
  const blockList = artifact.blocks ?? artifact.blocks_json ?? [];
  const blocks = blockList.map(renderBlock).join("\n");
  const evidenceStatus = getArtifactEvidenceStatus({
    artifact_type: artifact.artifact_type,
    quality: artifact.quality ?? { overall: "medium", warnings: [] },
    evidence_refs: artifact.evidence_refs ?? [],
    blocks: blockList,
    blocks_json: blockList,
    source_json: artifact.source_json,
  });
  const generatedAt = artifact.created_at
    ? new Date(artifact.created_at).toLocaleString("ko-KR")
    : new Date().toLocaleString("ko-KR");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(artifact.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #15171c;
      --body: #4c5360;
      --muted: #747d8a;
      --line: #dde2ea;
      --surface: #f7f8fb;
      --canvas: #ffffff;
      --accent: #1f5eff;
      --good: #0f7a4f;
      --bad: #b42318;
      --mixed: #9a6700;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--canvas);
      line-height: 1.55;
    }
    main {
      width: min(980px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 48px 0 64px;
    }
    header {
      border-bottom: 1px solid var(--line);
      margin-bottom: 28px;
      padding-bottom: 24px;
    }
    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .status {
      display: inline-flex;
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    h1 {
      margin: 8px 0 12px;
      font-size: clamp(30px, 5vw, 54px);
      line-height: 1.05;
      letter-spacing: 0;
    }
    .summary {
      max-width: 760px;
      color: var(--body);
      font-size: 18px;
      white-space: pre-line;
    }
    section {
      border-top: 1px solid var(--line);
      padding: 24px 0;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 18px;
    }
    p {
      margin: 0;
      color: var(--body);
      white-space: pre-line;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 14px;
    }
    .label {
      display: block;
      color: var(--ink);
      font-weight: 700;
    }
    .value {
      display: block;
      margin-top: 4px;
      color: var(--ink);
      font-size: 24px;
      font-weight: 700;
      line-height: 1.15;
    }
    .detail, .meta {
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .list {
      display: grid;
      gap: 10px;
      padding: 0;
      margin: 0;
      list-style: none;
    }
    .direction-positive { color: var(--good); }
    .direction-negative { color: var(--bad); }
    .direction-mixed, .direction-uncertain { color: var(--mixed); }
    .timeline {
      display: grid;
      gap: 12px;
    }
    .event {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: 12px;
      border-left: 2px solid var(--line);
      padding-left: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    footer {
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      padding-top: 18px;
    }
    @media (max-width: 640px) {
      main { padding-top: 28px; }
      .event { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; white-space: nowrap; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">${escapeHtml(getArtifactTypeLabel(artifact.artifact_type))}</div>
      <h1>${escapeHtml(artifact.title)}</h1>
      <p class="summary">${escapeHtml(artifact.summary)}</p>
      <div class="status" title="${escapeHtml(evidenceStatus.detail)}">${escapeHtml(evidenceStatus.label)}</div>
    </header>
    ${blocks}
    <footer>Generated by KRW Ontology on ${escapeHtml(generatedAt)}</footer>
  </main>
</body>
</html>`;
}

function renderBlock(block: ResearchArtifactBlock): string {
  switch (block.type) {
    case "markdown":
      return `<section>${renderMarkdownText(block.content)}</section>`;
    case "metric_grid":
      return section(
        block.title,
        `<div class="grid">${block.metrics
          .map(
            (metric) =>
              `<div class="card"><span class="label">${escapeHtml(metric.label)}</span><span class="value">${escapeHtml(
                metric.value,
              )}</span>${renderMeta(
                [metric.period, metric.unit, metric.delta, metric.source_label],
              )}</div>`,
          )
          .join("")}</div>`,
      );
    case "period_delta":
      return section(
        block.title,
        `<ul class="list">${block.changes
          .map(
            (change) =>
              `<li class="card"><span class="label">${escapeHtml(change.label)}</span><p>${escapeHtml(
                `${change.from} -> ${change.to}`,
              )}</p><span class="detail">${escapeHtml(change.interpretation)}</span></li>`,
          )
          .join("")}</ul>`,
      );
    case "business_segments":
      return section(
        block.title,
        `<div class="grid">${block.segments
          .map(
            (segment) =>
              `<div class="card"><span class="label">${escapeHtml(segment.name)}</span><p>${escapeHtml(
                segment.role,
              )}</p><span class="detail">${escapeHtml(segment.why_it_matters)}</span></div>`,
          )
          .join("")}</div>`,
      );
    case "premise_card":
      return section(
        block.title,
        `<ul class="list">${block.premises
          .map(
            (premise) =>
              `<li class="card"><span class="label">${escapeHtml(premise.label)}</span><p>${escapeHtml(
                premise.text,
              )}</p>${renderMeta([premise.source_label])}</li>`,
          )
          .join("")}</ul>`,
      );
    case "impact_channels":
      return section(
        block.title,
        `<ul class="list">${block.channels
          .map(
            (channel) =>
              `<li class="card"><span class="label direction-${escapeHtml(
                channel.direction,
              )}">${escapeHtml(channel.name)} · ${escapeHtml(
                getDirectionLabel(channel.direction),
              )}</span><p>${escapeHtml(channel.mechanism)}</p>${renderMeta([
                channel.affected_metrics?.join(", "),
                getConfidenceLabel(channel.confidence),
              ])}</li>`,
          )
          .join("")}</ul>`,
      );
    case "risk_driver_map":
      return section(
        block.title,
        `<div class="grid">${block.items
          .map(
            (item) =>
              `<div class="card"><span class="label">${escapeHtml(item.label)}</span><p>${escapeHtml(
                item.text,
              )}</p>${renderMeta([
                getRiskKindLabel(item.kind),
                getSeverityLabel(item.severity),
              ])}</div>`,
          )
          .join("")}</div>`,
      );
    case "timeline":
      return section(
        block.title,
        `<div class="timeline">${block.events
          .map(
            (event) =>
              `<div class="event"><span class="meta">${escapeHtml(
                event.date_or_period,
              )}</span><div><span class="label">${escapeHtml(event.label)}</span><p>${escapeHtml(
                event.text,
              )}</p>${renderMeta([event.status])}</div></div>`,
          )
          .join("")}</div>`,
      );
    case "comparison_table":
      return section(
        block.title,
        `<table><thead><tr><th></th>${block.columns
          .map((column) => `<th>${escapeHtml(column)}</th>`)
          .join("")}</tr></thead><tbody>${block.rows
          .map(
            (row) =>
              `<tr><th>${escapeHtml(row.label)}</th>${row.values
                .map((value) => `<td>${escapeHtml(value)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
    case "evidence_chain":
      return section(
        block.title,
        `<ul class="list">${block.chains
          .map(
            (chain) =>
              `<li class="card"><span class="label">${escapeHtml(chain.claim)}</span><p>${escapeHtml(
                chain.chain_steps?.join(" -> ") || chain.source_label,
              )}</p>${renderMeta([
                chain.source_label,
                getConfidenceLabel(chain.confidence),
              ])}</li>`,
          )
          .join("")}</ul>`,
      );
    case "caveat_list":
      return section(
        block.title,
        `<ul class="list">${block.items
          .map(
            (item) =>
              `<li class="card"><span class="label">${escapeHtml(
                getSeverityLabel(item.severity),
              )}</span><p>${escapeHtml(
                item.text,
              )}</p></li>`,
          )
          .join("")}</ul>`,
      );
    case "glossary":
      return section(
        block.title,
        `<div class="grid">${block.terms
          .map(
            (term) =>
              `<div class="card"><span class="label">${escapeHtml(term.term)}</span><p>${escapeHtml(
                term.definition,
              )}</p></div>`,
          )
          .join("")}</div>`,
      );
    default:
      return "";
  }
}

function renderMarkdownText(content: string): string {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const heading = paragraph.match(/^#{1,3}\s+(.+)$/);
      if (heading) return `<h2>${escapeHtml(heading[1] ?? "")}</h2>`;
      if (/^\s*[-*]\s+/m.test(paragraph)) {
        const items = paragraph
          .split("\n")
          .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
          .filter(Boolean)
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${escapeHtml(paragraph)}</p>`;
    })
    .join("\n");
}

function section(title: string, body: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function renderMeta(values: Array<string | null | undefined>): string {
  const text = values.filter(Boolean).join(" · ");
  return text ? `<span class="detail">${escapeHtml(text)}</span>` : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}
