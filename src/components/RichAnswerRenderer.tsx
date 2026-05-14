"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import type {
  ResearchArtifact,
  ResearchArtifactBlock,
} from "@/types/api-contracts";
import { generateArtifactHtml } from "@/lib/artifacts/html-export";
import {
  getArtifactBlocks,
  getConfidenceLabel,
  getDirectionLabel,
  getRiskKindLabel,
  getSeverityLabel,
} from "@/lib/artifacts/presentation";

interface RichAnswerRendererProps {
  answer: ResearchArtifact;
  fallbackMarkdown?: string;
}

export default function RichAnswerRenderer({
  answer,
  fallbackMarkdown,
}: RichAnswerRendererProps) {
  const blocks = getDisplayBlocks(getArtifactBlocks(answer), fallbackMarkdown);
  if (blocks.length === 0) return null;

  const exportHtml = () => {
    const html = generateArtifactHtml({
      ...answer,
      blocks,
      blocks_json: blocks,
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(answer.title)}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-md">
      {blocks.map((block, index) => (
        <RichAnswerBlockView key={`${block.type}-${index}`} block={block} />
      ))}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={exportHtml}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface-soft hover:text-ink"
          aria-label="HTML로 내보내기"
          title="HTML로 내보내기"
        >
          <span className="material-symbols-outlined text-[18px]">
            download
          </span>
        </button>
      </div>
    </div>
  );
}

function getDisplayBlocks(
  blocks: ResearchArtifactBlock[],
  fallbackMarkdown?: string,
): ResearchArtifactBlock[] {
  if (blocks.some((block) => block.type === "markdown")) return blocks;
  const fallback = fallbackMarkdown?.trim();
  return fallback
    ? [{ type: "markdown", content: fallback }, ...blocks]
    : blocks;
}

function RichAnswerBlockView({ block }: { block: ResearchArtifactBlock }) {
  switch (block.type) {
    case "markdown":
      return (
        <div className="prose prose-sm max-w-none text-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {block.content}
          </ReactMarkdown>
        </div>
      );
    case "metric_grid":
      return (
        <AnswerSection title={block.title}>
          <div className="grid gap-xs sm:grid-cols-2 lg:grid-cols-3">
            {block.metrics.map((metric, index) => (
              <div
                key={`${metric.label}-${index}`}
                className="rounded-[8px] border border-hairline bg-surface px-sm py-xs"
              >
                <div className="text-[12px] font-semibold uppercase leading-[1.3] tracking-normal text-muted">
                  {metric.label}
                </div>
                <div className="mt-xxs text-[20px] font-semibold leading-[1.2] text-ink">
                  {metric.value}
                </div>
                <MetaLine
                  items={[
                    metric.period,
                    metric.unit,
                    metric.delta,
                    metric.source_label,
                  ]}
                />
              </div>
            ))}
          </div>
        </AnswerSection>
      );
    case "period_delta":
      return (
        <AnswerSection title={block.title}>
          <div className="space-y-xs">
            {block.changes.map((change, index) => (
              <div
                key={`${change.label}-${index}`}
                className="grid gap-xs border-b border-hairline-soft pb-xs last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]"
              >
                <div>
                  <div className="text-[14px] font-semibold text-ink">
                    {change.label}
                  </div>
                  <MetaLine items={[change.direction]} />
                </div>
                <div className="text-[14px] leading-[1.5] text-body">
                  <span className="font-medium text-ink">{change.from}</span>
                  <span className="px-xs text-muted">→</span>
                  <span className="font-medium text-ink">{change.to}</span>
                  <p className="mt-xxs">{change.interpretation}</p>
                </div>
              </div>
            ))}
          </div>
        </AnswerSection>
      );
    case "business_segments":
      return (
        <AnswerSection title={block.title}>
          <div className="grid gap-sm sm:grid-cols-2">
            {block.segments.map((segment) => (
              <div
                key={segment.name}
                className="border-l-2 border-hairline pl-sm"
              >
                <div className="text-[14px] font-semibold text-ink">
                  {segment.name}
                </div>
                <p className="mt-xxs text-[14px] leading-[1.5] text-body">
                  {segment.role}
                </p>
                <p className="mt-xxs text-[13px] leading-[1.45] text-muted">
                  {segment.why_it_matters}
                </p>
              </div>
            ))}
          </div>
        </AnswerSection>
      );
    case "premise_card":
      return (
        <AnswerSection title={block.title}>
          <div className="space-y-xs">
            {block.premises.map((premise, index) => (
              <div
                key={`${premise.label}-${index}`}
                className="rounded-[8px] bg-surface px-sm py-xs"
              >
                <div className="text-[14px] font-semibold text-ink">
                  {premise.label}
                </div>
                <p className="mt-xxs text-[14px] leading-[1.5] text-body">
                  {premise.text}
                </p>
                <MetaLine items={[premise.source_label]} />
              </div>
            ))}
          </div>
        </AnswerSection>
      );
    case "impact_channels":
      return (
        <AnswerSection title={block.title}>
          <div className="space-y-xs">
            {block.channels.map((channel, index) => (
              <div
                key={`${channel.name}-${index}`}
                className="grid gap-xs border-b border-hairline-soft pb-xs last:border-0 last:pb-0 sm:grid-cols-[180px_minmax(0,1fr)]"
              >
                <div>
                  <div className="text-[14px] font-semibold text-ink">
                    {channel.name}
                  </div>
                  <DirectionPill direction={channel.direction} />
                </div>
                <div>
                  <p className="text-[14px] leading-[1.5] text-body">
                    {channel.mechanism}
                  </p>
                  <MetaLine
                    items={[
                      channel.affected_metrics?.join(", "),
                      getConfidenceLabel(channel.confidence),
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </AnswerSection>
      );
    case "risk_driver_map":
      return (
        <AnswerSection title={block.title}>
          <div className="grid gap-xs sm:grid-cols-2">
            {block.items.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                className="rounded-[8px] bg-surface px-sm py-xs"
              >
                <div className="flex flex-wrap items-center gap-xs">
                  <span className="text-[14px] font-semibold text-ink">
                    {item.label}
                  </span>
                  <span className="text-[12px] text-muted">
                    {getRiskKindLabel(item.kind)} · {getSeverityLabel(item.severity)}
                  </span>
                </div>
                <p className="mt-xxs text-[14px] leading-[1.5] text-body">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </AnswerSection>
      );
    case "timeline":
      return (
        <AnswerSection title={block.title}>
          <ol className="space-y-xs">
            {block.events.map((event, index) => (
              <li
                key={`${event.label}-${index}`}
                className="grid gap-xs border-l-2 border-hairline pl-sm sm:grid-cols-[140px_minmax(0,1fr)]"
              >
                <div className="text-[13px] font-semibold text-muted">
                  {event.date_or_period}
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-ink">
                    {event.label}
                  </div>
                  <p className="mt-xxs text-[14px] leading-[1.5] text-body">
                    {event.text}
                  </p>
                  <MetaLine items={[event.status]} />
                </div>
              </li>
            ))}
          </ol>
        </AnswerSection>
      );
    case "comparison_table":
      return (
        <AnswerSection title={block.title}>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-[13px] leading-[1.45]">
              <thead>
                <tr className="border-b border-hairline text-left text-muted">
                  <th className="py-xs pr-sm font-semibold">항목</th>
                  {block.columns.map((column) => (
                    <th key={column} className="py-xs pr-sm font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, index) => (
                  <tr
                    key={`${row.label}-${index}`}
                    className="border-b border-hairline-soft last:border-0"
                  >
                    <th className="py-xs pr-sm text-left font-semibold text-ink">
                      {row.label}
                    </th>
                    {row.values.map((value, valueIndex) => (
                      <td key={valueIndex} className="py-xs pr-sm text-body">
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AnswerSection>
      );
    case "evidence_chain":
      return (
        <AnswerSection title={block.title}>
          <details className="rounded-[8px] bg-surface px-sm py-xs">
            <summary className="cursor-pointer text-[14px] font-semibold text-ink">
              근거 체인
            </summary>
            <div className="mt-sm space-y-sm">
              {block.chains.map((chain, index) => (
                <div
                  key={`${chain.claim}-${index}`}
                  className="border-l-2 border-hairline pl-sm"
                >
                  <div className="text-[14px] font-semibold text-ink">
                    {chain.claim}
                  </div>
                  <MetaLine
                    items={[chain.source_label, getConfidenceLabel(chain.confidence)]}
                  />
                  {chain.chain_steps && chain.chain_steps.length > 0 && (
                    <p className="mt-xxs text-[13px] leading-[1.45] text-body">
                      {chain.chain_steps.join(" → ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        </AnswerSection>
      );
    case "caveat_list":
      return (
        <AnswerSection title={block.title}>
          <ul className="space-y-xs">
            {block.items.map((item, index) => (
              <li
                key={index}
                className="flex gap-xs text-[14px] leading-[1.5] text-body"
              >
                <span className="material-symbols-outlined mt-[1px] text-[16px] text-muted">
                  {item.severity === "critical" ? "priority_high" : "info"}
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </AnswerSection>
      );
    case "glossary":
      return (
        <AnswerSection title={block.title}>
          <dl className="grid gap-xs sm:grid-cols-2">
            {block.terms.map((term) => (
              <div key={term.term}>
                <dt className="text-[14px] font-semibold text-ink">
                  {term.term}
                </dt>
                <dd className="mt-xxs text-[13px] leading-[1.45] text-body">
                  {term.definition}
                </dd>
              </div>
            ))}
          </dl>
        </AnswerSection>
      );
  }
}

function AnswerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="my-md">
      <h4 className="mb-xs text-[13px] font-semibold uppercase leading-[1.3] tracking-normal text-muted">
        {title}
      </h4>
      {children}
    </section>
  );
}

function DirectionPill({ direction }: { direction: string }) {
  const color =
    direction === "positive"
      ? "text-semantic-up"
      : direction === "negative"
        ? "text-error"
        : "text-muted";
  return (
    <span className={`text-[12px] font-semibold ${color}`}>
      {getDirectionLabel(direction)}
    </span>
  );
}

function MetaLine({ items }: { items: Array<string | null | undefined> }) {
  const text = items.filter(Boolean).join(" · ");
  if (!text) return null;
  return (
    <div className="mt-xxs text-[12px] leading-[1.4] text-muted">
      {text}
    </div>
  );
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "rich-answer"
  );
}
