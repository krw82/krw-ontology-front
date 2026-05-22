"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_COUNT,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_PAYLOAD_CHARS,
} from "@/lib/chat-limits";
import { createClientId } from "@/lib/client-id";
import {
  getActiveResearchLabel,
  type ResearchToolCallStatus,
} from "@/lib/chat/research-status";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { ResearchActivityUpdate } from "@/types/api-contracts";
import type { EntitlementStatus } from "@/types/entitlement";
import UsageStatus from "./UsageStatus";

interface ComposerProps {
  onSend: (message: string) => void;
  onCancel?: () => void | Promise<void>;
  activity?: ResearchActivityUpdate | null;
  disabled?: boolean;
  isGenerating?: boolean;
  placeholder?: string;
  toolCalls?: ResearchToolCallStatus[];
  initialValue?: string;
  entitlement?: EntitlementStatus | null;
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

function useComposerMotionConfig() {
  const reducedMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const sync = (query: MediaQueryList | MediaQueryListEvent) => {
      setIsMobile(query.matches);
    };

    sync(mediaQuery);
    mediaQuery.addEventListener("change", sync);

    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  return {
    duration: reducedMotion ? 0 : 0.16,
    y: reducedMotion ? 0 : isMobile ? 4 : 6,
    ease: reducedMotion ? ("linear" as const) : ([0.16, 1, 0.3, 1] as const),
  };
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
  onCancel,
  activity,
  disabled = false,
  isGenerating = false,
  placeholder = "기업에 대해 질문하세요...",
  toolCalls = [],
  initialValue,
  entitlement = null,
}: ComposerProps) {
  const initialDraftValue = initialValue?.trim() ? "" : (initialValue ?? "");
  const [value, setValue] = useState(initialDraftValue);
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAutoSent = useRef(false);
  const motionConfig = useComposerMotionConfig();

  const composedLength = useMemo(
    () => composeMessage(value, attachments).length,
    [attachments, value],
  );
  const payloadLimit =
    attachments.length > 0 ? MAX_CHAT_PAYLOAD_CHARS : MAX_CHAT_MESSAGE_CHARS;
  const isOverLimit = composedLength > payloadLimit;
  const isInputDisabled = disabled || isGenerating;
  const canSubmit = composedLength > 0 && !isOverLimit && !isInputDisabled;
  const generatingLabel = useMemo(
    () => `${getActiveResearchLabel(toolCalls, activity)} 중...`,
    [activity, toolCalls],
  );

  const syncTextareaValue = useCallback((nextValue: string) => {
    setValue(nextValue);
  }, []);

  const readTextareaValue = useCallback(() => {
    return textareaRef.current?.value ?? value;
  }, [value]);

  useEffect(() => {
    if (hasAutoSent.current) return;
    if (isInputDisabled) return;
    if (initialValue?.trim()) {
      hasAutoSent.current = true;
      onSend(initialValue);
    }
  }, [isInputDisabled, initialValue, onSend]);

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

    if (attachments.length + files.length > MAX_CHAT_ATTACHMENT_COUNT) {
      setAttachmentError(
        `첨부 파일은 최대 ${MAX_CHAT_ATTACHMENT_COUNT}개까지 보낼 수 있습니다.`,
      );
      return;
    }

    const oversizedFile = files.find(
      (file) => file.size > MAX_CHAT_ATTACHMENT_BYTES,
    );
    if (oversizedFile) {
      setAttachmentError(
        `첨부 파일 하나는 ${formatBytes(MAX_CHAT_ATTACHMENT_BYTES)}를 넘을 수 없습니다.`,
      );
      return;
    }

    try {
      const loadedFiles = await Promise.all(
        files.map(async (file) => ({
          id: createClientId(),
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
    if (!message.trim() || isInputDisabled) return;
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

  const handlePrimaryAction = () => {
    if (isGenerating) {
      void onCancel?.();
      return;
    }

    handleSubmit();
  };

  return (
    <div className="border-t border-hairline bg-canvas/95 px-base py-sm backdrop-blur-xl sm:px-lg sm:py-base">
      {(attachments.length > 0 || attachmentError) && (
        <div className="mx-auto mb-xs flex max-w-4xl flex-wrap items-center gap-xs">
          <AnimatePresence>
            {attachments.map((file) => (
              <motion.div
                key={file.id}
                layout="position"
                initial={{ opacity: 0, y: motionConfig.y }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -motionConfig.y }}
                transition={{ duration: motionConfig.duration, ease: motionConfig.ease }}
                className="inline-flex max-w-full items-center gap-xs rounded-full border border-hairline bg-surface-soft px-sm py-xxs text-[12px] leading-[1.4] text-body"
              >
              <span className="material-symbols-outlined text-[16px] text-primary">
                description
              </span>
              <span className="max-w-[160px] truncate sm:max-w-[220px]">{file.name}</span>
              <span className="text-muted-soft">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-dim hover:text-ink"
                aria-label={`${file.name} 첨부 제거`}
                onClick={() => removeAttachment(file.id)}
                disabled={isInputDisabled}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                  close
                </span>
              </button>
              </motion.div>
            ))}
            {attachmentError && (
              <motion.span
                initial={{ opacity: 0, y: motionConfig.y }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -motionConfig.y }}
                transition={{ duration: motionConfig.duration, ease: motionConfig.ease }}
                className="text-[12px] leading-[1.4] text-error"
              >
                {attachmentError}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      )}
      <div className="relative mx-auto flex max-w-4xl items-end rounded-[20px] border border-outline-variant bg-surface p-[5px] shadow-[0_10px_28px_rgba(10,11,13,0.08)] transition-all duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept={ACCEPTED_TEXT_FILE_TYPES}
          multiple
          onChange={handleFileChange}
          disabled={isInputDisabled}
        />
        <button
          className="mb-0.5 ml-0.5 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-body transition-colors duration-150 hover:bg-surface-dim hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => fileInputRef.current?.click()}
          disabled={isInputDisabled}
          aria-label="txt 또는 md 파일 첨부"
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">
            attach_file
          </span>
        </button>
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            className="max-h-[120px] w-full resize-none border-none bg-transparent px-xs py-sm text-[16px] font-medium leading-[1.5] text-on-surface placeholder:text-muted focus:outline-none focus:ring-0 disabled:cursor-not-allowed sm:px-sm sm:py-md"
            maxLength={MAX_CHAT_MESSAGE_CHARS}
            placeholder={isGenerating ? "" : placeholder}
            rows={1}
            style={{ minHeight: 48 }}
            defaultValue={initialDraftValue}
            onChange={(event) => syncTextareaValue(event.currentTarget.value)}
            onInput={(event) => syncTextareaValue(event.currentTarget.value)}
            onCompositionEnd={(event) =>
              syncTextareaValue(event.currentTarget.value)
            }
            onKeyDown={handleKeyDown}
            disabled={isInputDisabled}
            aria-label="메시지 입력"
          />
          <AnimatePresence mode="wait" initial={false}>
            {isGenerating && (
              <motion.div
                key={generatingLabel}
                className="pointer-events-none absolute inset-x-xs inset-y-0 flex min-w-0 items-center text-[16px] font-bold leading-[1.5] text-muted sm:inset-x-sm"
                initial={{ opacity: 0, y: motionConfig.y, filter: "blur(2px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -motionConfig.y, filter: "blur(2px)" }}
                transition={{ duration: motionConfig.duration, ease: motionConfig.ease }}
              >
                <span className="truncate">{generatingLabel}</span>
              </motion.div>
            )}
          </AnimatePresence>
          {isGenerating && (
            <motion.span
              aria-hidden="true"
              className="absolute bottom-[7px] left-xs right-xs h-px bg-primary-container/55 sm:left-sm sm:right-sm"
              initial={{ scaleX: 0, transformOrigin: "left" }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, ease: motionConfig.ease }}
            />
          )}
        </div>
        <button
          className="mb-0.5 mr-0.5 inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary shadow-sm transition-all duration-150 hover:scale-[1.03] hover:bg-primary-active active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
          onClick={handlePrimaryAction}
          disabled={isGenerating ? !onCancel : !canSubmit}
          aria-label={isGenerating ? "응답 생성 중지" : "메시지 보내기"}
          type="button"
        >
          <AnimatePresence mode="wait" initial={false}>
            {isGenerating ? (
              <motion.span
                key="generating"
                initial={{ opacity: 0, scale: 0.84 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.84 }}
                transition={{ duration: motionConfig.duration, ease: motionConfig.ease }}
                className="relative inline-flex h-5 w-5 animate-spin rounded-full bg-[conic-gradient(from_0deg,rgba(255,255,255,0)_0deg,rgba(255,255,255,0.18)_92deg,#ffffff_170deg,#ffffff_260deg,rgba(255,255,255,0)_360deg)] p-[2px] [animation-duration:780ms]"
              >
                <span className="h-full w-full rounded-full bg-primary-container shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]" />
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-on-primary shadow-[0_0_8px_rgba(255,255,255,0.85)]" />
              </motion.span>
            ) : (
              <motion.span
                key="send"
                initial={{ opacity: 0, scale: 0.84 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.84 }}
                transition={{ duration: motionConfig.duration, ease: motionConfig.ease }}
                className="material-symbols-outlined text-[22px]"
              >
                arrow_upward
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
      <div className="mx-auto mt-xs flex max-w-4xl items-center justify-between gap-sm">
        <UsageStatus entitlement={entitlement} />
        <span className="text-xs text-muted-soft">
          전체{" "}
          {composedLength.toLocaleString()}/
          {payloadLimit.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
