"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  toCompanyMeta,
  type CompaniesResponse,
  type CompanyMeta,
} from "@/lib/chat/company-meta";
import { filterGuruCompanies } from "@/lib/chat/guru-company-search";

const GURU_COMPANY_FETCH_LIMIT = 500;
const GURU_COMPANY_VISIBLE_BATCH_SIZE = 10;

export interface UseGuruCompanyPickerParams {
  enabled: boolean;
  locale: string;
}

export interface UseGuruCompanyPickerResult {
  isOpen: boolean;
  query: string;
  results: CompanyMeta[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  hasMore: boolean;
  open: (initialQuery: string) => void;
  close: () => void;
  onQueryChange: (value: string) => void;
  loadMore: () => void;
}

export function useGuruCompanyPicker({
  enabled,
  locale,
}: UseGuruCompanyPickerParams): UseGuruCompanyPickerResult {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [allResults, setAllResults] = useState<CompanyMeta[]>([]);
  const [visibleCount, setVisibleCount] = useState(
    GURU_COMPANY_VISIBLE_BATCH_SIZE,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !isOpen) return;

    let stale = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          limit: String(GURU_COMPANY_FETCH_LIMIT),
        });
        const response = await fetch(`/api/companies?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as
          | CompaniesResponse
          | { error?: { message?: string } }
          | null;

        if (stale || controller.signal.aborted) return;
        if (!response.ok || !data || !("companies" in data)) {
          throw new Error("회사 목록을 불러오지 못했습니다.");
        }

        setAllResults((data.companies ?? []).map((company) => toCompanyMeta(company)));
      } catch (requestError) {
        if (stale || controller.signal.aborted) return;
        setAllResults([]);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "회사 목록을 불러오지 못했습니다.",
        );
      } finally {
        if (!stale && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      stale = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [enabled, isOpen]);

  const filteredResults = useMemo(
    () => filterGuruCompanies(allResults, query, locale),
    [allResults, locale, query],
  );
  const results = useMemo(
    () => filteredResults.slice(0, visibleCount),
    [filteredResults, visibleCount],
  );
  const hasMore = results.length < filteredResults.length;

  const open = useCallback((initialQuery: string) => {
    setQuery(initialQuery);
    setVisibleCount(GURU_COMPANY_VISIBLE_BATCH_SIZE);
    setError(null);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
    setVisibleCount(GURU_COMPANY_VISIBLE_BATCH_SIZE);
  }, []);
  const loadMore = useCallback(() => {
    setVisibleCount((current) =>
      Math.min(
        current + GURU_COMPANY_VISIBLE_BATCH_SIZE,
        filteredResults.length,
      ),
    );
  }, [filteredResults.length]);

  return {
    isOpen,
    query,
    results,
    loading,
    error,
    totalCount: filteredResults.length,
    hasMore,
    open,
    close,
    onQueryChange,
    loadMore,
  };
}
