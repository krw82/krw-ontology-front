"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  buildFilingJudgmentDraftKey,
  clearFilingJudgmentDraft,
  loadFilingJudgmentDraft,
  saveFilingJudgmentDraft,
} from "@/lib/pulse/judgment-draft-store";
import type {
  FilingJudgmentImpact,
  FilingJudgmentNextAction,
  PulseItem,
  UserFilingJudgment,
  UserFilingJudgmentSummary,
} from "@/types/api-contracts";

export type FilingJudgmentValue = UserFilingJudgmentSummary;

interface FilingJudgmentPanelProps {
  item: PulseItem;
  questionHref: string | null;
  draftOwnerId: string;
  onSaved: (item: PulseItem, judgment: FilingJudgmentValue) => void;
}

const IMPACT_OPTIONS: Array<{
  value: FilingJudgmentImpact;
  label: string;
  icon: string;
}> = [
  { value: "positive", label: "긍정", icon: "trending_up" },
  { value: "neutral", label: "중립", icon: "trending_flat" },
  { value: "negative", label: "부정", icon: "trending_down" },
  { value: "unclear", label: "판단 보류", icon: "help" },
];

const NEXT_ACTION_OPTIONS: Array<{
  value: FilingJudgmentNextAction;
  label: string;
  icon: string;
}> = [
  { value: "complete", label: "검토 완료", icon: "done" },
  { value: "update_thesis", label: "가설 업데이트", icon: "edit_note" },
  { value: "create_question", label: "질문 만들기", icon: "chat_add_on" },
  { value: "review_later", label: "나중에 보기", icon: "schedule" },
];

const REVIEW_DELAY_OPTIONS = [
  { days: 1, label: "내일" },
  { days: 7, label: "7일 후" },
  { days: 30, label: "30일 후" },
] as const;

export default function FilingJudgmentPanel({
  item,
  questionHref,
  draftOwnerId,
  onSaved,
}: FilingJudgmentPanelProps) {
  const router = useRouter();
  const existing = item.judgment ?? null;
  const [impactDraft, setImpactDraft] =
    useState<FilingJudgmentImpact | null>(null);
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null);
  const [pendingAction, setPendingAction] =
    useState<FilingJudgmentNextAction | null>(null);
  const [reviewDelayDays, setReviewDelayDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const clientMutationIdRef = useRef(createClientMutationId());
  const startedTrackedRef = useRef(false);
  const userEditedRef = useRef(false);

  const draftKey = useMemo(
    () =>
      buildFilingJudgmentDraftKey({
        ownerId: draftOwnerId,
        filingEventId: item.source_id,
      }),
    [draftOwnerId, item.source_id],
  );

  const impact = impactDraft ?? existing?.impact ?? null;
  const summary = summaryDraft ?? existing?.summary ?? "";

  const thesisTitle = useMemo(() => {
    const title = item.linked_thesis?.title?.trim();
    return title || null;
  }, [item.linked_thesis?.title]);

  useEffect(() => {
    userEditedRef.current = false;
    const draft = loadFilingJudgmentDraft(draftKey);
    if (!draft || userEditedRef.current) {
      setDraftRestored(false);
      return;
    }
    setImpactDraft(draft.impact);
    setSummaryDraft(draft.summary);
    setReviewDelayDays(draft.reviewDelayDays);
    setDraftRestored(true);
  }, [draftKey]);

  function persistDraft({
    nextImpact = impact,
    nextSummary = summary,
    nextReviewDelayDays = reviewDelayDays,
  }: {
    nextImpact?: FilingJudgmentImpact | null;
    nextSummary?: string;
    nextReviewDelayDays?: number;
  } = {}) {
    userEditedRef.current = true;
    setDraftRestored(false);
    saveFilingJudgmentDraft({
      key: draftKey,
      impact: nextImpact,
      summary: nextSummary,
      reviewDelayDays: nextReviewDelayDays,
    });
  }

  async function submit(nextAction: FilingJudgmentNextAction) {
    const normalizedSummary = summary.trim();
    if (!impact || !normalizedSummary || pendingAction) return;
    setPendingAction(nextAction);
    setError(null);

    try {
      const hasExistingJudgment = Boolean(existing);
      const currentJudgment = hasExistingJudgment
        ? await loadCurrentJudgment(item.source_id)
        : null;
      if (
        existing &&
        currentJudgment?.revision_number !== existing.revision_number
      ) {
        throw new Error(
          "다른 화면에서 판단이 먼저 바뀌었습니다. 피드를 새로고침한 뒤 다시 시도해주세요.",
        );
      }
      const thesisLinks = currentJudgment
        ? currentJudgment.thesis_links.map((link) => ({
            thesis_id: link.id,
            impact: link.impact,
          }))
        : item.linked_thesis
          ? [{ thesis_id: item.linked_thesis.id, impact }]
          : [];
      const monitoringRules = (currentJudgment?.monitoring_rules ?? [])
        .filter((rule) => rule.enabled && rule.rule_type !== "scheduled_review")
        .map((rule) => ({
          rule_type: rule.rule_type,
          operator: rule.operator,
          value: rule.value,
          next_review_at: rule.next_review_at,
        }));
      if (nextAction === "review_later") {
        monitoringRules.push({
          rule_type: "scheduled_review",
          operator: "on_or_after",
          value: null,
          next_review_at: scheduledReviewAt(reviewDelayDays),
        });
      }
      const body = {
        client_mutation_id: clientMutationIdRef.current,
        context_ticker: item.ticker,
        impact,
        next_action: nextAction,
        summary: normalizedSummary,
        thesis_links: thesisLinks,
        monitoring_rules: monitoringRules,
        ...(existing
          ? { expected_revision_number: existing.revision_number }
          : {}),
      };
      const response = await fetch(
        `/api/filings/${encodeURIComponent(item.source_id)}/judgment`,
        {
          method: hasExistingJudgment ? "PATCH" : "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        judgment?: UserFilingJudgment;
        idempotent_replay?: boolean;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.judgment) {
        throw new Error(
          payload?.error?.message || "판단을 저장하지 못했습니다.",
        );
      }

      clearFilingJudgmentDraft(draftKey);
      onSaved(item, payload.judgment);
      setImpactDraft(null);
      setSummaryDraft(null);
      setReviewDelayDays(7);
      setDraftRestored(false);
      clientMutationIdRef.current = createClientMutationId();

      const destination = nextActionDestination({
        nextAction,
        questionHref,
        ticker: item.ticker,
      });
      if (destination) router.push(destination);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "판단을 저장하지 못했습니다.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      className="mt-lg rounded-[14px] border border-hairline bg-surface-soft p-base"
      aria-labelledby={`judgment-${item.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-xs">
        <div>
          <p
            id={`judgment-${item.id}`}
            className="text-[13px] font-black text-ink"
          >
            내 판단에 미치는 영향
          </p>
          <p className="mt-1 text-[12px] font-semibold leading-5 text-muted">
            공시가 내 기존 관점에 어떤 신호인지 직접 남깁니다.
          </p>
        </div>
        {thesisTitle ? (
          <span className="max-w-full truncate rounded-full bg-white px-sm py-1 text-[11px] font-extrabold text-muted">
            연결된 가설 · {thesisTitle}
          </span>
        ) : null}
      </div>

      <div
        className="mt-sm grid grid-cols-2 gap-xs sm:grid-cols-4"
        role="radiogroup"
        aria-label="공시 영향"
      >
        {IMPACT_OPTIONS.map((option) => {
          const selected = impact === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pendingAction !== null}
              onClick={() => {
                if (!startedTrackedRef.current) {
                  startedTrackedRef.current = true;
                  trackClientEventSilently("filing_judgment_started", {
                    filing_event_id: item.source_id,
                    judgment_id: existing?.id,
                    revision_id: existing?.current_revision_id,
                    revision_number: existing?.revision_number ?? 0,
                    ticker: item.ticker,
                    has_previous_judgment: Boolean(existing),
                    source: "pulse",
                    status: "started",
                  });
                }
                setImpactDraft(option.value);
                persistDraft({ nextImpact: option.value });
                setError(null);
              }}
              className={[
                "inline-flex min-h-11 items-center justify-center gap-1 rounded-[10px] border px-xs text-[12px] font-extrabold transition-colors disabled:cursor-wait disabled:opacity-60",
                selected
                  ? "border-primary bg-primary-fixed text-on-primary-fixed"
                  : "border-hairline bg-white text-body hover:border-primary/45 hover:text-ink",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[16px]"
              >
                {option.icon}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>

      <label className="mt-base block" htmlFor={`judgment-summary-${item.id}`}>
        <span className="text-[12px] font-black text-ink">
          왜 이렇게 판단했나요?
        </span>
        <span className="ml-1 text-[11px] font-semibold text-muted">
          한 문장
        </span>
        <textarea
          id={`judgment-summary-${item.id}`}
          value={summary}
          maxLength={1_200}
          rows={2}
          disabled={pendingAction !== null}
          onChange={(event) => {
            const nextSummary = event.target.value;
            setSummaryDraft(nextSummary);
            persistDraft({ nextSummary });
            setError(null);
          }}
          placeholder="예: 신규 계약은 긍정적이지만 마진 기여 시점은 아직 불확실합니다."
          className="mt-xs min-h-20 w-full resize-y rounded-[10px] border border-hairline bg-white px-sm py-xs text-[13px] font-semibold leading-5 text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-wait disabled:opacity-60"
        />
        <span className="mt-1 block text-right text-[10px] font-semibold tabular-nums text-muted">
          {summary.length}/1200
        </span>
        {draftRestored ? (
          <span className="mt-1 block text-[11px] font-semibold text-muted" role="status">
            임시 저장된 판단을 복원했습니다.
          </span>
        ) : null}
      </label>

      <div className="mt-base border-t border-hairline pt-sm">
        <div className="flex flex-wrap items-center justify-between gap-xs">
          <p className="text-[12px] font-black text-ink">다음 행동</p>
          <label className="inline-flex min-h-11 items-center gap-xs text-[11px] font-bold text-muted">
            다시 볼 시점
            <select
              value={reviewDelayDays}
              disabled={pendingAction !== null}
              onChange={(event) => {
                const nextReviewDelayDays = Number(event.target.value);
                setReviewDelayDays(nextReviewDelayDays);
                persistDraft({ nextReviewDelayDays });
              }}
              className="min-h-11 rounded-[10px] border border-hairline bg-white px-xs text-[12px] font-extrabold text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              aria-label="나중에 다시 볼 시점"
            >
              {REVIEW_DELAY_OPTIONS.map((option) => (
                <option key={option.days} value={option.days}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-xs flex flex-wrap gap-xs">
          {NEXT_ACTION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={!impact || !summary.trim() || pendingAction !== null}
              onClick={() => void submit(option.value)}
              className={[
                "inline-flex min-h-11 items-center gap-1 rounded-[10px] px-sm text-[12px] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                option.value === "complete"
                  ? "bg-ink text-white hover:bg-primary"
                  : "border border-hairline bg-white text-body hover:border-primary/45 hover:text-ink",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "material-symbols-outlined text-[16px]",
                  pendingAction === option.value ? "animate-spin" : "",
                ].join(" ")}
              >
                {pendingAction === option.value
                  ? "progress_activity"
                  : option.icon}
              </span>
              {pendingAction === option.value
                ? "저장 중"
                : option.value === "review_later"
                  ? `${reviewDelayLabel(reviewDelayDays)} 다시 보기`
                  : option.label}
            </button>
          ))}
        </div>
        {!impact || !summary.trim() ? (
          <p className="mt-xs text-[11px] font-semibold text-muted">
            영향과 한 문장 이유를 남기면 다음 행동을 선택할 수 있습니다.
          </p>
        ) : null}
        {error ? (
          <p className="mt-xs text-[12px] font-bold text-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

async function loadCurrentJudgment(
  filingEventId: string,
): Promise<UserFilingJudgment> {
  const response = await fetch(
    `/api/filings/${encodeURIComponent(filingEventId)}/judgment`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  const payload = (await response.json().catch(() => null)) as {
    judgment?: UserFilingJudgment;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.judgment) {
    throw new Error(
      payload?.error?.message ||
        "현재 판단을 불러오지 못했습니다. 새로고침한 뒤 다시 시도해주세요.",
    );
  }
  return payload.judgment;
}

function scheduledReviewAt(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString();
}

function reviewDelayLabel(days: number): string {
  return REVIEW_DELAY_OPTIONS.find((option) => option.days === days)?.label ??
    `${days}일 후`;
}

function createClientMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pulse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nextActionDestination({
  nextAction,
  questionHref,
  ticker,
}: {
  nextAction: FilingJudgmentNextAction;
  questionHref: string | null;
  ticker: string | null;
}): string | null {
  if (
    nextAction === "create_question" &&
    questionHref &&
    questionHref.startsWith("/") &&
    !questionHref.startsWith("//")
  ) {
    return questionHref;
  }
  if (nextAction === "update_thesis" && ticker) {
    return `/watchlist/${encodeURIComponent(ticker)}`;
  }
  return null;
}
