"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

export type ShareStarter = {
  question_content: string;
  tickers: string[];
  title?: string | null;
};

export interface UseShareStarterParams {
  shareToken: string | null;
  cancelledRef: MutableRefObject<boolean>;
  onSessionError: (message: string | null) => void;
}

export interface UseShareStarterResult {
  shareStarter: ShareStarter | null;
  clearShareStarter: () => void;
}

export function useShareStarter({
  shareToken,
  cancelledRef,
  onSessionError,
}: UseShareStarterParams): UseShareStarterResult {
  const [shareStarter, setShareStarter] = useState<ShareStarter | null>(null);
  const loadedShareTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const token = shareToken?.trim();
    if (!token) {
      loadedShareTokenRef.current = null;
      return;
    }

    if (loadedShareTokenRef.current === token) return;
    loadedShareTokenRef.current = token;
    const shareTokenValue = token;
    setShareStarter(null);

    let stale = false;

    async function loadShareStarter() {
      try {
        const response = await fetch(
          `/api/share/${encodeURIComponent(shareTokenValue)}/starter`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => null)) as
          | Partial<ShareStarter>
          | { error?: { message?: string } }
          | null;

        if (stale || cancelledRef.current) return;

        if (!response.ok || !data || !("question_content" in data)) {
          onSessionError("공유된 질문을 불러오지 못했습니다.");
          return;
        }

        const question = data.question_content?.trim();
        if (!question) {
          onSessionError("공유된 질문을 불러오지 못했습니다.");
          return;
        }

        onSessionError(null);
        setShareStarter({
          question_content: question,
          tickers: Array.isArray(data.tickers)
            ? data.tickers.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          title: typeof data.title === "string" ? data.title : null,
        });
      } catch {
        if (!stale && !cancelledRef.current) {
          onSessionError("공유된 질문을 불러오지 못했습니다.");
        }
      }
    }

    void loadShareStarter();

    return () => {
      stale = true;
    };
  }, [cancelledRef, onSessionError, shareToken]);

  const clearShareStarter = useCallback(() => setShareStarter(null), []);

  return { shareStarter, clearShareStarter };
}
