"use client";

import {
  useCallback,
  useEffect,
  useState,
  type RefObject,
} from "react";

import type { ComposerHandle, ComposerSendResult } from "@/components/Composer";
import {
  normalizeDiscoverUrl,
  type DiscoverGuideStep,
} from "@/lib/chat/discover-guide";
import type { Locale } from "@/i18n/config";

export interface UseDiscoverGuideParams {
  composerRef: RefObject<ComposerHandle | null>;
  responseLocale: Locale;
  onSend: (content: string) => Promise<ComposerSendResult>;
  initialStep?: DiscoverGuideStep;
}

export interface DiscoverGuideController {
  isClientReady: boolean;
  isComposerReady: boolean;
  step: DiscoverGuideStep;
  urlValue: string;
  urlError: string | null;
  ideaValue: string;
  ideaError: string | null;
  onUrlValueChange: (value: string) => void;
  onCommitUrl: () => void;
  onSkipUrl: () => void;
  onAddFile: () => void;
  onSkipFile: () => void;
  onIdeaValueChange: (value: string) => void;
  onSubmitIdea: () => void;
  onSelectExample: (prompt: string) => void;
  onComposerReadyChange: (ready: boolean) => void;
  onUserUrlsChange: (hasUserUrls: boolean) => void;
  onAttachmentsChange: (hasAttachments: boolean) => void;
}

export function useDiscoverGuide({
  composerRef,
  responseLocale,
  onSend,
  initialStep = "url",
}: UseDiscoverGuideParams): DiscoverGuideController {
  const [isClientReady, setIsClientReady] = useState(false);
  const [isComposerReady, setIsComposerReady] = useState(false);
  const [step, setStep] = useState<DiscoverGuideStep>(initialStep);
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [ideaValue, setIdeaValue] = useState("");
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [hasUserUrls, setHasUserUrls] = useState(false);
  const [hasAttachments, setHasAttachments] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setIsClientReady(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const onUrlValueChange = useCallback((value: string) => {
    setUrlValue(value);
    setUrlError(null);
  }, []);
  const onCommitUrl = useCallback(() => {
    const normalizedUrl = normalizeDiscoverUrl(urlValue);
    if (!normalizedUrl) {
      setUrlError(
        responseLocale === "ko"
          ? "확인할 URL을 입력하거나 건너뛰기를 눌러주세요."
          : "Enter a URL to continue, or skip this step.",
      );
      return;
    }

    const committed = composerRef.current?.commitUserUrls([normalizedUrl]);
    if (!committed) {
      setUrlError(
        responseLocale === "ko"
          ? "http 또는 https URL만 입력할 수 있습니다."
          : "Only http or https URLs can be attached.",
      );
      return;
    }

    setUrlValue(normalizedUrl);
    setUrlError(null);
    setStep("file");
  }, [composerRef, responseLocale, urlValue]);
  const onSkipUrl = useCallback(() => {
    setUrlError(null);
    setStep("file");
  }, []);
  const onAddFile = useCallback(() => {
    composerRef.current?.requestAction("file");
  }, [composerRef]);
  const onSkipFile = useCallback(() => {
    setStep("idea");
  }, []);
  const onIdeaValueChange = useCallback((value: string) => {
    setIdeaValue(value);
    setIdeaError(null);
  }, []);
  const onSubmitIdea = useCallback(() => {
    const trimmedIdea = ideaValue.trim();
    if (!trimmedIdea) {
      setIdeaError(
        responseLocale === "ko"
          ? "발굴할 아이디어나 산업, 리스크 키워드를 입력해주세요."
          : "Enter an idea, industry, or risk keyword to start discovery.",
      );
      return;
    }

    setIdeaError(null);
    if (!hasUserUrls && !hasAttachments) {
      void onSend(trimmedIdea).then((result) => {
        if (!result.ok) setIdeaError(result.message);
      });
      return;
    }

    const didSubmit = composerRef.current?.submitWithValue(trimmedIdea) ?? false;
    if (!didSubmit) {
      setIdeaError(
        responseLocale === "ko"
          ? "입력기를 준비 중입니다. 잠시 후 다시 시도해주세요."
          : "The composer is still getting ready. Try again in a moment.",
      );
    }
  }, [composerRef, hasAttachments, hasUserUrls, ideaValue, onSend, responseLocale]);
  const onSelectExample = useCallback((prompt: string) => {
    setIdeaValue(prompt);
    setIdeaError(null);
  }, []);
  const onComposerReadyChange = useCallback((ready: boolean) => {
    setIsComposerReady(ready);
  }, []);
  const onUserUrlsChange = useCallback((nextHasUserUrls: boolean) => {
    setHasUserUrls(nextHasUserUrls);
    if (nextHasUserUrls) {
      setUrlError(null);
      setStep((current) => (current === "url" ? "file" : current));
    }
  }, []);
  const onAttachmentsChange = useCallback((nextHasAttachments: boolean) => {
    setHasAttachments(nextHasAttachments);
    if (nextHasAttachments) {
      setStep((current) => (current === "file" ? "idea" : current));
    }
  }, []);

  return {
    isClientReady,
    isComposerReady,
    step,
    urlValue,
    urlError,
    ideaValue,
    ideaError,
    onUrlValueChange,
    onCommitUrl,
    onSkipUrl,
    onAddFile,
    onSkipFile,
    onIdeaValueChange,
    onSubmitIdea,
    onSelectExample,
    onComposerReadyChange,
    onUserUrlsChange,
    onAttachmentsChange,
  };
}
