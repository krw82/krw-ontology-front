"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_PAYLOAD_CHARS,
} from "@/lib/chat-limits";

interface ComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  initialValue?: string;
}

interface TextAttachment {
  id: string;
  name: string;
  content: string;
  size: number;
}

const ACCEPTED_TEXT_FILE_TYPES =
  ".txt,.md,.markdown,text/plain,text/markdown,text/x-markdown";

function isAcceptedTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.type === "text/x-markdown"
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeAttachmentName(name: string): string {
  return name.replace(/["&<>]/g, (char) => {
    if (char === "\"") return "&quot;";
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    return "&gt;";
  });
}

function composeMessage(message: string, attachments: TextAttachment[]): string {
  const attachmentBlocks = attachments.map(
    (file) =>
      `<attached_file name="${escapeAttachmentName(file.name)}">\n${file.content.trimEnd()}\n</attached_file>`,
  );

  return [message.trim(), ...attachmentBlocks].filter(Boolean).join("\n\n");
}

export default function Composer({
  onSend,
  disabled = false,
  placeholder = "후속 질문이나 심층 분석을 요청하세요...",
  initialValue,
}: ComposerProps) {
  const initialDraftValue = initialValue?.trim() ? "" : (initialValue ?? "");
  const [value, setValue] = useState(initialDraftValue);
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAutoSent = useRef(false);

  const composedLength = useMemo(
    () => composeMessage(value, attachments).length,
    [attachments, value],
  );
  const payloadLimit =
    attachments.length > 0 ? MAX_CHAT_PAYLOAD_CHARS : MAX_CHAT_MESSAGE_CHARS;
  const isOverLimit = composedLength > payloadLimit;

  const syncTextareaValue = useCallback((nextValue: string) => {
    setValue(nextValue);
  }, []);

  const readTextareaValue = useCallback(() => {
    return textareaRef.current?.value ?? value;
  }, [value]);

  useEffect(() => {
    if (hasAutoSent.current) return;
    if (disabled) return;
    if (initialValue?.trim()) {
      hasAutoSent.current = true;
      onSend(initialValue);
    }
  }, [disabled, initialValue, onSend]);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setAttachmentError(null);

    const invalidFile = files.find((file) => !isAcceptedTextFile(file));
    if (invalidFile) {
      setAttachmentError("txt 또는 md 파일만 첨부할 수 있습니다.");
      return;
    }

    try {
      const loadedFiles = await Promise.all(
        files.map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          content: await file.text(),
          size: file.size,
        })),
      );
      const nextAttachments = [...attachments, ...loadedFiles];
      const nextMessage = composeMessage(value, nextAttachments);

      if (nextMessage.length > MAX_CHAT_PAYLOAD_CHARS) {
        setAttachmentError(
          `첨부 포함 메시지는 ${MAX_CHAT_PAYLOAD_CHARS.toLocaleString()}자를 넘을 수 없습니다.`,
        );
        return;
      }

      setAttachments(nextAttachments);
    } catch {
      setAttachmentError("파일을 읽지 못했습니다.");
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((file) => file.id !== id));
    setAttachmentError(null);
  };

  const handleSubmit = () => {
    const latestValue = readTextareaValue();
    if (latestValue !== value) {
      setValue(latestValue);
    }

    const message = composeMessage(latestValue, attachments);
    if (!message.trim() || disabled) return;
    if (message.length > payloadLimit) {
      setAttachmentError(
        `첨부 포함 메시지는 ${payloadLimit.toLocaleString()}자를 넘을 수 없습니다.`,
      );
      return;
    }

    onSend(message);
    setValue("");
    setAttachments([]);
    setAttachmentError(null);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-hairline bg-canvas/95 px-base py-sm backdrop-blur-xl sm:px-lg sm:py-base">
      {(attachments.length > 0 || attachmentError) && (
        <div className="mx-auto mb-xs flex max-w-3xl flex-wrap items-center gap-xs">
          {attachments.map((file) => (
            <div
              key={file.id}
              className="inline-flex max-w-full items-center gap-xs rounded-full border border-hairline bg-surface-soft px-sm py-xxs text-[12px] leading-[1.4] text-body"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">
                description
              </span>
              <span className="max-w-[160px] truncate sm:max-w-[220px]">{file.name}</span>
              <span className="text-muted-soft">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="rounded-full p-[2px] text-muted transition-colors hover:text-ink"
                aria-label={`${file.name} 첨부 제거`}
                onClick={() => removeAttachment(file.id)}
                disabled={disabled}
              >
                <span className="material-symbols-outlined text-[16px]">
                  close
                </span>
              </button>
            </div>
          ))}
          {attachmentError && (
            <span className="text-[12px] leading-[1.4] text-error">
              {attachmentError}
            </span>
          )}
        </div>
      )}
      <div className="relative mx-auto flex max-w-3xl items-end rounded-[10px] border border-outline-variant bg-surface p-[4px] transition-all focus-within:border-tertiary-container focus-within:ring-1 focus-within:ring-tertiary-container">
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept={ACCEPTED_TEXT_FILE_TYPES}
          multiple
          onChange={handleFileChange}
          disabled={disabled}
        />
        <button
          className="mb-1 ml-1 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[8px] text-body transition-colors hover:bg-surface-dim disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="txt 또는 md 파일 첨부"
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">
            attach_file
          </span>
        </button>
        <textarea
          ref={textareaRef}
          className="max-h-[120px] w-full resize-none border-none bg-transparent px-xs py-sm text-[16px] font-normal leading-[1.5] text-on-surface focus:outline-none focus:ring-0 sm:px-sm sm:py-md"
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          placeholder={placeholder}
          rows={1}
          style={{ minHeight: 48 }}
          defaultValue={initialDraftValue}
          onChange={(event) => syncTextareaValue(event.currentTarget.value)}
          onInput={(event) => syncTextareaValue(event.currentTarget.value)}
          onCompositionEnd={(event) =>
            syncTextareaValue(event.currentTarget.value)
          }
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="메시지 입력"
        />
        <button
          className="mb-1 mr-1 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[8px] bg-surface-dark text-stone-50 shadow-sm transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleSubmit}
          disabled={disabled || isOverLimit}
          aria-label="메시지 보내기"
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">
            arrow_upward
          </span>
        </button>
      </div>
      <div className="mx-auto mt-xs flex max-w-3xl items-center justify-end">
        <span className="text-xs text-muted-soft">
          전체{" "}
          {composedLength.toLocaleString()}/
          {payloadLimit.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
