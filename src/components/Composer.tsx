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
import { trackClientEventSilently } from "@/lib/analytics/client";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { ResearchActivityUpdate } from "@/types/api-contracts";

interface ComposerProps {
  onSend: (
    message: string,
    options?: ComposerSendOptions,
  ) => Promise<ComposerSendResult>;
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
  urlModeAvailable?: boolean;
  focusRequestKey?: number;
  onFocusChange?: (focused: boolean) => void;
}

export type ComposerSendResult =
  | { ok: true }
  | { ok: false; message: string };

export interface ComposerSendOptions {
  userUrl?: string;
  userUrls?: string[];
  attachmentIds?: string[];
}

interface TextAttachment {
  id: string;
  name: string;
  content: string;
  size: number;
}

type DocumentAttachmentStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

interface DocumentAttachment {
  id: string;
  name: string;
  size: number;
  status: DocumentAttachmentStatus;
  error?: string | null;
  isOptimistic?: boolean;
}

interface UserUrlDraft {
  id: string;
  value: string;
}

const ACCEPTED_TEXT_FILE_TYPES =
  ".txt,.md,.markdown,text/plain,text/markdown,text/x-markdown";
const ACCEPTED_FILE_TYPES = `${ACCEPTED_TEXT_FILE_TYPES},.pdf,application/pdf`;
const MAX_DOCUMENT_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_USER_URL_COUNT = 3;

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

function isAcceptedPdfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".pdf") || file.type === "application/pdf";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function documentAttachmentStatusLabel(
  status: DocumentAttachmentStatus,
): string {
  if (status === "completed") return "준비됨";
  if (status === "failed") return "실패";
  if (status === "processing") return "변환 중";
  return "대기 중";
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

function normalizeExplicitUserUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function createEmptyUrlDraft(): UserUrlDraft {
  return { id: createClientId(), value: "" };
}

export default function Composer({
  onSend,
  onCancel,
  activity,
  disabled = false,
  isGenerating = false,
  placeholder = "기업에 대해 질문하세요...",
  urlModeAvailable = false,
  initialValue,
  draftResetKey = 0,
  focusRequestKey = 0,
  onFocusChange,
}: ComposerProps) {
  const initialDraftValue = initialValue ?? "";
  const [value, setValue] = useState(initialDraftValue);
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);
  const [documentAttachments, setDocumentAttachments] = useState<
    DocumentAttachment[]
  >([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isUrlSheetOpen, setIsUrlSheetOpen] = useState(false);
  const [committedUserUrls, setCommittedUserUrls] = useState<string[]>([]);
  const [userUrlDrafts, setUserUrlDrafts] = useState<UserUrlDraft[]>([]);
  const [isClientReady, setIsClientReady] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstUrlInputRef = useRef<HTMLInputElement>(null);
  const documentPollTimersRef = useRef<Map<string, number>>(new Map());
  const pollDocumentAttachmentRef = useRef<(id: string) => void>(() => {});
  const lastFocusRequestKeyRef = useRef(focusRequestKey);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsSheetRef = useRef<HTMLDivElement>(null);
  const lastInitialValueRef = useRef(initialDraftValue);
  const lastDraftResetKeyRef = useRef(draftResetKey);
  const motionConfig = useComposerMotionConfig();

  const enteredUserUrls = useMemo(
    () => committedUserUrls.map((url) => url.trim()).filter(Boolean),
    [committedUserUrls],
  );
  const normalizedUserUrls = useMemo(
    () =>
      enteredUserUrls
        .map((url) => normalizeExplicitUserUrl(url))
        .filter((url): url is string => Boolean(url)),
    [enteredUserUrls],
  );
  const hasUserUrls = enteredUserUrls.length > 0;
  const areUserUrlsValid =
    enteredUserUrls.length === normalizedUserUrls.length;
  const effectiveTextValue =
    hasUserUrls && !value.trim()
      ? enteredUserUrls.length > 1
        ? "이 URL들의 내용이 맞다면 회사에 어떤 의미인지 봐줘."
        : "이 URL의 내용이 맞다면 회사에 어떤 의미인지 봐줘."
      : value;
  const composedLength = useMemo(
    () => composeMessage(effectiveTextValue, attachments).length,
    [attachments, effectiveTextValue],
  );
  const completedDocumentAttachmentIds = useMemo(
    () =>
      documentAttachments
        .filter((attachment) => attachment.status === "completed")
        .map((attachment) => attachment.id),
    [documentAttachments],
  );
  const hasPendingDocumentAttachments = documentAttachments.some(
    (attachment) =>
      attachment.status === "queued" || attachment.status === "processing",
  );
  const hasFailedDocumentAttachments = documentAttachments.some(
    (attachment) => attachment.status === "failed",
  );
  const payloadLimit =
    attachments.length > 0 ? MAX_CHAT_PAYLOAD_CHARS : MAX_CHAT_MESSAGE_CHARS;
  const isOverLimit = composedLength > payloadLimit;
  const isInputBusy = disabled || isSubmitting || !isClientReady;
  const canSubmit =
    composedLength > 0 &&
    (!hasUserUrls || areUserUrlsValid) &&
    !hasPendingDocumentAttachments &&
    !hasFailedDocumentAttachments &&
    !isOverLimit &&
    !isInputBusy &&
    !isGenerating;
  const generatingLabel =
    activity?.stage === "queued" ? "대기 중" : "분석 진행중";
  const showGeneratingOverlay = isGenerating && !isComposerFocused && !value.trim();

  const syncTextareaValue = useCallback((nextValue: string) => {
    setValue(nextValue);
  }, []);

  const readTextareaValue = useCallback(() => {
    return textareaRef.current?.value ?? value;
  }, [value]);

  const clearDocumentPollTimer = useCallback((id: string) => {
    const timer = documentPollTimersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    documentPollTimersRef.current.delete(id);
  }, []);

  const clearDocumentPollTimers = useCallback(() => {
    for (const timer of documentPollTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    documentPollTimersRef.current.clear();
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsClientReady(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    return () => clearDocumentPollTimers();
  }, [clearDocumentPollTimers]);

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
    setDocumentAttachments([]);
    clearDocumentPollTimers();
    setIsUrlSheetOpen(false);
    setCommittedUserUrls([]);
    setUserUrlDrafts([]);
    setAttachmentError(null);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  }, [clearDocumentPollTimers, draftResetKey]);

  useEffect(() => {
    if (!isUrlSheetOpen) return;

    const frameId = window.requestAnimationFrame(() => {
      firstUrlInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isUrlSheetOpen]);

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
    if ((!isToolsOpen || !motionConfig.isMobile) && !isUrlSheetOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll =
      document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overscrollBehavior = previousOverscroll;
    };
  }, [isToolsOpen, isUrlSheetOpen, motionConfig.isMobile]);

  const updateDocumentAttachment = (
    id: string,
    patch: Partial<DocumentAttachment>,
  ) => {
    setDocumentAttachments((current) =>
      current.map((attachment) =>
        attachment.id === id ? { ...attachment, ...patch } : attachment,
      ),
    );
  };

  const pollDocumentAttachment = useCallback(
    (id: string) => {
      clearDocumentPollTimer(id);

      const runPoll = async () => {
        try {
          const response = await fetch(`/api/chat/attachments/${id}`, {
            method: "GET",
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                attachment?: {
                  id: string;
                  file_name: string;
                  file_size: number;
                  status: DocumentAttachmentStatus;
                  error?: string | null;
                };
                error?: { message?: string };
              }
            | null;

          if (!response.ok || !payload?.attachment) {
            updateDocumentAttachment(id, {
              status: "failed",
              error:
                payload?.error?.message ??
                "첨부 문서 상태를 확인하지 못했습니다.",
            });
            clearDocumentPollTimer(id);
            return;
          }

          updateDocumentAttachment(id, {
            name: payload.attachment.file_name,
            size: payload.attachment.file_size,
            status: payload.attachment.status,
            error: payload.attachment.error,
            isOptimistic: false,
          });

          if (
            payload.attachment.status === "queued" ||
            payload.attachment.status === "processing"
          ) {
            const timer = window.setTimeout(
              () => pollDocumentAttachmentRef.current(id),
              1_500,
            );
            documentPollTimersRef.current.set(id, timer);
          } else {
            clearDocumentPollTimer(id);
          }
        } catch {
          updateDocumentAttachment(id, {
            status: "failed",
            error: "첨부 문서 상태를 확인하지 못했습니다.",
          });
          clearDocumentPollTimer(id);
        }
      };

      const timer = window.setTimeout(runPoll, 700);
      documentPollTimersRef.current.set(id, timer);
    },
    [clearDocumentPollTimer],
  );

  useEffect(() => {
    pollDocumentAttachmentRef.current = pollDocumentAttachment;
  }, [pollDocumentAttachment]);

  const uploadDocumentAttachment = async (file: File) => {
    const optimisticId = createClientId();
    setDocumentAttachments((current) => [
      ...current,
      {
        id: optimisticId,
        name: file.name,
        size: file.size,
        status: "queued",
        isOptimistic: true,
      },
    ]);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/chat/attachments", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            attachment?: {
              id: string;
              file_name: string;
              file_size: number;
              status: DocumentAttachmentStatus;
            };
            error?: { message?: string };
          }
        | null;

      if (!response.ok || !payload?.attachment) {
        throw new Error(
          payload?.error?.message ?? "PDF 파일을 업로드하지 못했습니다.",
        );
      }
      const uploadedAttachment = payload.attachment;

      setDocumentAttachments((current) =>
        current.map((attachment) =>
          attachment.id === optimisticId
            ? {
                id: uploadedAttachment.id,
                name: uploadedAttachment.file_name,
                size: uploadedAttachment.file_size,
                status: uploadedAttachment.status,
                isOptimistic: false,
              }
            : attachment,
        ),
      );
      pollDocumentAttachment(uploadedAttachment.id);
    } catch (error) {
      updateDocumentAttachment(optimisticId, {
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "PDF 파일을 업로드하지 못했습니다.",
      });
      trackClientEventSilently("attachment_rejected", {
        reason: "upload_failed",
        file_name: file.name,
        file_type: file.type || null,
        file_size: file.size,
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setAttachmentError(null);

    const invalidFile = files.find(
      (file) => !isAcceptedTextFile(file) && !isAcceptedPdfFile(file),
    );
    if (invalidFile) {
      setAttachmentError("txt, md 또는 PDF 파일만 첨부할 수 있습니다.");
      trackClientEventSilently("attachment_rejected", {
        reason: "unsupported_type",
        file_name: invalidFile.name,
        file_type: invalidFile.type || null,
        file_size: invalidFile.size,
      });
      return;
    }

    if (
      attachments.length + documentAttachments.length + files.length >
      MAX_CHAT_ATTACHMENT_COUNT
    ) {
      setAttachmentError(
        `첨부 파일은 최대 ${MAX_CHAT_ATTACHMENT_COUNT}개까지 보낼 수 있습니다.`,
      );
      trackClientEventSilently("attachment_rejected", {
        reason: "too_many_files",
        incoming_count: files.length,
        existing_count: attachments.length + documentAttachments.length,
      });
      return;
    }

    const oversizedTextFile = files.find(
      (file) =>
        isAcceptedTextFile(file) && file.size > MAX_CHAT_ATTACHMENT_BYTES,
    );
    if (oversizedTextFile) {
      setAttachmentError(
        `txt/md 파일 하나는 ${formatBytes(MAX_CHAT_ATTACHMENT_BYTES)}를 넘을 수 없습니다.`,
      );
      trackClientEventSilently("attachment_rejected", {
        reason: "file_too_large",
        file_name: oversizedTextFile.name,
        file_type: oversizedTextFile.type || null,
        file_size: oversizedTextFile.size,
      });
      return;
    }

    const oversizedPdfFile = files.find(
      (file) => file.size > MAX_CHAT_ATTACHMENT_BYTES,
    );
    if (
      oversizedPdfFile &&
      isAcceptedPdfFile(oversizedPdfFile) &&
      oversizedPdfFile.size > MAX_DOCUMENT_ATTACHMENT_BYTES
    ) {
      setAttachmentError(
        `PDF 파일 하나는 ${formatBytes(MAX_DOCUMENT_ATTACHMENT_BYTES)}를 넘을 수 없습니다.`,
      );
      trackClientEventSilently("attachment_rejected", {
        reason: "file_too_large",
        file_name: oversizedPdfFile.name,
        file_type: oversizedPdfFile.type || null,
        file_size: oversizedPdfFile.size,
      });
      return;
    }

    const textFiles = files.filter(isAcceptedTextFile);
    const pdfFiles = files.filter(
      (file) => isAcceptedPdfFile(file) && !isAcceptedTextFile(file),
    );

    try {
      const loadedFiles = await Promise.all(
        textFiles.map(async (file) => ({
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
      await Promise.all(pdfFiles.map((file) => uploadDocumentAttachment(file)));
      trackClientEventSilently("attachment_added", {
        file_count: loadedFiles.length + pdfFiles.length,
        total_file_count:
          nextAttachments.length + documentAttachments.length + pdfFiles.length,
        total_bytes:
          nextAttachments.reduce((sum, file) => sum + file.size, 0) +
          documentAttachments.reduce((sum, file) => sum + file.size, 0) +
          pdfFiles.reduce((sum, file) => sum + file.size, 0),
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

  const removeDocumentAttachmentChip = (id: string) => {
    clearDocumentPollTimer(id);
    setDocumentAttachments((current) =>
      current.filter((file) => file.id !== id),
    );
    setAttachmentError(null);
  };

  const clearDraft = () => {
    setValue("");
    setAttachments([]);
    setDocumentAttachments([]);
    clearDocumentPollTimers();
    setIsUrlSheetOpen(false);
    setCommittedUserUrls([]);
    setUserUrlDrafts([]);
    setAttachmentError(null);

    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  };

  const restoreDraft = (
    draft: string,
    files: TextAttachment[],
    documents: DocumentAttachment[],
  ) => {
    setValue(draft);
    setAttachments(files);
    setDocumentAttachments(documents);

    if (textareaRef.current) {
      textareaRef.current.value = draft;
      textareaRef.current.style.height = "auto";
    }

    requestAnimationFrame(adjustHeight);
  };

  const openUrlSheet = () => {
    setIsToolsOpen(false);
    setAttachmentError(null);
    setUserUrlDrafts(
      committedUserUrls.length > 0
        ? committedUserUrls.map((url) => ({
            id: createClientId(),
            value: url,
          }))
        : [createEmptyUrlDraft()],
    );
    setIsUrlSheetOpen(true);
  };

  const closeUrlSheet = () => {
    setUserUrlDrafts(
      committedUserUrls.map((url) => ({
        id: createClientId(),
        value: url,
      })),
    );
    setIsUrlSheetOpen(false);
  };

  const updateUserUrlDraft = (id: string, nextValue: string) => {
    setUserUrlDrafts((current) =>
      current.map((draft) =>
        draft.id === id ? { ...draft, value: nextValue } : draft,
      ),
    );
    setAttachmentError(null);
  };

  const addUserUrlDraft = () => {
    setUserUrlDrafts((current) =>
      current.length >= MAX_USER_URL_COUNT
        ? current
        : [...current, createEmptyUrlDraft()],
    );
    setAttachmentError(null);
  };

  const removeUserUrlDraft = (id: string) => {
    setUserUrlDrafts((current) => {
      const nextDrafts = current.filter((draft) => draft.id !== id);
      return nextDrafts.length > 0 ? nextDrafts : [createEmptyUrlDraft()];
    });
    setAttachmentError(null);
  };

  const clearUserUrls = () => {
    setCommittedUserUrls([]);
    setUserUrlDrafts([]);
    setIsUrlSheetOpen(false);
    setAttachmentError(null);
  };

  const confirmUserUrls = () => {
    const entered = userUrlDrafts
      .map((draft) => draft.value.trim())
      .filter(Boolean);

    if (entered.length === 0) {
      clearUserUrls();
      return;
    }

    const normalized = entered.map((url) => normalizeExplicitUserUrl(url));
    if (normalized.some((url) => !url)) {
      setAttachmentError("올바른 http 또는 https URL만 입력해주세요.");
      return;
    }
    const nextUrls = normalized.filter((url): url is string => Boolean(url));

    setCommittedUserUrls(nextUrls);
    setUserUrlDrafts(
      nextUrls.map((url) => ({
        id: createClientId(),
        value: url,
      })),
    );
    setAttachmentError(null);
    setIsUrlSheetOpen(false);
  };

  const handleSubmit = async () => {
    const latestValue = readTextareaValue();
    if (latestValue !== value) {
      setValue(latestValue);
    }

    if (hasUserUrls && !areUserUrlsValid) {
      setAttachmentError("올바른 http 또는 https URL만 입력해주세요.");
      openUrlSheet();
      return;
    }
    if (hasPendingDocumentAttachments) {
      setAttachmentError("PDF 문서 변환이 끝난 뒤 전송할 수 있습니다.");
      return;
    }
    if (hasFailedDocumentAttachments) {
      setAttachmentError("변환에 실패한 PDF를 제거한 뒤 다시 시도해주세요.");
      return;
    }

    const draftText =
      hasUserUrls && !latestValue.trim()
        ? enteredUserUrls.length > 1
          ? "이 URL들의 내용이 맞다면 회사에 어떤 의미인지 봐줘."
          : "이 URL의 내용이 맞다면 회사에 어떤 의미인지 봐줘."
        : latestValue;
    const message = composeMessage(draftText, attachments);
    if (!message.trim() || isInputBusy || isGenerating) return;
    if (message.length > payloadLimit) {
      setAttachmentError(
        `첨부 포함 메시지는 ${payloadLimit.toLocaleString()}자를 넘을 수 없습니다.`,
      );
      return;
    }

    const draftSnapshot = latestValue;
    const attachmentSnapshot = [...attachments];
    const documentAttachmentSnapshot = [...documentAttachments];
    const committedUrlSnapshot = [...committedUserUrls];
    const urlDraftSnapshot = [...userUrlDrafts];
    const urlSheetOpenSnapshot = isUrlSheetOpen;

    flushSync(() => {
      clearDraft();
      setIsSubmitting(true);
    });

    try {
      const sendOptions: ComposerSendOptions = {};
      if (normalizedUserUrls.length > 0) {
        sendOptions.userUrl = normalizedUserUrls[0];
        sendOptions.userUrls = normalizedUserUrls;
      }
      if (completedDocumentAttachmentIds.length > 0) {
        sendOptions.attachmentIds = completedDocumentAttachmentIds;
      }

      const result = await onSend(
        message,
        Object.keys(sendOptions).length > 0 ? sendOptions : undefined,
      );

      if (!result.ok) {
        restoreDraft(
          draftSnapshot,
          attachmentSnapshot,
          documentAttachmentSnapshot,
        );
        setCommittedUserUrls(committedUrlSnapshot);
        setUserUrlDrafts(urlDraftSnapshot);
        setIsUrlSheetOpen(urlSheetOpenSnapshot);
      }
    } catch {
      setAttachmentError("메시지를 보내지 못했습니다. 다시 시도해주세요.");
      restoreDraft(
        draftSnapshot,
        attachmentSnapshot,
        documentAttachmentSnapshot,
      );
      setCommittedUserUrls(committedUrlSnapshot);
      setUserUrlDrafts(urlDraftSnapshot);
      setIsUrlSheetOpen(urlSheetOpenSnapshot);
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
        {urlModeAvailable && (
          <button
            type="button"
            className={itemBase}
            onClick={openUrlSheet}
            role="menuitem"
          >
            {!isSheet && (
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[22px] text-primary"
              >
                link
              </span>
            )}
            <span className="min-w-0">
              <span className={titleClass || undefined}>URL 점검</span>
              <span className={descriptionClass}>
                사용자가 넣은 URL 원문을 공시 기준 질문에 함께 보냅니다.
              </span>
            </span>
            {!isSheet && (
              <span className="ml-auto rounded-full bg-primary-container/10 px-2 py-1 text-[11px] font-extrabold leading-none text-primary">
                URL
              </span>
            )}
          </button>
        )}

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
              PDF, txt, md 문서를 질문에 함께 보냅니다.
            </span>
          </span>
          {!isSheet && (
            <span className="ml-auto rounded-full bg-surface-dim px-2 py-1 text-[11px] font-extrabold leading-none text-muted">
              PDF
            </span>
          )}
        </button>

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

  const urlSheet =
    isClientReady && typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {isUrlSheetOpen && (
              <motion.div
                key="composer-url-sheet"
                className="fixed inset-0 z-[150] flex items-end sm:items-center sm:justify-center"
                role="presentation"
              >
                <motion.button
                  type="button"
                  aria-label="URL 자료 패널 닫기"
                  className="absolute inset-0 bg-ink/24"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={motionConfig.overlayTransition}
                  onClick={closeUrlSheet}
                />
                <motion.div
                  className="relative z-10 w-full overflow-hidden rounded-t-[28px] border-t border-hairline bg-canvas text-ink shadow-[0_-18px_54px_rgba(10,11,13,0.18)] sm:max-w-[520px] sm:rounded-[24px] sm:border sm:shadow-[0_24px_70px_rgba(10,11,13,0.22)]"
                  initial={{
                    opacity: motionConfig.isMobile ? 1 : 0,
                    y: motionConfig.isMobile ? "102%" : 18,
                    scale: motionConfig.isMobile ? 1 : 0.98,
                  }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{
                    opacity: motionConfig.isMobile ? 1 : 0,
                    y: motionConfig.isMobile ? "102%" : 18,
                    scale: motionConfig.isMobile ? 1 : 0.98,
                  }}
                  transition={motionConfig.sheetTransition}
                  role="dialog"
                  aria-modal="true"
                  aria-label="URL 자료"
                >
                  <div className="mx-auto mt-2 h-1.5 w-11 rounded-full bg-outline-variant sm:hidden" />
                  <div className="grid max-h-[min(82dvh,660px)] gap-5 overflow-y-auto px-base pb-[calc(env(safe-area-inset-bottom)+20px)] pt-md sm:px-lg sm:pb-lg">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-black uppercase tracking-[0.18em] text-primary">
                          URL 자료
                        </p>
                        <h2 className="mt-1 text-[24px] font-black leading-[1.12] text-ink">
                          확인할 URL을 넣어주세요.
                        </h2>
                        <p className="mt-2 text-[14px] font-semibold leading-6 text-muted">
                          최대 {MAX_USER_URL_COUNT}개까지 질문에 함께 보냅니다.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-dim hover:text-ink"
                        onClick={closeUrlSheet}
                        disabled={isInputBusy}
                        aria-label="URL 자료 패널 닫기"
                      >
                        <span
                          aria-hidden="true"
                          className="material-symbols-outlined text-[22px]"
                        >
                          close
                        </span>
                      </button>
                    </div>

                    <div className="grid gap-2.5">
                      {userUrlDrafts.map((draft, index) => (
                        <div
                          key={draft.id}
                          className="grid min-w-0 grid-cols-[minmax(0,1fr)_44px] items-center gap-2"
                        >
                          <label
                            className="sr-only"
                            htmlFor={`composer-user-url-${draft.id}`}
                          >
                            URL {index + 1}
                          </label>
                          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center rounded-[18px] border border-hairline bg-surface-soft px-3 focus-within:border-primary focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_rgba(0,82,255,0.10)]">
                            <span
                              aria-hidden="true"
                              className="material-symbols-outlined mr-2 text-[19px] text-primary"
                            >
                              link
                            </span>
                            <input
                              id={`composer-user-url-${draft.id}`}
                              ref={index === 0 ? firstUrlInputRef : undefined}
                              type="url"
                              inputMode="url"
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              className="min-w-0 border-none bg-transparent py-3 text-[15px] font-semibold leading-6 text-ink placeholder:text-muted focus:outline-none focus:ring-0"
                              value={draft.value}
                              onChange={(event) =>
                                updateUserUrlDraft(
                                  draft.id,
                                  event.currentTarget.value,
                                )
                              }
                              placeholder="https://example.com/news"
                              disabled={isInputBusy}
                            />
                          </div>
                          <button
                            type="button"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-hairline text-muted transition-colors hover:bg-surface-dim hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                            onClick={() => removeUserUrlDraft(draft.id)}
                            disabled={isInputBusy}
                            aria-label={`${index + 1}번째 URL 제거`}
                          >
                            <span
                              aria-hidden="true"
                              className="material-symbols-outlined text-[20px]"
                            >
                              remove
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-hairline bg-canvas px-4 text-[15px] font-black leading-5 text-ink transition-colors hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-45"
                        onClick={addUserUrlDraft}
                        disabled={
                          isInputBusy ||
                          userUrlDrafts.length >= MAX_USER_URL_COUNT
                        }
                      >
                        <span
                          aria-hidden="true"
                          className="material-symbols-outlined text-[20px]"
                        >
                          add
                        </span>
                        URL 추가
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[14px] bg-primary-container px-5 text-[15px] font-black leading-5 text-on-primary transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-55 sm:flex-none"
                        onClick={confirmUserUrls}
                        disabled={isInputBusy}
                      >
                        완료
                      </button>
                    </div>
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
      {(attachments.length > 0 ||
        documentAttachments.length > 0 ||
        hasUserUrls ||
        attachmentError) && (
        <div className="pointer-events-auto mx-auto mb-xs flex max-w-4xl flex-wrap items-center gap-xs">
          <AnimatePresence>
            {hasUserUrls && (
              <motion.div
                key="user-urls"
                layout="position"
                initial={{ opacity: 0, y: motionConfig.y }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -motionConfig.y }}
                transition={{
                  duration: motionConfig.duration,
                  ease: motionConfig.ease,
                }}
                className="inline-flex max-w-full items-center overflow-hidden rounded-full border border-primary/30 bg-primary-container/10 text-[12px] font-extrabold leading-[1.4] text-primary"
              >
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-xs px-sm py-xxs transition-colors hover:bg-primary-container/10"
                  onClick={openUrlSheet}
                  disabled={isInputBusy}
                  aria-label={`URL ${enteredUserUrls.length}개 수정`}
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[16px]"
                  >
                    link
                  </span>
                  <span className="truncate">
                    URL {enteredUserUrls.length}개 첨부됨
                  </span>
                  <span className="text-primary/70">수정</span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center border-l border-primary/20 text-primary transition-colors hover:bg-primary-container/12"
                  aria-label="URL 자료 모두 제거"
                  onClick={clearUserUrls}
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
            )}
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
            {documentAttachments.map((file) => (
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
                className={[
                  "inline-flex max-w-full items-center gap-xs rounded-full border px-sm py-xxs text-[12px] leading-[1.4]",
                  file.status === "failed"
                    ? "border-error/25 bg-error-container text-error"
                    : "border-primary/20 bg-primary-container/10 text-body",
                ].join(" ")}
              >
                <span className="material-symbols-outlined text-[16px] text-primary">
                  picture_as_pdf
                </span>
                <span className="max-w-[150px] truncate sm:max-w-[220px]">
                  {file.name}
                </span>
                <span
                  className={
                    file.status === "failed"
                      ? "font-bold text-error"
                      : "font-bold text-primary"
                  }
                >
                  {documentAttachmentStatusLabel(file.status)}
                </span>
                <span className="text-muted-soft">
                  {formatBytes(file.size)}
                </span>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-dim hover:text-ink"
                  aria-label={`${file.name} 첨부 제거`}
                  onClick={() => removeDocumentAttachmentChip(file.id)}
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
      <div
        className="pointer-events-auto relative mx-auto flex max-w-4xl items-center rounded-[26px] border border-hairline bg-canvas/92 p-[5px] shadow-[0_14px_42px_rgba(10,11,13,0.14)] backdrop-blur-md transition-all duration-150 focus-within:border-outline-variant focus-within:bg-canvas/96 focus-within:shadow-[0_16px_46px_rgba(10,11,13,0.16)]"
      >
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept={ACCEPTED_FILE_TYPES}
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
            placeholder={
              isGenerating
                ? ""
                : hasUserUrls
                  ? enteredUserUrls.length > 1
                    ? "이 URL들에서 무엇을 확인할까요?"
                    : "이 URL에서 무엇을 확인할까요?"
                  : placeholder
            }
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
                <span className="min-w-0 truncate text-muted">
                  {generatingLabel}
                </span>
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
      {urlSheet}
    </div>
  );
}
