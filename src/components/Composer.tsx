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
  placeholder = "Ask a follow-up question or request deeper analysis...",
  initialValue,
}: ComposerProps) {
  const [value, setValue] = useState(initialValue?.trim() ? "" : (initialValue ?? ""));
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
    const message = composeMessage(value, attachments);
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
    <div className="py-base px-lg bg-canvas border-t border-hairline">
      {(attachments.length > 0 || attachmentError) && (
        <div className="max-w-3xl mx-auto mb-xs flex flex-wrap items-center gap-xs">
          {attachments.map((file) => (
            <div
              key={file.id}
              className="inline-flex items-center gap-xs rounded-full border border-hairline bg-surface-soft px-sm py-xxs text-[12px] leading-[1.4] text-body"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">
                description
              </span>
              <span className="max-w-[220px] truncate">{file.name}</span>
              <span className="text-muted-soft">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="rounded-full p-[2px] text-muted hover:text-ink transition-colors"
                aria-label={`Remove ${file.name}`}
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
      <div className="max-w-3xl mx-auto relative flex items-end bg-surface-soft border border-outline-variant rounded-xl p-[4px] focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
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
          className="mb-1 ml-1 p-sm text-body rounded-full hover:bg-surface-dim transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach txt or md file"
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">
            attach_file
          </span>
        </button>
        <textarea
          ref={textareaRef}
          className="w-full bg-transparent border-none focus:ring-0 focus:outline-none resize-none text-[16px] leading-[1.5] font-normal text-on-surface py-md px-sm max-h-[120px]"
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          placeholder={placeholder}
          rows={1}
          style={{ minHeight: 56 }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="Message input"
        />
        <button
          className="mb-1 mr-1 p-sm bg-primary-container text-on-primary rounded-full hover:bg-primary-active transition-colors flex-shrink-0 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSubmit}
          disabled={disabled || !composeMessage(value, attachments).trim()}
          aria-label="Send message"
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">
            arrow_upward
          </span>
        </button>
      </div>
      <div className="max-w-3xl mx-auto mt-xs flex justify-center gap-md">
        <span className="text-xs text-muted-soft">
          Press{" "}
          <kbd className="font-mono bg-surface border border-hairline px-1 rounded">
            Enter
          </kbd>{" "}
          to send
        </span>
        <span className="text-xs text-muted-soft">
          Total{" "}
          {composedLength.toLocaleString()}/
          {payloadLimit.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
