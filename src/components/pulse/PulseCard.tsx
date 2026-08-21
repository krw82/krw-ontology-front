"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { type PulseDeviceSignal } from "@/lib/pulse/device-ranking";
import { pulseCompanyHref, pulseCompanyName } from "@/lib/pulse/company-display";
import CompanyLogo from "@/components/CompanyLogo";
import EditorialImageCarousel from "@/components/editorial/EditorialImageCarousel";
import type { PulseFeedResponse, PulseItem, PulseLinkAction, PulseMutationAction } from "@/types/api-contracts";

interface PulseCardProps {
  item: PulseItem;
  position: number;
  pending: boolean;
  researchPending: boolean;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  onMutation: (item: PulseItem, action: PulseMutationAction) => void;
  onDeviceSignal: (item: PulseItem, signal: PulseDeviceSignal) => void;
  onResearch: (item: PulseItem) => void;
}

function pulseImpressionStorageKey(feedSessionId: string, itemId: string): string {
  return `pulse-impression:${feedSessionId}:${itemId}`;
}

export default function PulseCard({
  item,
  position,
  pending,
  researchPending,
  feedSessionId,
  rankingVersion,
  onMutation,
  onDeviceSignal,
  onResearch,
}: PulseCardProps) {
  const ref = useRef<HTMLElement>(null);
  const impressionSent = useRef(false);
  const reducedMotion = useReducedMotion();
  const [researchSubmitted, setResearchSubmitted] = useState(false);
  const isDevelopmentShowcase = item.metadata.development_showcase === true;
  const hasSourceGroundedBrief = item.kind === "filing" && item.metadata.filing_brief_ready === true;

  useEffect(() => {
    if (isDevelopmentShowcase) return;
    const element = ref.current;
    if (!element) return;
    const sessionKey = pulseImpressionStorageKey(feedSessionId, item.id);
    if (window.sessionStorage.getItem(sessionKey) === "1") return;
    let impressionTimer: number | null = null;
    const observer = new IntersectionObserver((entries) => {
      const sufficientlyVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      if (!sufficientlyVisible && impressionTimer !== null) {
        window.clearTimeout(impressionTimer);
        impressionTimer = null;
      }
      if (!sufficientlyVisible || impressionSent.current || impressionTimer !== null) return;
      impressionTimer = window.setTimeout(() => {
        impressionTimer = null;
        impressionSent.current = true;
        trackClientEventSilently("pulse_item_impression", {
          item_kind: item.kind,
          position,
          priority: item.priority,
          item_state: item.state,
          phase: item.phase,
          has_ticker: Boolean(item.ticker),
          visible_ms: 1_000,
          feed_session_id: feedSessionId,
          ranking_version: rankingVersion,
          reason_code: item.reason_code,
          has_source_grounded_brief: hasSourceGroundedBrief,
        });
        onDeviceSignal(item, "view");
        window.sessionStorage.setItem(sessionKey, "1");
        observer.disconnect();
      }, 1_000);
    }, { threshold: [0.5] });
    observer.observe(element);
    return () => {
      if (impressionTimer !== null) window.clearTimeout(impressionTimer);
      observer.disconnect();
    };
  }, [feedSessionId, hasSourceGroundedBrief, isDevelopmentShowcase, item, item.id, item.kind, item.phase, item.priority, item.reason_code, item.state, item.ticker, onDeviceSignal, position, rankingVersion]);

  const primary = item.primary_action;
  const analysisStatus = item.kind === "analysis" ? String(item.metadata.run_status ?? "") : null;
  const analysisActive = item.kind === "analysis" && item.phase === "active";
  const isFourPanelLearning = item.kind === "learning" && item.metadata.learning_kind === "four_panel";
  const isCompanyStory = item.kind === "learning"
    && (typeof item.metadata.editorial_series_id === "string"
      || stringMetadata(item, "source_label") === "KRW.O 회사 이야기");
  const hasInteractiveMedia = item.kind === "learning"
    && (item.metadata.learning_kind === "image" || item.metadata.learning_kind === "carousel");
  const detailAction = primary.type === "link" && !analysisActive && item.kind !== "question"
    && !isFourPanelLearning && !isCompanyStory && !hasInteractiveMedia
    ? primary
    : null;
  const researchAction = pulseResearchAction(item);
  const visibleAction = researchAction ?? primary;
  const visibleDetail = pulseVisibleDetail(item);
  const companyName = pulseCompanyName(item);
  const companyHref = pulseCompanyHref(item.ticker);
  const recordPrimaryOpen = () => {
    onDeviceSignal(item, item.kind === "filing" ? "source_open" : "open");
    trackClientEventSilently("pulse_item_opened", {
      item_kind: item.kind,
      action: "primary",
      item_state: item.state,
      phase: item.phase,
      feed_session_id: feedSessionId,
      ranking_version: rankingVersion,
      reason_code: item.reason_code,
      has_source_grounded_brief: hasSourceGroundedBrief,
    });
  };
  const recordResearchOpen = () => {
    onDeviceSignal(item, "open");
    trackClientEventSilently(researchAction?.analytics_name === "pulse_answer_prefilled" ? "pulse_answer_prefilled" : "pulse_item_opened", {
      item_kind: item.kind,
      action: "research",
      item_state: item.state,
      phase: item.phase,
      feed_session_id: feedSessionId,
      ranking_version: rankingVersion,
      reason_code: item.reason_code,
      has_source_grounded_brief: hasSourceGroundedBrief,
    });
  };

  return (
    <motion.article
      ref={ref}
      className={`group relative overflow-hidden border-b border-hairline py-lg sm:py-xl ${detailAction ? "cursor-pointer" : ""}`}
      data-pulse-kind={item.kind}
      data-pulse-state={item.state}
      aria-hidden={researchSubmitted || undefined}
      initial={false}
      animate={researchSubmitted ? "exiting" : "visible"}
      variants={{
        visible: { opacity: 1, height: "auto", y: 0 },
        exiting: {
          opacity: 0,
          height: 0,
          paddingBottom: 0,
          paddingTop: 0,
          borderBottomWidth: 0,
          borderColor: "transparent",
          y: -8,
        },
      }}
      transition={{ duration: reducedMotion ? 0 : 0.26, ease: "easeOut" }}
    >
      {detailAction ? (
        <Link
          href={detailAction.href}
          className="absolute inset-0 z-0 rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`${item.title} 상세 보기`}
          onClick={recordPrimaryOpen}
        />
      ) : null}
      <div className={`relative z-10 flex items-start gap-sm ${detailAction ? "pointer-events-none" : ""}`}>
        {companyHref ? (
          <Link
            href={companyHref}
            className="pointer-events-auto shrink-0 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`${companyName} 회사 소개`}
          >
            <PulseIdentity item={item} companyName={companyName} />
          </Link>
        ) : (
          <PulseIdentity item={item} companyName={companyName} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-sm">
            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-5">
              {companyHref ? (
                <Link
                  href={companyHref}
                  className="pointer-events-auto font-extrabold text-ink underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {companyName}
                </Link>
              ) : (
                <span className="font-extrabold text-ink">{companyName}</span>
              )}
              <span className="text-muted" aria-hidden="true">·</span>
              <span className="font-semibold text-muted">{pulseKindLabel(item)}</span>
              {item.state === "reviewed" ? <span className="font-medium text-muted">검토함</span> : null}
            </p>
            <time className="sr-only" dateTime={item.occurred_at}>
              {formatRelativeTime(item.occurred_at)}
            </time>
          </div>

          {item.kind === "filing" ? (
            <FilingChangeBrief item={item} />
          ) : (
            <h2 className="mt-xs text-[17px] font-bold leading-[1.45] tracking-[-0.02em] text-ink sm:text-[19px]">
              {item.title}
            </h2>
          )}

          {analysisActive ? (
            <p className="mt-xs flex items-center gap-xs text-[12px] font-semibold text-muted" role="status">
              <span className="material-symbols-outlined pulse-refresh-turn text-[15px] text-primary" aria-hidden="true">progress_activity</span>
              {analysisStatus === "running" ? "근거 확인 중" : "분석 대기 중"}
            </p>
          ) : null}

          {item.kind === "learning" && (item.metadata.learning_kind === "image" || item.metadata.learning_kind === "carousel") ? (
            <PulseEditorialMedia item={item} />
          ) : null}
          {visibleDetail ? (
            <p className="mt-xs line-clamp-2 text-[14px] leading-6 text-body">{visibleDetail}</p>
          ) : null}

          {!isFourPanelLearning && !isCompanyStory ? (
            <div className="mt-sm flex min-h-11 flex-wrap items-center gap-x-base gap-y-0.5">
              {item.kind !== "filing" && !analysisActive && pulseActionContext(item, analysisStatus) ? (
                <span className="text-[12px] font-medium text-muted">{pulseActionContext(item, analysisStatus)}</span>
              ) : null}
              {researchAction ? (
                <button
                  type="button"
                  disabled={researchPending || researchSubmitted}
                  className="pointer-events-auto relative -left-8 mx-auto inline-flex min-h-12 w-[calc(100%-1.5rem)] max-w-[320px] items-center justify-center gap-2 rounded-[12px] border border-[#2d4160] bg-[#101827] px-base text-[13px] font-bold tracking-[0.01em] text-[#dce8ff] shadow-[0_8px_20px_rgba(16,24,40,0.16)] transition-colors hover:border-[#7da5ff] hover:bg-[#18243a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60"
                  onClick={() => {
                    setResearchSubmitted(true);
                    recordResearchOpen();
                    onResearch(item);
                  }}
                >
                  <span>{researchPending ? "분석 중…" : "리서치 시작"}</span>
                  <ResearchNowIcon />
                </button>
              ) : visibleAction.type === "link" ? (
                <Link
                  href={visibleAction.href}
                  className="pointer-events-auto inline-flex min-h-11 items-center gap-1 text-[13px] font-bold text-primary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={recordPrimaryOpen}
                >
                  {visibleAction.label}
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span>
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onMutation(item, visibleAction.action)}
                  className="pointer-events-auto inline-flex min-h-11 items-center gap-1 text-[13px] font-bold text-primary underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
                >
                  {visibleAction.label}
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {isFourPanelLearning ? <LearningStoryCarousel item={item} /> : null}
    </motion.article>
  );
}

function ResearchNowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
    >
      <path
        d="M12 1.5c1.35 6.2 4.3 9.15 10.5 10.5-6.2 1.35-9.15 4.3-10.5 10.5C10.65 16.3 7.7 13.35 1.5 12 7.7 10.65 10.65 7.7 12 1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Keep the original primary link as the card's source/detail destination and
 * promote a research link to the single visible CTA. Mutation actions stay in
 * the item contract so their eventual source-detail placement does not affect
 * feed composition.
 */
function pulseResearchAction(item: PulseItem): PulseLinkAction | null {
  if (item.kind === "analysis" || item.kind === "question") {
    return item.primary_action.type === "link" ? item.primary_action : null;
  }

  const existing = item.secondary_actions.find((action): action is PulseLinkAction =>
    action.type === "link" && action.href.startsWith("/chat/"));
  if (existing) return existing;
  if (!item.ticker || item.kind === "checkup" || item.kind === "learning") return null;

  return {
    type: "link",
    label: "이 이슈로 리서치",
    href: "/pulse#research-activity",
    analytics_name: "pulse_answer_prefilled",
  };
}

function PulseIdentity({
  item,
  companyName,
}: {
  item: PulseItem;
  companyName: string;
}) {
  if (item.ticker) {
    return (
      <CompanyLogo
        ticker={item.ticker}
        companyName={companyName}
        className="size-9 text-[10px] text-ink"
        imageSize={48}
      />
    );
  }

  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-hairline bg-white text-[11px] font-black text-primary" aria-hidden="true">
      K
    </span>
  );
}

function LearningStoryCarousel({ item }: { item: PulseItem }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const slides = [1, 2, 3, 4].map((panel) => String(item.metadata[`panel_${panel}`] ?? ""));

  const moveToSlide = (index: number) => {
    const slide = scrollerRef.current?.children.item(index);
    if (!slide) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    slide.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest", inline: "start" });
  };

  return (
    <section className="mt-base" aria-label="공시 알림 흐름 슬라이드" aria-roledescription="carousel">
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-[16px] border border-hairline bg-surface-soft [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => {
          const width = event.currentTarget.clientWidth;
          if (width === 0) return;
          const nextIndex = Math.min(slides.length - 1, Math.max(0, Math.round(event.currentTarget.scrollLeft / width)));
          setActiveIndex((current) => current === nextIndex ? current : nextIndex);
        }}
      >
        {slides.map((copy, index) => {
          const [headline, ...detail] = copy.split("\n").map((line) => line.trim()).filter(Boolean);
          return (
            <article
              key={`${copy}-${index}`}
              aria-label={`${index + 1}번째 장면: ${headline ?? "공시 흐름"}`}
              className={`relative flex aspect-[4/5] w-full shrink-0 snap-center overflow-hidden p-lg text-white sm:aspect-[16/10] ${LEARNING_SLIDE_STYLES[index]}`}
            >
              <span className="absolute -right-12 -top-14 size-52 rounded-full bg-white/15 blur-2xl" aria-hidden="true" />
              <span className="absolute -bottom-16 -left-12 size-48 rounded-full border-[28px] border-white/10" aria-hidden="true" />
              <div className="relative flex w-full flex-col justify-between">
                <div className="flex items-center justify-between text-[11px] font-black tracking-[0.16em] text-white/80">
                  <span>FILING FLOW</span>
                  <span>{String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}</span>
                </div>
                <div>
                  <span className="material-symbols-outlined text-[46px]" aria-hidden="true">{LEARNING_SLIDE_ICONS[index]}</span>
                  <h3 className="mt-base whitespace-pre-line text-[30px] font-black leading-[1.12] tracking-[-0.045em] sm:text-[34px]">{headline ?? `장면 ${index + 1}`}</h3>
                  {detail.length > 0 ? <p className="mt-sm max-w-[22rem] text-[15px] font-semibold leading-6 text-white/85">{detail.join(" ")}</p> : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="mt-sm flex items-center justify-between gap-sm">
        <p className="text-[12px] font-semibold text-muted">좌우로 넘겨 네 장면 보기</p>
        <div className="flex items-center gap-1.5" aria-label="슬라이드 페이지">
          {slides.map((copy, index) => (
            <button
              key={`${copy}-${index}`}
              type="button"
              aria-label={`${index + 1}번째 장면으로 이동`}
              aria-current={activeIndex === index ? "true" : undefined}
              className={`h-2 rounded-full transition-[width,background-color] ${activeIndex === index ? "w-5 bg-primary" : "w-2 bg-hairline hover:bg-outline"}`}
              onClick={() => moveToSlide(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

const LEARNING_SLIDE_STYLES = [
  "bg-[#155EEF]",
  "bg-[#7F56D9]",
  "bg-[#027A48]",
  "bg-[#B54708]",
] as const;

const LEARNING_SLIDE_ICONS = [
  "notifications_active",
  "manage_search",
  "description",
  "edit_note",
] as const;

function PulseEditorialMedia({ item }: { item: PulseItem }) {
  const assetCount = Math.max(0, Math.min(8, Number(item.metadata.asset_count ?? 0)));
  const assets = Array.from({ length: assetCount }, (_, index) => ({
    src: String(item.metadata[`asset_${index + 1}`] ?? ""),
    alt: String(item.metadata[`asset_alt_${index + 1}`] ?? `${item.title} 이미지 ${index + 1}`),
    width: numberMetadata(item, `asset_width_${index + 1}`) || null,
    height: numberMetadata(item, `asset_height_${index + 1}`) || null,
  })).filter((asset) => asset.src.length > 0);
  if (assets.length === 0) return null;

  return (
    <EditorialImageCarousel
      slides={assets}
      ariaLabel={`${item.title} 이미지 슬라이드`}
      className="mt-sm"
    />
  );
}

function FilingChangeBrief({ item }: { item: PulseItem }) {
  const changes = filingChanges(item.body);
  return (
    <section className="mt-xs" aria-label="공시 핵심 변화">
      <h2 className="text-[17px] font-bold leading-[1.45] tracking-[-0.02em] text-ink sm:text-[19px]">
        {item.title}
      </h2>
      {changes.length > 0 ? (
        <p className="mt-xs line-clamp-2 text-[14px] leading-6 text-body">{changes.join(" ")}</p>
      ) : null}
    </section>
  );
}

export function filingChanges(body: string): string[] {
  return body
    .split(/(?<=[.!?。])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function pulseKindLabel(item: PulseItem): string {
  if (item.kind === "filing") {
    const formType = stringMetadata(item, "form_type");
    return formType ? `SEC ${formType}` : "새 공시";
  }
  if (item.kind === "analysis") {
    if (item.phase === "active") return "리서치 진행 중";
    if (item.phase === "failed") return "리서치 다시 시도";
    return "리서치 대화";
  }
  if (item.kind === "checkup") return "오늘의 체크업";
  if (item.kind === "question") return "다음 질문";
  if (item.kind === "resurface") return "다시 볼 메모";
  if (item.kind === "news") return "시장 뉴스";
  if (item.kind === "learning" && typeof item.metadata.editorial_series_id === "string") return "회사 이야기";
  return "리서치 읽기";
}

function pulseVisibleDetail(item: PulseItem): string | null {
  if (item.kind === "filing" || item.kind === "analysis" || item.kind === "question") return null;
  if (item.kind === "learning" && item.metadata.learning_kind === "four_panel") return null;
  if (item.kind === "learning" && typeof item.metadata.editorial_series_id === "string") return null;
  const detail = item.body.trim();
  return detail || null;
}

function pulseActionContext(item: PulseItem, analysisStatus: string | null): string {
  if (item.kind === "analysis") {
    if (item.phase === "active") return analysisStatus === "running" ? "근거 확인 중" : "분석 대기 중";
    if (item.phase === "failed") return "다시 시도 가능";
    return "답변과 근거 준비됨";
  }
  if (item.kind === "question") return "";
  if (item.kind === "resurface") return "";
  if (item.kind === "checkup") return "오늘의 확인 항목";
  if (item.kind === "news") return "";
  return stringMetadata(item, "source_label") ?? "리서치 읽기";
}

function stringMetadata(item: PulseItem, key: string): string | null {
  const value = item.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberMetadata(item: PulseItem, key: string): number {
  const value = item.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatRelativeTime(iso: string): string {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (diffMinutes < 1) return "방금";
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(iso));
}
