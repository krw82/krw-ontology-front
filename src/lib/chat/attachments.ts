import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_COUNT,
} from "@/lib/chat-limits";

export { MAX_CHAT_ATTACHMENT_BYTES, MAX_CHAT_ATTACHMENT_COUNT };

const ATTACHMENT_PATTERN =
  /<attached_file name="([^"]{1,200})">\n([\s\S]*?)\n<\/attached_file>/g;
const ATTACHMENT_MARKER_PATTERN = /<\/?attached_file\b/;
const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);

export interface ParsedChatAttachment {
  name: string;
  content: string;
  byteLength: number;
}

export type AttachmentValidationResult =
  | { ok: true; attachments: ParsedChatAttachment[] }
  | { ok: false; message: string };

export function hasChatAttachments(content: string): boolean {
  return content.includes("<attached_file");
}

export function validateChatAttachments(
  content: string,
): AttachmentValidationResult {
  if (!hasChatAttachments(content)) {
    return { ok: true, attachments: [] };
  }

  const attachments: ParsedChatAttachment[] = [];
  let stripped = content;
  let match: RegExpExecArray | null;

  ATTACHMENT_PATTERN.lastIndex = 0;
  while ((match = ATTACHMENT_PATTERN.exec(content)) !== null) {
    const [block, rawName, attachmentContent] = match;
    stripped = stripped.replace(block, "");

    const name = decodeAttachmentName(rawName).trim();
    if (!isSafeAttachmentName(name)) {
      return { ok: false, message: "첨부 파일 이름이 올바르지 않습니다." };
    }

    if (!hasAllowedExtension(name)) {
      return { ok: false, message: "txt 또는 md 파일만 첨부할 수 있습니다." };
    }

    const byteLength = Buffer.byteLength(attachmentContent, "utf8");
    if (byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
      return {
        ok: false,
        message: `첨부 파일 하나는 ${MAX_CHAT_ATTACHMENT_BYTES.toLocaleString()}바이트를 넘을 수 없습니다.`,
      };
    }

    attachments.push({ name, content: attachmentContent, byteLength });
  }

  if (ATTACHMENT_MARKER_PATTERN.test(stripped)) {
    return { ok: false, message: "첨부 파일 형식이 올바르지 않습니다." };
  }

  if (attachments.length === 0) {
    return { ok: false, message: "첨부 파일 형식이 올바르지 않습니다." };
  }

  if (attachments.length > MAX_CHAT_ATTACHMENT_COUNT) {
    return {
      ok: false,
      message: `첨부 파일은 최대 ${MAX_CHAT_ATTACHMENT_COUNT}개까지 보낼 수 있습니다.`,
    };
  }

  return { ok: true, attachments };
}

function decodeAttachmentName(name: string): string {
  return name
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isSafeAttachmentName(name: string): boolean {
  if (!name || name.length > 160) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return false;
  }
  return !/[<>"]/g.test(name);
}

function hasAllowedExtension(name: string): boolean {
  const normalized = name.toLowerCase();
  return Array.from(ALLOWED_EXTENSIONS).some((extension) =>
    normalized.endsWith(extension),
  );
}
