"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
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
import { trackClientEventSilently } from "@/lib/analytics/client";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { ResearchActivityUpdate } from "@/types/api-contracts";

interface ComposerProps {
  onSend: (message: string) => void;
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
    isMobile,
    overlayTransition: { duration: reducedMotion ? 0 : 0.18 },
    sheetTransition: reducedMotion
      ? ({ duration: 0 } as const)
      : ({ type: "spring", stiffness: 440, damping: 38, mass: 0.9 } as const),
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
  disabled = false,
  isGenerating = false,
  placeholder = "기업에 대해 질문하세요...",
  initialValue,
  draftResetKey = 0,
}: ComposerProps) {
  const initialDraftValue = initialValue ?? "";
  const [value, setValue] = useState(initialDraftValue);
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isClientReady, setIsClientReady] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const isInputDisabled = disabled || isGenerating;
  const canSubmit = composedLength > 0 && !isOverLimit && !isInputDisabled;

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
    const previousOverscroll = document.documentElement.style.overscrollBehavior;
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
      <div className={isSheet ? "grid gap-2" : ""} role="menu" aria-label="입력 도구">
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
            <span className={descriptionClass}>txt/md 문서를 질문에 함께 보냅니다.</span>
          </span>
          {!isSheet && (
            <span className="ml-auto rounded-full bg-surface-dim px-2 py-1 text-[11px] font-extrabold leading-none text-muted">
              txt/md
            </span>
          )}
        </button>

        <div className={isSheet ? "mt-3 border-t border-hairline pt-3" : "mt-2 border-t border-hairline pt-3"}>
          <div className="grid gap-1.5" aria-label="분석 모드">
            <button
              type="button"
              disabled
              className={[
                isSheet
                  ? "flex w-full cursor-not-allowed items-center gap-3 rounded-[14px] px-3 py-3.5 text-left text-muted opacity-55"
                  : "flex min-h-[56px] w-full cursor-not-allowed items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left text-muted opacity-60",
              ].join(" ")}
              role="menuitem"
              aria-disabled="true"
            >
              <span className="min-w-0">
                <span className={isSheet ? "block text-[17px] font-extrabold leading-6" : "block text-[14px] font-extrabold leading-5"}>
                  패스트 모드
                </span>
                <span className={isSheet ? "mt-0.5 block text-[13px] font-semibold leading-5 text-muted-soft" : "mt-0.5 block text-[12px] font-semibold leading-4 text-muted-soft"}>
                  빠른 요약은 준비 중입니다.
                </span>
              </span>
              <span className="ml-auto rounded-full bg-surface-dim px-2 py-1 text-[11px] font-extrabold leading-none text-muted">
                준비중
              </span>
            </button>

            <button
              type="button"
              className={[
                isSheet
                  ? "flex w-full items-center gap-3 rounded-[14px] bg-primary-container/10 px-3 py-3.5 text-left text-primary transition-colors active:bg-primary-container/14"
                  : "flex min-h-[56px] w-full items-center justify-between gap-3 rounded-[10px] bg-primary-container/12 px-2.5 py-2 text-left text-primary transition-colors hover:bg-primary-container/16",
              ].join(" ")}
              onClick={() => setIsToolsOpen(false)}
              role="menuitem"
              aria-current="true"
            >
              <span className="min-w-0">
                <span className={isSheet ? "block text-[17px] font-extrabold leading-6" : "block text-[14px] font-extrabold leading-5"}>
                  스탠다드 모드
                </span>
                <span className={isSheet ? "mt-0.5 block text-[13px] font-semibold leading-5 text-primary/75" : "mt-0.5 block text-[12px] font-semibold leading-4 text-primary/75"}>
                  공시 근거를 충분히 확인해 답변합니다.
                </span>
              </span>
              <span
                aria-hidden="true"
                className="material-symbols-outlined ml-auto flex-shrink-0 text-[20px]"
              >
                check
              </span>
            </button>
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
        <div ref={toolsRef} className="relative -translate-y-[2px] flex-shrink-0 self-center">
          <button
            className={[
              "ml-0.5 inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
              isToolsOpen
                ? "border-primary bg-surface text-primary shadow-[0_0_0_3px_rgba(0,82,255,0.10)]"
                : "border-transparent text-body hover:bg-surface-dim hover:text-ink",
            ].join(" ")}
            onClick={() => setIsToolsOpen((open) => !open)}
            disabled={isInputDisabled}
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
                transition={{ duration: motionConfig.duration, ease: motionConfig.ease }}
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
            style={{ minHeight: 48 }}
            value={value}
            data-client-ready={isClientReady ? "true" : "false"}
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
                key="generating-label"
                className="pointer-events-none absolute inset-x-xs inset-y-0 flex min-w-0 items-center text-[16px] font-medium leading-[1.5] text-muted sm:inset-x-sm"
                initial={{ opacity: 0, y: motionConfig.y }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -motionConfig.y }}
                transition={{ duration: motionConfig.duration, ease: motionConfig.ease }}
              >
                <span className="min-w-0 truncate text-muted">
                  분석 진행중
                </span>
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
      {mobileToolsSheet}
    </div>
  );
}
