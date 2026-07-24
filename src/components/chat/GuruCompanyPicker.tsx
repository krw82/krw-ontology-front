"use client";

import CompanyContextPicker from "@/components/company-picker/CompanyContextPicker";
import type { CompanyMeta } from "@/lib/chat/company-meta";

export interface GuruCompanyPickerProps {
  open: boolean;
  locale: string;
  query: string;
  results: CompanyMeta[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  hasMore: boolean;
  onQueryChange: (value: string) => void;
  onLoadMore: () => void;
  onSelect: (company: CompanyMeta) => void;
  onClose: () => void;
}

export default function GuruCompanyPicker({
  open,
  locale,
  query,
  results,
  loading,
  error,
  totalCount,
  hasMore,
  onQueryChange,
  onLoadMore,
  onSelect,
  onClose,
}: GuruCompanyPickerProps) {
  const isKo = locale === "ko";

  return (
    <CompanyContextPicker
      open={open}
      locale={locale}
      query={query}
      results={results}
      loading={loading}
      error={error}
      totalCount={totalCount}
      hasMore={hasMore}
      title={isKo ? "어떤 회사를 상담할까요?" : "Which company should we discuss?"}
      description={
        isKo
          ? "KRW가 가진 회사만 먼저 보여줍니다. 선택하면 이 회사의 최신 보고서가 상담 컨텍스트에 들어갑니다."
          : "Only covered companies are shown first. Selecting one adds its latest filings to the consultation context."
      }
      searchPlaceholder={isKo ? "예: AAPL, 애플, 브로드컴" : "e.g. AAPL, Apple, Broadcom"}
      loadingMessage={isKo ? "회사 목록 확인 중" : "Checking companies"}
      emptyMessage={
        isKo
          ? "현재 커버리지에서 찾지 못했습니다. 티커를 다시 확인해주세요."
          : "No covered company found. Check the ticker again."
      }
      firstResultsLabel={isKo ? "먼저 살펴볼 회사" : "Companies to start with"}
      ariaLabel={isKo ? "상담 회사 선택" : "Choose company for consultation"}
      closeLabel={isKo ? "회사 선택 닫기" : "Close company picker"}
      countLabel={(shown, total, hasMoreResults) =>
        isKo
          ? hasMoreResults
            ? `${Math.min(shown, total)} / ${total}개 표시 중`
            : `${total}개 모두 표시`
          : hasMoreResults
            ? `Showing ${Math.min(shown, total)} / ${total}`
            : `All ${total} shown`
      }
      onQueryChange={onQueryChange}
      onLoadMore={onLoadMore}
      onSelect={onSelect}
      onClose={onClose}
      dataOnboardingTarget="guru-company-picker"
    />
  );
}
