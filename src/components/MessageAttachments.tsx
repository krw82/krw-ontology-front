import type { ParsedChatAttachment } from "@/lib/chat/attachments";

export interface MessageAttachmentFile {
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

interface MessageAttachmentsProps {
  urls?: string[];
  files?: MessageAttachmentFile[];
  align?: "start" | "end";
  variant?: "chip" | "icon";
  className?: string;
}

export function userUrlsFromMessageMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  const urls = metadata?.user_urls;
  if (!Array.isArray(urls)) return [];

  return normalizeUserUrls(urls);
}

export function normalizeUserUrls(values: unknown[]): string[] {
  return values
    .filter((url): url is string => typeof url === "string")
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 3);
}

export function filesFromParsedAttachments(
  attachments: ParsedChatAttachment[],
): MessageAttachmentFile[] {
  return attachments.map((attachment) => ({
    name: attachment.name,
    size: attachment.byteLength,
  }));
}

export default function MessageAttachments({
  urls = [],
  files = [],
  align = "end",
  variant = "chip",
  className,
}: MessageAttachmentsProps) {
  const safeUrls = normalizeUserUrls(urls);
  const safeFiles = files
    .map((file) => ({
      ...file,
      name: file.name.trim(),
    }))
    .filter((file) => file.name.length > 0)
    .slice(0, 6);

  if (safeUrls.length === 0 && safeFiles.length === 0) return null;

  if (variant === "icon") {
    return (
      <div
        className={[
          "flex max-w-full flex-nowrap gap-xs overflow-x-auto",
          align === "end" ? "justify-end" : "justify-start",
          className ?? "",
        ].join(" ")}
      >
        {safeUrls.map((url, index) => {
          const display = urlDisplayParts(url);

          return (
            <a
              key={`${url}-${index}`}
              href={url}
              target="_blank"
              rel="noreferrer"
              title={`URL 자료 열기: ${display.shortUrl}`}
              aria-label={`URL 자료 열기: ${display.shortUrl}`}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-hairline bg-canvas text-primary shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-colors hover:border-primary-fixed-dim hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[18px]"
              >
                link
              </span>
            </a>
          );
        })}
        {safeFiles.map((file, index) => {
          const label =
            typeof file.size === "number" && file.size > 0
              ? `첨부 파일: ${file.name}, ${formatBytes(file.size)}`
              : `첨부 파일: ${file.name}`;

          return (
            <div
              key={`${file.name}-${index}`}
              role="img"
              title={label}
              aria-label={label}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-hairline bg-canvas text-primary-container shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[18px]"
              >
                {attachmentIcon(file.mimeType, file.name)}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={[
        "flex max-w-full flex-col gap-xs",
        align === "end" ? "items-end" : "items-start",
        className ?? "",
      ].join(" ")}
    >
      {safeUrls.map((url, index) => {
        const display = urlDisplayParts(url);

        return (
          <a
            key={`${url}-${index}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex max-w-full items-center gap-xs rounded-[8px] border border-hairline bg-canvas px-sm py-xs text-left text-[12px] leading-none text-body transition-colors hover:border-primary-fixed-dim hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`URL 자료 열기: ${display.shortUrl}`}
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined shrink-0 text-[16px] text-primary"
            >
              link
            </span>
            <span className="min-w-0 max-w-[190px] truncate font-bold text-body sm:max-w-[280px]">
              {display.host}
            </span>
            <span className="hidden shrink-0 text-muted sm:inline">·</span>
            <span className="hidden min-w-0 max-w-[260px] truncate text-muted md:inline">
              {display.shortUrl}
            </span>
          </a>
        );
      })}
      {safeFiles.length > 0 ? (
        <div
          className={[
            "flex max-w-full flex-wrap gap-xs",
            align === "end" ? "justify-end" : "justify-start",
          ].join(" ")}
        >
          {safeFiles.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="inline-flex max-w-full items-center gap-xs rounded-[8px] border border-hairline bg-canvas px-sm py-xs text-[12px] font-semibold leading-none text-body"
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[16px] text-primary-container"
              >
                {attachmentIcon(file.mimeType, file.name)}
              </span>
              <span className="max-w-[180px] truncate text-ink sm:max-w-[240px]">
                {file.name}
              </span>
              {typeof file.size === "number" && file.size > 0 ? (
                <span className="text-muted-soft">{formatBytes(file.size)}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function urlDisplayParts(url: string): { host: string; shortUrl: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    return {
      host: host || "URL",
      shortUrl: path ? `${host}${path}` : host,
    };
  } catch {
    return { host: "URL", shortUrl: url };
  }
}

function attachmentIcon(mimeType: string | null | undefined, name: string) {
  const normalizedMime = mimeType?.toLowerCase() ?? "";
  const normalizedName = name.toLowerCase();
  if (normalizedMime.includes("pdf") || normalizedName.endsWith(".pdf")) {
    return "picture_as_pdf";
  }
  return "description";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
