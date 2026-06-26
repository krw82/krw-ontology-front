"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import KrwChartCard from "@/components/KrwChartCard";
import { normalizeTicker } from "@/lib/ontology/ticker";
import type { ChatMessageChart } from "@/types/api-contracts";

interface ResearchMarkdownProps {
  content: string;
  className?: string;
  normalizePlainText?: boolean;
  charts?: ChatMessageChart[];
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const UNSAFE_URL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const CHART_TOKEN_PATTERN = /\[\[krw-chart:([A-Za-z0-9_-]+)\]\]/g;
const CHART_TOKEN_LINE_PATTERN = /^\s*\[\[krw-chart:[A-Za-z0-9_-]+\]\]\s*$/;
const FENCE_START_PATTERN = /^\s*(```|~~~)/;
const MARKDOWN_BLOCK_PATTERN =
  /^\s*(#{1,6}\s|[-*+]\s+|\d+[.)]\s+|>\s|---+$|\|)/;
const LIST_INTRO_PATTERN =
  /(질문|행보|체크포인트|포인트|변수|리스크|근거|항목|전략|요약|목록)\s*[:：]?$/;
const HEADING_START_PATTERN =
  /^(종합 평가|다음으로|요약|결론|핵심|투자 체크포인트|체크포인트|파이프라인|미용의학|종양학|이뮤놀로지|사업|리스크|현금흐름|매출|비용|밸류에이션|경쟁|시나리오|근거|자료|판단)/;
const SENTENCE_END_PATTERN =
  /([.!。！？]|다\.?|니다\.?|습니다\.?|입니다\.?|합니다\.?|됩니다\.?|했습니다\.?|있습니다\.?|없습니다\.?|보입니다\.?)$/;
const QUESTION_END_PATTERN = /([?？]|나요\??|인가요\??|까요\??|습니까\??)$/;

function getSafeMarkdownUrl(
  value: unknown,
  allowedProtocols: Set<string>,
): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value?.trim();
  if (!trimmed || UNSAFE_URL_CHARACTERS.test(trimmed)) return undefined;

  if (trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("/")) {
    return trimmed.startsWith("//") ? undefined : trimmed;
  }

  try {
    const url = new URL(trimmed);
    return allowedProtocols.has(url.protocol) ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export function getSafeMarkdownHref(
  href: unknown,
): string | undefined {
  const safeHref = getSafeMarkdownUrl(href, SAFE_LINK_PROTOCOLS);
  return safeHref && !hasInvalidCompanyTicker(safeHref) ? safeHref : undefined;
}

export function getSafeMarkdownImageSrc(
  src: unknown,
): string | undefined {
  return getSafeMarkdownUrl(src, SAFE_IMAGE_PROTOCOLS);
}

function hasInvalidCompanyTicker(href: string): boolean {
  try {
    const url = new URL(href, "https://krwontology.local");
    const match = url.pathname.match(
      /^\/(?:[a-z]{2}\/)?companies\/([^/]+)\/?$/i,
    );
    if (!match?.[1]) return false;
    return !normalizeTicker(decodeURIComponent(match[1]));
  } catch {
    return true;
  }
}

function isExistingMarkdownBlock(line: string): boolean {
  return MARKDOWN_BLOCK_PATTERN.test(line);
}

function endsLikeSentence(line: string): boolean {
  return SENTENCE_END_PATTERN.test(line);
}

function isQuestionLine(line: string): boolean {
  return QUESTION_END_PATTERN.test(line);
}

function isListIntro(line: string): boolean {
  return LIST_INTRO_PATTERN.test(line) || /^다음으로/.test(line);
}

function findNextNonBlank(lines: string[], startIndex: number): string | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";
    if (trimmed) return trimmed;
  }
  return null;
}

function isLikelyPlainHeading(lines: string[], index: number): boolean {
  const line = lines[index]?.trim() ?? "";
  if (!line || line.length > 56) return false;
  if (isExistingMarkdownBlock(line) || FENCE_START_PATTERN.test(line)) return false;
  if (line.includes("://") || line.endsWith(":") || line.endsWith("：")) {
    return false;
  }
  if (endsLikeSentence(line) || isQuestionLine(line)) return false;

  const next = findNextNonBlank(lines, index + 1);
  if (!next || FENCE_START_PATTERN.test(next)) return false;

  return HEADING_START_PATTERN.test(line) || line.includes(":") || line.includes("：");
}

function isBareListItem(line: string): boolean {
  if (!line || line.length > 180) return false;
  if (isExistingMarkdownBlock(line) || FENCE_START_PATTERN.test(line)) return false;
  if (line.endsWith(":") || line.endsWith("：")) return false;
  if (isQuestionLine(line)) return true;
  return !endsLikeSentence(line);
}

function pushBlankLine(output: string[]): void {
  if (output.length > 0 && output[output.length - 1] !== "") {
    output.push("");
  }
}

function collapseBlankLines(lines: string[]): string[] {
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === "" && collapsed[collapsed.length - 1] === "") continue;
    collapsed.push(line);
  }
  return collapsed;
}

export function normalizeResearchMarkdown(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const output: string[] = [];
  let inFence = false;
  let pendingBareList = false;
  let activeBareList = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();

    if (FENCE_START_PATTERN.test(line)) {
      inFence = !inFence;
      output.push(rawLine);
      pendingBareList = false;
      activeBareList = false;
      continue;
    }

    if (inFence) {
      output.push(rawLine);
      continue;
    }

    if (!line) {
      output.push("");
      continue;
    }

    if (CHART_TOKEN_LINE_PATTERN.test(line)) {
      pushBlankLine(output);
      output.push(rawLine);
      output.push("");
      pendingBareList = false;
      activeBareList = false;
      continue;
    }

    if ((pendingBareList || activeBareList) && isBareListItem(line)) {
      output.push(`- ${line}`);
      pendingBareList = false;
      activeBareList = true;
      continue;
    }

    activeBareList = false;

    if (isLikelyPlainHeading(lines, index)) {
      pushBlankLine(output);
      output.push(`### ${line}`);
      output.push("");
      pendingBareList = isListIntro(line);
      continue;
    }

    output.push(rawLine);
    pendingBareList = isListIntro(line);
  }

  return collapseBlankLines(output).join("\n").trim();
}

const RESEARCH_MARKDOWN_COMPONENTS = {
  h1: ({ children }) => (
    <h1 className="mb-sm mt-lg text-[22px] font-extrabold leading-[1.2] tracking-normal text-ink first:mt-0 sm:mb-md sm:mt-xl sm:text-[30px] sm:font-black sm:leading-[1.16]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-xs mt-xl border-t border-hairline pt-md text-[18px] font-extrabold leading-[1.32] tracking-normal text-ink first:mt-0 first:border-t-0 first:pt-0 sm:mb-sm sm:mt-xxl sm:pt-lg sm:text-[23px] sm:font-black sm:leading-[1.24]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-xs mt-lg text-[16px] font-extrabold leading-[1.38] tracking-normal text-ink first:mt-0 sm:mb-sm sm:mt-xl sm:text-[19px] sm:font-black sm:leading-[1.32]">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-md text-[14px] font-extrabold leading-[1.42] tracking-normal text-ink first:mt-0 sm:mb-xs sm:mt-lg sm:text-[16px] sm:font-black sm:leading-[1.38]">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mb-[0.8rem] mt-0 text-[15px] leading-[1.68] text-body [text-wrap:pretty] first:mt-0 last:mb-0 sm:mb-[0.95rem] sm:text-[16px] sm:leading-[1.8]">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-[0.85rem] mt-[0.25rem] list-disc space-y-2 pl-5 text-[15px] leading-[1.66] text-body marker:text-primary/65 sm:mb-[1.05rem] sm:mt-[0.35rem] sm:space-y-2.5 sm:pl-6 sm:text-[16px] sm:leading-[1.78]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-[0.85rem] mt-[0.25rem] list-decimal space-y-2 pl-5 text-[15px] leading-[1.66] text-body marker:font-bold marker:text-primary/65 sm:mb-[1.05rem] sm:mt-[0.35rem] sm:space-y-2.5 sm:pl-6 sm:text-[16px] sm:leading-[1.78]">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-0.5 marker:text-muted sm:pl-1.5 [&>ol]:mb-0 [&>ol]:mt-2 [&>p]:mb-1 [&>p]:mt-0 [&>ul]:mb-0 [&>ul]:mt-2">
      {children}
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-extrabold text-ink sm:font-black">{children}</strong>
  ),
  em: ({ children }) => <em className="text-body">{children}</em>,
  a: ({ children, href }) => {
    const safeHref = getSafeMarkdownHref(href);
    if (!safeHref) {
      return <span className="font-semibold text-ink">{children}</span>;
    }

    return (
      <a
        className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
        href={safeHref}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-lg border-l-[3px] border-primary/55 bg-surface/70 py-xs pl-sm pr-sm text-body [&>p]:my-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded-[6px] bg-surface px-1.5 py-0.5 font-mono text-[0.88em] font-semibold text-ink">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-lg max-w-full overflow-x-auto rounded-[8px] border border-hairline bg-surface p-md text-[13px] leading-[1.65] text-ink">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-lg max-w-full overflow-x-auto rounded-[8px] border border-hairline bg-canvas">
      <table className="w-full min-w-[560px] border-collapse text-left text-[13px] leading-[1.58] sm:min-w-[640px] sm:text-[14px] sm:leading-[1.62]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-hairline bg-surface">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-md py-sm font-black text-ink">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-hairline-soft px-md py-sm align-top text-body last:border-r-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-xl border-hairline" />,
  img: ({ src, alt }) => {
    const safeSrc = getSafeMarkdownImageSrc(src);
    if (!safeSrc) return null;

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="my-md h-auto max-w-full rounded-[8px] border border-hairline"
        src={safeSrc}
        alt={alt ?? ""}
      />
    );
  },
  input: ({ checked, type }) => (
    <input
      className="mr-2 align-middle accent-primary"
      type={type}
      checked={checked}
      readOnly
    />
  ),
} satisfies Components;

export default function ResearchMarkdown({
  content,
  className,
  normalizePlainText = true,
  charts = [],
}: ResearchMarkdownProps) {
  const classes = [
    "w-full max-w-[820px] break-words text-body",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const markdownContent = normalizePlainText
    ? normalizeResearchMarkdown(content)
    : content;
  const parts = splitChartTokens(markdownContent);
  const chartsByRef = new Map<string, ChatMessageChart>();
  for (const chart of charts) {
    chartsByRef.set(chart.chart_ref, chart);
    chartsByRef.set(chart.insert_token, chart);
    chartsByRef.set(chart.id, chart);
  }

  return (
    <div className={classes}>
      {parts.map((part, index) => {
        if (part.type === "chart") {
          const chart = chartsByRef.get(part.ref);
          return chart ? <KrwChartCard key={`${part.ref}-${index}`} chart={chart} /> : null;
        }

        if (!part.content.trim()) return null;
        return (
          <ReactMarkdown
            key={`markdown-${index}`}
            remarkPlugins={[remarkGfm]}
            components={RESEARCH_MARKDOWN_COMPONENTS}
          >
            {part.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}

function splitChartTokens(
  content: string,
): Array<{ type: "markdown"; content: string } | { type: "chart"; ref: string }> {
  const parts: Array<
    { type: "markdown"; content: string } | { type: "chart"; ref: string }
  > = [];
  let lastIndex = 0;

  for (const match of content.matchAll(CHART_TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      parts.push({
        type: "markdown",
        content: content.slice(lastIndex, matchIndex),
      });
    }
    parts.push({
      type: "chart",
      ref: match[1] ?? "",
    });
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({
      type: "markdown",
      content: content.slice(lastIndex),
    });
  }

  return parts.length > 0 ? parts : [{ type: "markdown", content }];
}
