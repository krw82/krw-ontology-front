import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_COUNT,
  parseChatAttachmentContent,
  validateChatAttachments,
} from "./attachments";

describe("chat attachments", () => {
  it("parses visible text and attachment metadata with the shared parser", () => {
    const result = parseChatAttachmentContent(
      [
        "요약해줘",
        "",
        "<attached_file name=\"memo&amp;plan.md\">",
        "# Memo",
        "본문",
        "</attached_file>",
      ].join("\n"),
    );

    expect(result.visibleText).toBe("요약해줘");
    expect(result.hasMalformedMarkers).toBe(false);
    expect(result.attachments).toEqual([
      {
        name: "memo&plan.md",
        content: "# Memo\n본문",
        byteLength: new TextEncoder().encode("# Memo\n본문").byteLength,
        characterCount: 9,
      },
    ]);
  });

  it("validates malformed attachment markers even when only a closing tag exists", () => {
    const result = validateChatAttachments("hello\n</attached_file>");

    expect(result).toEqual({
      ok: false,
      message: "첨부 파일 형식이 올바르지 않습니다.",
    });
  });

  it("rejects unsupported extensions and oversized attachments", () => {
    expect(
      validateChatAttachments(
        "<attached_file name=\"filing.pdf\">\ntext\n</attached_file>",
      ),
    ).toEqual({
      ok: false,
      message: "txt 또는 md 파일만 첨부할 수 있습니다.",
    });

    expect(
      validateChatAttachments(
        `<attached_file name=\"note.md\">\n${"a".repeat(
          MAX_CHAT_ATTACHMENT_BYTES + 1,
        )}\n</attached_file>`,
      ),
    ).toEqual({
      ok: false,
      message: `첨부 파일 하나는 ${MAX_CHAT_ATTACHMENT_BYTES.toLocaleString()}바이트를 넘을 수 없습니다.`,
    });
  });

  it("enforces the maximum attachment count", () => {
    const content = Array.from(
      { length: MAX_CHAT_ATTACHMENT_COUNT + 1 },
      (_, index) =>
        `<attached_file name=\"note-${index}.md\">\ntext\n</attached_file>`,
    ).join("\n\n");

    expect(validateChatAttachments(content)).toEqual({
      ok: false,
      message: `첨부 파일은 최대 ${MAX_CHAT_ATTACHMENT_COUNT}개까지 보낼 수 있습니다.`,
    });
  });
});
