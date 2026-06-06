"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { flushSync } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_COUNT,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_PAYLOAD_CHARS,
} from "@/lib/chat-limits";
import { createClientId } from "@/lib/client-id";
import type { ResearchToolCallStatus } from "@/lib/chat/research-status";
import type { ResearchMode } from "@/lib/research-mode";
import {
  ANALYSIS_MODE_DESCRIPTIONS,
  ANALYSIS_MODE_LABELS,
  type AnalysisMode,
} from "@/lib/analysis-mode";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { ResearchActivityUpdate } from "@/types/api-contracts";

interface ComposerProps {
  onSend: (message: string) => Promise<ComposerSendResult>;
  onCancel?: () => void | Promise<void>;
  activity?: ResearchActivityUpdate | null;
  disabled?: boolean;
  isGenerating?: boolean;
  placeholder?: string;
  toolCalls?: ResearchToolCallStatus[];
  initialValue?: string;
  draftResetKey?: number;
  runStartedAt?: string | null;
  researchMode?: ResearchMode;
  onResearchModeChange?: (mode: ResearchMode) => void;
  analysisMode?: AnalysisMode;
  onAnalysisModeChange?: (mode: AnalysisMode) => void;
  focusRequestKey?: number;
  onFocusChange?: (focused: boolean) => void;
}

export type ComposerSendResult =
  | { ok: true }
  | { ok: false; message: string };

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
    if (char === '"') return "&quot;";
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
    isMobile,
    overlayTransition: { duration: reducedMotion ? 0 : 0.18 },
    sheetTransition: reducedMotion
      ? ({ duration: 0 } as const)
      : ({ type: "spring", stiffness: 440, damping: 38, mass: 0.9 } as const),
    y: reducedMotion ? 0 : isMobile ? 4 : 6,
    ease: reducedMotion ? ("linear" as const) : ([0.16, 1, 0.3, 1] as const),
  };
}

function composeMessage(
  message: string,
  attachments: TextAttachment[],
): string {
  const attachmentBlocks = attachments.map(
    (file) =>
      `<attached_file name="${escapeAttachmentName(file.name)}">\n${file.content.trimEnd()}\n</attached_file>`,
  );

  return [message.trim(), ...attachmentBlocks].filter(Boolean).join("\n\n");
}

export default function Composer({
  onSend,
  onCancel,
  disabled = false,
  isGenerating = false,
  placeholder = "기업에 대해 질문하세요...",
  analysisMode = "company",
  onAnalysisModeChange,
  initialValue,
  draftResetKey = 0,
  focusRequestKey = 0,
  onFocusChange,
}: ComposerProps) {
  const initialDraftValue = initialValue ?? "";
  const [value, setValue] = useState(initialDraftValue);
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isClientReady, setIsClientReady] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFocusRequestKeyRef = useRef(focusRequestKey);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsSheetRef = useRef<HTMLDivElement>(null);
  const lastInitialValueRef = useRef(initialDraftValue);
  const lastDraftResetKeyRef = useRef(draftResetKey);
  const motionConfig = useComposerMotionConfig();

  const composedLength = useMemo(
    () => composeMessage(value, attachments).length,
    [attachments, value],
  );
  const payloadLimit =
    attachments.length > 0 ? MAX_CHAT_PAYLOAD_CHARS : MAX_CHAT_MESSAGE_CHARS;
  const isOverLimit = composedLength > payloadLimit;
  const isInputBusy = disabled || isSubmitting || !isClientReady;
  const canSubmit =
    composedLength > 0 && !isOverLimit && !isInputBusy && !isGenerating;
  const showGeneratingOverlay = isGenerating && !isComposerFocused && !value.trim();

  const syncTextareaValue = useCallback((nextValue: string) => {
    setValue(nextValue);
  }, []);

  const readTextareaValue = useCallback(() => {
    return textareaRef.current?.value ?? value;
  }, [value]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsClientReady(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const nextInitialValue = initialValue ?? "";
    if (lastInitialValueRef.current === nextInitialValue) return;

    lastInitialValueRef.current = nextInitialValue;
    setValue(nextInitialValue);
    setAttachmentError(null);
  }, [initialValue]);

  useEffect(() => {
    if (lastDraftResetKeyRef.current === draftResetKey) return;

    lastDraftResetKeyRef.current = draftResetKey;
    lastInitialValueRef.current = "";
    setValue("");
    setAttachments([]);
    setAttachmentError(null);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  }, [draftResetKey]);

  useEffect(() => {
    if (lastFocusRequestKeyRef.current === focusRequestKey) return;

    lastFocusRequestKeyRef.current = focusRequestKey;

    if (isInputBusy) return;

    const frameId = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.focus();

      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [focusRequestKey, isInputBusy]);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    if (!isToolsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolsRef.current?.contains(target)) return;
      if (toolsSheetRef.current?.contains(target)) return;
      setIsToolsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsToolsOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isToolsOpen]);

  useEffect(() => {
    if (!isToolsOpen || !motionConfig.isMobile) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll =
      document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overscrollBehavior = previousOverscroll;
    };
  }, [isToolsOpen, motionConfig.isMobile]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setAttachmentError(null);

    const invalidFile = files.find((file) => !isAcceptedTextFile(file));
    if (invalidFile) {
      setAttachmentError("txt 또는 md 파일만 첨부할 수 있습니다.");
      trackClientEventSilently("attachment_rejected", {
        reason: "unsupported_type",
        file_name: invalidFile.name,
        file_type: invalidFile.type || null,
        file_size: invalidFile.size,
      });
      return;
    }

    if (attachments.length + files.length > MAX_CHAT_ATTACHMENT_COUNT) {
      setAttachmentError(
        `첨부 파일은 최대 ${MAX_CHAT_ATTACHMENT_COUNT}개까지 보낼 수 있습니다.`,
      );
      trackClientEventSilently("attachment_rejected", {
        reason: "too_many_files",
        incoming_count: files.length,
        existing_count: attachments.length,
      });
      return;
    }

    const oversizedFile = files.find(
      (file) => file.size > MAX_CHAT_ATTACHMENT_BYTES,
    );
    if (oversizedFile) {
      setAttachmentError(
        `첨부 파일 하나는 ${formatBytes(MAX_CHAT_ATTACHMENT_BYTES)}를 넘을 수 없습니다.`,
      );
      trackClientEventSilently("attachment_rejected", {
        reason: "file_too_large",
        file_name: oversizedFile.name,
        file_type: oversizedFile.type || null,
        file_size: oversizedFile.size,
      });
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
        trackClientEventSilently("attachment_rejected", {
          reason: "payload_too_large",
          incoming_count: files.length,
          total_characters: nextMessage.length,
        });
        return;
      }

      setAttachments(nextAttachments);
      trackClientEventSilently("attachment_added", {
        file_count: loadedFiles.length,
        total_file_count: nextAttachments.length,
        total_bytes: nextAttachments.reduce((sum, file) => sum + file.size, 0),
      });
    } catch {
      setAttachmentError("파일을 읽지 못했습니다.");
      trackClientEventSilently("attachment_rejected", {
        reason: "read_failed",
        incoming_count: files.length,
      });
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((file) => file.id !== id));
    setAttachmentError(null);
  };

  const clearDraft = () => {
    setValue("");
    setAttachments([]);
    setAttachmentError(null);

    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  };

  const restoreDraft = (draft: string, files: TextAttachment[]) => {
    setValue(draft);
    setAttachments(files);

    if (textareaRef.current) {
      textareaRef.current.value = draft;
      textareaRef.current.style.height = "auto";
    }

    requestAnimationFrame(adjustHeight);
  };

  const handleSubmit = async () => {
    const latestValue = readTextareaValue();
    if (latestValue !== value) {
      setValue(latestValue);
    }

    const message = composeMessage(latestValue, attachments);
    if (!message.trim() || isInputBusy || isGenerating) return;
    if (message.length > payloadLimit) {
      setAttachmentError(
        `첨부 포함 메시지는 ${payloadLimit.toLocaleString()}자를 넘을 수 없습니다.`,
      );
      return;
    }

    const draftSnapshot = latestValue;
    const attachmentSnapshot = [...attachments];

    flushSync(() => {
      clearDraft();
      setIsSubmitting(true);
    });

    try {
      const result = await onSend(message);

      if (!result.ok) {
        restoreDraft(draftSnapshot, attachmentSnapshot);
        setAttachmentError(result.message);
      }
    } catch {
      setAttachmentError("메시지를 보내지 못했습니다. 다시 시도해주세요.");
      restoreDraft(draftSnapshot, attachmentSnapshot);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handlePrimaryAction = () => {
    void handleSubmit();
  };

  const openFilePicker = () => {
    setIsToolsOpen(false);
    fileInputRef.current?.click();
  };

  const renderToolsContent = (variant: "popover" | "sheet") => {
    const isSheet = variant === "sheet";
    const itemBase = isSheet
      ? "flex w-full items-center gap-3 rounded-[14px] px-3 py-3.5 text-left transition-colors active:bg-surface-dim"
      : "flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2 text-left text-[15px] font-extrabold leading-5 text-ink transition-colors hover:bg-surface-dim";
    const titleClass = isSheet
      ? "block text-[17px] font-extrabold leading-6 text-ink"
      : "";
    const descriptionClass = isSheet
      ? "mt-0.5 block text-[13px] font-semibold leading-5 text-muted"
      : "sr-only";

    return (
      <div
        className={isSheet ? "grid gap-2" : ""}
        role="menu"
        aria-label="입력 도구"
      >
        <button
          type="button"
          className={itemBase}
          onClick={openFilePicker}
          role="menuitem"
        >
          {!isSheet && (
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[22px] text-primary"
            >
              attach_file
            </span>
          )}
          <span className="min-w-0">
            <span className={titleClass || undefined}>파일 첨부</span>
            <span className={descriptionClass}>
              txt/md 문서를 질문에 함께 보냅니다.
            </span>
          </span>
          {!isSheet && (
            <span className="ml-auto rounded-full bg-surface-dim px-2 py-1 text-[11px] font-extrabold leading-none text-muted">
              txt/md
            </span>
          )}
        </button>

        <div
          className={
            isSheet
              ? "mt-3 border-t border-hairline pt-3"
              : "mt-2 border-t border-hairline pt-3"
          }
        >
          <div className="grid gap-1.5" aria-label="데이터 모드">
            {(["company", "news"] as const).map((mode) => {
              const selected = analysisMode === mode;

              return (
                <button
                  key={mode}
                  type="button"
                  className={[
                    isSheet
                      ? "flex w-full items-center gap-3 rounded-[14px] px-3 py-3.5 text-left transition-colors active:bg-primary-container/12"
                      : "flex min-h-[58px] w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-surface-dim",
                    selected
                      ? "bg-primary-container/12 text-primary"
                      : "text-ink",
                  ].join(" ")}
                  onClick={() => {
                    onAnalysisModeChange?.(mode);
                    setIsToolsOpen(false);
                  }}
                  role="menuitemradio"
                  aria-checked={selected}
                >
                  <span className="min-w-0">
                    <span
                      className={
                        isSheet
                          ? "block text-[17px] font-extrabold leading-6"
                          : "block text-[14px] font-extrabold leading-5"
                      }
                    >
                      {ANALYSIS_MODE_LABELS[mode]}
                    </span>
                    <span
                      className={
                        isSheet
                          ? "mt-0.5 block text-[13px] font-semibold leading-5 text-muted"
                          : "mt-0.5 block text-[12px] font-semibold leading-4 text-muted"
                      }
                    >
                      {ANALYSIS_MODE_DESCRIPTIONS[mode]}
                    </span>
                  </span>
                  {selected && (
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined ml-auto flex-shrink-0 text-[20px]"
                    >
                      check
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const mobileToolsSheet =
    isClientReady && typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {isToolsOpen && motionConfig.isMobile && (
              <motion.div
                key="composer-tools-mobile"
                className="fixed inset-0 z-[140] flex items-end sm:hidden"
                role="presentation"
              >
                <motion.button
                  type="button"
                  aria-label="입력 도구 닫기"
                  className="absolute inset-0 bg-ink/24"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={motionConfig.overlayTransition}
                  onClick={() => setIsToolsOpen(false)}
                />
                <motion.div
                  ref={toolsSheetRef}
                  className="relative z-10 w-full overflow-hidden rounded-t-[28px] border-t border-hairline bg-canvas text-ink shadow-[0_-18px_54px_rgba(10,11,13,0.18)]"
                  initial={{ y: "102%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "102%" }}
                  transition={motionConfig.sheetTransition}
                  drag={motionConfig.isMobile ? "y" : false}
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.18 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 72 || info.velocity.y > 620) {
                      setIsToolsOpen(false);
                    }
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="입력 도구"
                >
                  <div className="mx-auto mt-2 h-1.5 w-11 rounded-full bg-outline-variant" />
                  <div className="max-h-[min(76dvh,620px)] overflow-y-auto px-base pb-[calc(env(safe-area-inset-bottom)+20px)] pt-md">
                    {renderToolsContent("sheet")}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <div className="pointer-events-none bg-transparent px-[34px] pb-0 pt-0 sm:px-lg">
      {(attachments.length > 0 || attachmentError) && (
        <div className="pointer-events-auto mx-auto mb-xs flex max-w-4xl flex-wrap items-center gap-xs">
          <AnimatePresence>
            {attachments.map((file) => (
              <motion.div
                key={file.id}
                layout="position"
                initial={{ opacity: 0, y: motionConfig.y }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -motionConfig.y }}
                transition={{
                  duration: motionConfig.duration,
                  ease: motionConfig.ease,
                }}
                className="inline-flex max-w-full items-center gap-xs rounded-full border border-hairline bg-surface-soft px-sm py-xxs text-[12px] leading-[1.4] text-body"
              >
                <span className="material-symbols-outlined text-[16px] text-primary">
                  description
                </span>
                <span className="max-w-[160px] truncate sm:max-w-[220px]">
                  {file.name}
                </span>
                <span className="text-muted-soft">
                  {formatBytes(file.size)}
                </span>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-dim hover:text-ink"
                  aria-label={`${file.name} 첨부 제거`}
                  onClick={() => removeAttachment(file.id)}
                  disabled={isInputBusy}
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[16px]"
                  >
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
                transition={{
                  duration: motionConfig.duration,
                  ease: motionConfig.ease,
                }}
                className="text-[12px] leading-[1.4] text-error"
              >
                {attachmentError}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      )}
      <div className="pointer-events-auto relative mx-auto flex max-w-4xl items-center rounded-[26px] border border-hairline bg-canvas/92 p-[5px] shadow-[0_14px_42px_rgba(10,11,13,0.14)] backdrop-blur-md transition-all duration-150 focus-within:border-outline-variant focus-within:bg-canvas/96 focus-within:shadow-[0_16px_46px_rgba(10,11,13,0.16)]">
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept={ACCEPTED_TEXT_FILE_TYPES}
          multiple
          onChange={handleFileChange}
          disabled={isInputBusy}
        />
        <div ref={toolsRef} className="relative flex-shrink-0 self-center">
          <button
            className={[
              "inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
              isToolsOpen
                ? "border-primary bg-surface text-primary shadow-[0_0_0_3px_rgba(0,82,255,0.10)]"
                : "border-transparent text-muted hover:bg-surface-soft hover:text-ink",
            ].join(" ")}
            onClick={() => setIsToolsOpen((open) => !open)}
            disabled={isInputBusy}
            aria-label="입력 도구 열기"
            aria-expanded={isToolsOpen}
            aria-haspopup={motionConfig.isMobile ? "dialog" : "menu"}
            type="button"
          >
            <span className="material-symbols-outlined text-[24px] leading-none">
              add
            </span>
          </button>

          <AnimatePresence>
            {isToolsOpen && !motionConfig.isMobile && (
              <motion.div
                key="composer-tools"
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{
                  duration: motionConfig.duration,
                  ease: motionConfig.ease,
                }}
                className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-[282px] overflow-hidden rounded-[18px] border border-hairline bg-canvas p-3 text-ink shadow-[0_18px_48px_rgba(10,11,13,0.16)]"
                role="menu"
                aria-label="입력 도구"
              >
                {renderToolsContent("popover")}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            className="max-h-[120px] w-full resize-none border-none bg-transparent px-xs py-sm text-[16px] font-medium leading-[1.5] text-on-surface placeholder:text-muted focus:outline-none focus:ring-0 disabled:cursor-not-allowed sm:px-sm sm:py-md"
            maxLength={MAX_CHAT_MESSAGE_CHARS}
            placeholder={isGenerating ? "" : placeholder}
            rows={1}
            style={{ minHeight: 44 }}
            value={value}
            data-client-ready={isClientReady ? "true" : "false"}
            onChange={(event) => syncTextareaValue(event.currentTarget.value)}
            onInput={(event) => syncTextareaValue(event.currentTarget.value)}
            onCompositionEnd={(event) =>
              syncTextareaValue(event.currentTarget.value)
            }
            onFocus={() => {
              setIsComposerFocused(true);
              onFocusChange?.(true);
            }}
            onBlur={() => {
              setIsComposerFocused(false);
              onFocusChange?.(false);
            }}
            onKeyDown={handleKeyDown}
            disabled={isInputBusy}
            aria-label="메시지 입력"
          />
          <AnimatePresence mode="wait" initial={false}>
            {showGeneratingOverlay && (
              <motion.div
                key="generating-label"
                className="pointer-events-none absolute inset-x-xs inset-y-0 flex min-w-0 items-center text-[16px] font-medium leading-[1.5] text-muted sm:inset-x-sm"
                initial={{ opacity: 0, y: motionConfig.y }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -motionConfig.y }}
                transition={{
                  duration: motionConfig.duration,
                  ease: motionConfig.ease,
                }}
              >
                <span className="min-w-0 truncate text-muted">분석 진행중</span>
              </motion.div>
            )}
          </AnimatePresence>
          {showGeneratingOverlay && (
            <motion.span
              aria-hidden="true"
              className="absolute bottom-[7px] left-xs right-xs h-px bg-primary-container/55 sm:left-sm sm:right-sm"
              initial={{ scaleX: 0, transformOrigin: "left" }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, ease: motionConfig.ease }}
            />
          )}
        </div>
        {isGenerating && !isComposerFocused && onCancel && (
          <button
            type="button"
            className="ml-2 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center self-center rounded-full bg-surface-dim text-error shadow-[0_8px_22px_rgba(10,11,13,0.14)] transition-all duration-150 hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-55"
            onClick={() => void onCancel?.()}
            disabled={disabled || isSubmitting}
            aria-label="응답 생성 중지"
          >
            <span className="material-symbols-outlined text-[22px]">stop</span>
          </button>
        )}
        {!isGenerating && (
          <button
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center self-center rounded-full bg-primary-container text-on-primary shadow-[0_8px_22px_rgba(0,82,255,0.24)] transition-all duration-150 hover:scale-[1.03] hover:bg-primary-active active:scale-95 disabled:cursor-not-allowed disabled:bg-primary-container disabled:text-on-primary disabled:opacity-55"
            onClick={handlePrimaryAction}
            disabled={!canSubmit}
            aria-label="메시지 보내기"
            type="button"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key="send"
                initial={{ opacity: 0, scale: 0.84 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.84 }}
                transition={{
                  duration: motionConfig.duration,
                  ease: motionConfig.ease,
                }}
                className="material-symbols-outlined text-[22px]"
              >
                arrow_upward
              </motion.span>
            </AnimatePresence>
          </button>
        )}
      </div>
      {mobileToolsSheet}
    </div>
  );
}
