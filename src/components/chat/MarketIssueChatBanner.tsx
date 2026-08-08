"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  marketIssueStatusClass,
  normalizeMarketIssueDetail,
  type MarketIssueCard,
} from "@/components/news/news-model";

type BannerState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; issue: MarketIssueCard };

/**
 * 채팅 상단에 표시되는 뉴스(마켓 이슈) 컨텍스트 배너.
 * `news_issue_id` 쿼리 파라미터로 진입했을 때, 사용자가 어떤 이슈를 분석 중인지 보여준다.
 * 첫 메시지 전송 후 `clearComposerPrefillParams`가 URL에서 파라미터를 제거하면 자동으로 사라진다.
 */
export default function MarketIssueChatBanner({ issueId }: { issueId: string }) {
  const [state, setState] = useState<BannerState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);

  const loadDetail = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: "loading" });

    try {
      const response = await fetch(`/api/news/issues/${encodeURIComponent(issueId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("market_issue_detail_failed");
      const payload = normalizeMarketIssueDetail(await response.json());
      if (!payload || controller.signal.aborted) throw new Error("invalid_market_issue_detail");
      setState({ kind: "ready", issue: payload.issue });
    } catch {
      if (controller.signal.aborted) return;
      setState({ kind: "error" });
    }
  }, [issueId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadDetail();
    });
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
    };
  }, [loadDetail]);

  if (state.kind === "loading") {
    return (
      <div className="mx-auto mb-base w-full max-w-3xl animate-pulse">
        <div className="flex items-center gap-xs">
          <div className="h-3 w-20 rounded-full bg-hairline" />
          <div className="h-5 w-16 rounded-full bg-hairline" />
        </div>
        <div className="mt-xs h-5 w-3/4 rounded bg-hairline" />
        <div className="mt-xs h-4 w-full rounded bg-hairline" />
      </div>
    );
  }

  // 에러/빈 상태에서는 사용자 경험을 해치지 않도록 조용히 숨김 (URL 파라미터는 그대로 백엔드에 전달됨)
  if (state.kind === "error") return null;

  const { issue } = state;

  return (
    <div
      data-onboarding-target="market-issue-context"
      className="mx-auto mb-base w-full max-w-3xl rounded-[18px] border border-hairline bg-white p-base"
    >
      <div className="flex items-center justify-between gap-sm">
        <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
          분석 중인 이슈
        </p>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${marketIssueStatusClass(
            issue.statusTone,
          )}`}
        >
          {issue.statusLabel}
        </span>
      </div>

      <h2 className="mt-1 text-[18px] font-extrabold leading-6 tracking-[-0.02em] text-ink">
        {issue.title}
      </h2>

      {issue.summary ? (
        <p className="mt-xs line-clamp-2 text-[13px] leading-6 text-body">{issue.summary}</p>
      ) : null}

      <Link
        href={`/news/${encodeURIComponent(issue.id)}?source=chat`}
        className="mt-sm inline-flex items-center gap-1 text-[12px] font-extrabold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
          newspaper
        </span>
        뉴스 원문 보기
        <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
          arrow_forward
        </span>
      </Link>
    </div>
  );
}
