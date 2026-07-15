"use client";

import {
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  toCompanyMeta,
  type CompaniesResponse,
  type CompanyMeta,
} from "@/lib/chat/company-meta";

export interface UseChatCompanyMetaParams {
  activeTicker: string | null;
  existingSessionId: string | null;
  contextTickers: readonly string[];
  contextTickersKey: string;
  cancelledRef: MutableRefObject<boolean>;
  onSessionError: (message: string) => void;
}

export interface UseChatCompanyMetaResult {
  companyMetaByTicker: Record<string, CompanyMeta>;
  setCompanyMetaByTicker: Dispatch<
    SetStateAction<Record<string, CompanyMeta>>
  >;
}

export function useChatCompanyMeta({
  activeTicker,
  existingSessionId,
  contextTickers,
  contextTickersKey,
  cancelledRef,
  onSessionError,
}: UseChatCompanyMetaParams): UseChatCompanyMetaResult {
  const [companyMetaByTicker, setCompanyMetaByTicker] = useState<
    Record<string, CompanyMeta>
  >({});

  useEffect(() => {
    if (existingSessionId || !activeTicker) return;

    let stale = false;
    const tickerToValidate = activeTicker;

    async function validateTicker() {
      const normalizedTicker = tickerToValidate.trim().toUpperCase();
      try {
        const response = await fetch(
          `/api/companies?ticker=${encodeURIComponent(normalizedTicker)}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as CompaniesResponse;
        const isIndexed =
          response.ok &&
          data.companies?.some(
            (company) => company.ticker === normalizedTicker,
          );
        const matchedCompany = data.companies?.find(
          (company) => company.ticker === normalizedTicker,
        );

        if (matchedCompany && !stale && !cancelledRef.current) {
          setCompanyMetaByTicker((current) => ({
            ...current,
            [normalizedTicker]: toCompanyMeta(matchedCompany, normalizedTicker),
          }));
        }

        if (!isIndexed && !stale && !cancelledRef.current) {
          onSessionError(
            `현재 온톨로지 인덱스에 없는 회사입니다: ${normalizedTicker}`,
          );
        }
      } catch {
        if (!stale && !cancelledRef.current) {
          onSessionError("회사 인덱스를 확인하지 못했습니다.");
        }
      }
    }

    void validateTicker();

    return () => {
      stale = true;
    };
  }, [activeTicker, cancelledRef, existingSessionId, onSessionError]);

  useEffect(() => {
    if (contextTickers.length === 0) return;

    let stale = false;
    const missingTickers = contextTickers
      .map((contextTicker) => contextTicker.trim().toUpperCase())
      .filter((contextTicker) => !companyMetaByTicker[contextTicker]);

    if (missingTickers.length === 0) return;

    async function loadCompanyMeta() {
      const entries = await Promise.all(
        missingTickers.map(async (missingTicker) => {
          try {
            const response = await fetch(
              `/api/companies?ticker=${encodeURIComponent(missingTicker)}`,
              { cache: "no-store" },
            );
            const data = (await response.json()) as CompaniesResponse;
            const company = data.companies?.find(
              (item) => item.ticker === missingTicker,
            );
            return [
              missingTicker,
              company
                ? toCompanyMeta(company, missingTicker)
                : { ticker: missingTicker, name: null, sector: null },
            ] as const;
          } catch {
            return [
              missingTicker,
              { ticker: missingTicker, name: null, sector: null },
            ] as const;
          }
        }),
      );

      if (stale || cancelledRef.current) return;
      setCompanyMetaByTicker((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    }

    void loadCompanyMeta();

    return () => {
      stale = true;
    };
  }, [cancelledRef, companyMetaByTicker, contextTickers, contextTickersKey]);

  return { companyMetaByTicker, setCompanyMetaByTicker };
}
