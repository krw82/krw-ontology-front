"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface ResearchMarkdownProps {
  content: string;
  className?: string;
}

const RESEARCH_MARKDOWN_COMPONENTS = {
  h1: ({ children }) => (
    <h1 className="mb-sm mt-lg text-[24px] font-black leading-[1.16] tracking-normal text-ink first:mt-0 sm:text-[30px]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-xs mt-xl border-t border-hairline pt-md text-[20px] font-extrabold leading-[1.24] tracking-normal text-ink first:mt-0 first:border-t-0 first:pt-0 sm:text-[23px]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-xs mt-lg text-[17px] font-extrabold leading-[1.3] tracking-normal text-ink first:mt-0 sm:text-[19px]">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-xxs mt-md text-[15px] font-extrabold leading-[1.35] tracking-normal text-ink first:mt-0 sm:text-[16px]">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-sm text-[15px] leading-[1.78] text-body first:mt-0 last:mb-0 sm:text-[16px]">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-sm list-disc space-y-2 pl-5 text-[15px] leading-[1.72] text-body marker:text-muted sm:text-[16px]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-sm list-decimal space-y-2 pl-5 text-[15px] leading-[1.72] text-body marker:text-muted sm:text-[16px]">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-1 marker:text-muted [&>ol]:mt-2 [&>p]:my-0 [&>ul]:mt-2">
      {children}
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-extrabold text-ink">{children}</strong>
  ),
  em: ({ children }) => <em className="text-body">{children}</em>,
  a: ({ children, href }) => (
    <a
      className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-md border-l-[3px] border-primary/45 pl-sm text-body [&>p]:my-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded-[6px] bg-surface px-1.5 py-0.5 font-mono text-[0.88em] font-semibold text-ink">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-md max-w-full overflow-x-auto rounded-[8px] border border-hairline bg-surface p-sm text-[13px] leading-[1.6] text-ink">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-md max-w-full overflow-x-auto rounded-[8px] border border-hairline bg-canvas">
      <table className="w-full min-w-[620px] border-collapse text-left text-[13px] leading-[1.48] sm:text-[14px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-hairline bg-surface">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-sm py-xs font-extrabold text-ink">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-hairline-soft px-sm py-xs align-top text-body last:border-r-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-lg border-hairline" />,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="my-md h-auto max-w-full rounded-[8px] border border-hairline"
      src={src ?? ""}
      alt={alt ?? ""}
    />
  ),
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
}: ResearchMarkdownProps) {
  const classes = [
    "w-full max-w-[780px] break-words text-body",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={RESEARCH_MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
