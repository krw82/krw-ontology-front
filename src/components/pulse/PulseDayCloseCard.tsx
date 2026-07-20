"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PulseFeedResponse,
  PulseItem,
} from "@/types/api-contracts";

export interface PulseDayCloseSummary {
  judgmentCompleted: number;
  observation: number;
  thesisUpdates: number;
  followUpQuestions: number;
  nextChecks: number;
}

interface PulseDecisionSessionResult {
  closed_at: string;
  judgment_count: number;
  observation_count: number;
  thesis_update_count: number;
  open_question_count: number;
  next_check_count: number;
  outcome: "completed" | "deferred";
}

interface PulseDayCloseCardProps {
  feed: PulseFeedResponse;
  feedSessionId: string;
  busy: boolean;
}

const SUMMARY_ITEMS: Array<{
  key: keyof PulseDayCloseSummary;
  label: string;
  icon: string;
}> = [
  { key: "judgmentCompleted", label: "판단 완료", icon: "task_alt" },
  { key: "observation", label: "관찰", icon: "visibility" },
  { key: "thesisUpdates", label: "가설 업데이트", icon: "edit_note" },
  { key: "followUpQuestions", label: "후속 질문", icon: "forum" },
  { key: "nextChecks", label: "다음 확인", icon: "schedule" },
];

export default function PulseDayCloseCard({
  feed,
  feedSessionId,
  busy,
}: PulseDayCloseCardProps) {
  const previewSummary = useMemo(() => buildPulseDayCloseSummary(feed), [feed]);
  const [closedState, setClosedState] = useState<{
    snapshotAt: string;
    result: PulseDecisionSessionResult | null;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [errorState, setErrorState] = useState<{
    snapshotAt: string;
    message: string;
  } | null>(null);
  const closedResult = closedState?.snapshotAt === feed.snapshot_at
    ? closedState.result
    : null;
  const error = errorState?.snapshotAt === feed.snapshot_at
    ? errorState.message
    : null;
  const closed = Boolean(closedResult?.closed_at);
  const summary = closedResult
    ? pulseDecisionSessionToSummary(closedResult)
    : previewSummary;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      timezone: feed.timezone,
    });
    void fetch(`/api/pulse/session-close?${params}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("load_failed");
        return response.json() as Promise<Partial<PulseDecisionSessionResult>>;
      })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setClosedState({
            snapshotAt: feed.snapshot_at,
            result: isDecisionSessionResult(payload) ? payload : null,
          });
        }
      })
      .catch((loadError) => {
        if (
          !controller.signal.aborted &&
          !(loadError instanceof DOMException && loadError.name === "AbortError")
        ) {
          setErrorState({
            snapshotAt: feed.snapshot_at,
            message:
              "오늘 종료 상태를 확인하지 못했습니다. 종료는 다시 시도할 수 있습니다.",
          });
        }
      });
    return () => controller.abort();
  }, [feed.snapshot_at, feed.timezone]);

  async function closeDay() {
    if (busy || pending || closed) return;
    setPending(true);
    setErrorState(null);
    try {
      const response = await fetch("/api/pulse/session-close", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          feed_session_id: feedSessionId,
          timezone: feed.timezone,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<PulseDecisionSessionResult> & { error?: { message?: string } })
        | null;
      if (!response.ok || !isDecisionSessionResult(payload)) {
        throw new Error(
          payload?.error?.message || "오늘의 판단을 종료하지 못했습니다.",
        );
      }
      setClosedState({
        snapshotAt: feed.snapshot_at,
        result: payload,
      });
    } catch (closeError) {
      setErrorState({
        snapshotAt: feed.snapshot_at,
        message:
          closeError instanceof Error
            ? closeError.message
            : "오늘의 판단을 종료하지 못했습니다.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="rounded-[18px] border border-hairline bg-white px-lg py-lg text-left shadow-[0_10px_30px_rgba(16,24,40,0.045)] sm:px-xl"
      aria-labelledby="pulse-day-close-heading"
    >
      <div className="flex items-start gap-sm">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-primary-fixed/60 text-primary"
          aria-hidden="true"
        >
          <span className="material-symbols-outlined text-[20px]">
            fact_check
          </span>
        </span>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-primary">
            오늘 정리
          </p>
          <h2
            id="pulse-day-close-heading"
            className="mt-1 text-[20px] font-black tracking-[-0.025em] text-ink"
          >
            오늘의 판단을 여기서 닫습니다
          </h2>
          <p className="mt-xs text-[13px] font-semibold leading-5 text-muted">
            확인한 결과와 남겨둔 다음 행동만 모았습니다.
          </p>
        </div>
      </div>

      <dl className="mt-base grid grid-cols-2 gap-xs sm:grid-cols-5">
        {SUMMARY_ITEMS.map((item) => (
          <div
            key={item.key}
            className="rounded-[11px] border border-hairline bg-surface-soft px-sm py-sm"
          >
            <dt className="flex items-center gap-1 text-[11px] font-extrabold text-muted">
              <span
                className="material-symbols-outlined text-[15px]"
                aria-hidden="true"
              >
                {item.icon}
              </span>
              {item.label}
            </dt>
            <dd className="mt-1 text-[19px] font-black tabular-nums text-ink">
              {summary[item.key]}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-base border-t border-hairline pt-base">
        {closed ? (
          <p
            className="flex min-h-11 items-center gap-xs text-[13px] font-extrabold text-primary"
            role="status"
          >
            <span
              className="material-symbols-outlined text-[19px]"
              aria-hidden="true"
            >
              check_circle
            </span>
            {closedResult?.outcome === "completed"
              ? "오늘의 판단을 모두 정리했습니다. 새 항목은 다음 방문에서 확인합니다."
              : "오늘 피드를 종료했습니다. 남은 판단은 다음 방문에 그대로 이어집니다."}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <p className="max-w-[420px] text-[12px] font-semibold leading-5 text-muted">
              더 볼 항목을 임의로 붙이지 않습니다. 준비됐다면 오늘 세션을
              명확히 마무리하세요.
            </p>
            <button
              type="button"
              disabled={busy || pending}
              onClick={() => void closeDay()}
              className="inline-flex min-h-11 shrink-0 items-center gap-xs rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white transition-colors hover:bg-primary disabled:cursor-wait disabled:opacity-55"
            >
              {busy || pending ? "저장 중…" : "오늘 종료"}
              <span
                className="material-symbols-outlined text-[17px]"
                aria-hidden="true"
              >
                check
              </span>
            </button>
          </div>
        )}
        {error ? (
          <p className="mt-xs text-[12px] font-bold text-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function pulseDecisionSessionToSummary(
  session: Pick<
    PulseDecisionSessionResult,
    | "judgment_count"
    | "observation_count"
    | "thesis_update_count"
    | "open_question_count"
    | "next_check_count"
  >,
): PulseDayCloseSummary {
  return {
    judgmentCompleted: session.judgment_count,
    observation: session.observation_count,
    thesisUpdates: session.thesis_update_count,
    followUpQuestions: session.open_question_count,
    nextChecks: session.next_check_count,
  };
}

function isDecisionSessionResult(
  value: Partial<PulseDecisionSessionResult> | null | undefined,
): value is PulseDecisionSessionResult {
  return Boolean(
    value?.closed_at &&
      Number.isInteger(value.judgment_count) &&
      Number.isInteger(value.observation_count) &&
      Number.isInteger(value.thesis_update_count) &&
      Number.isInteger(value.open_question_count) &&
      Number.isInteger(value.next_check_count) &&
      (value.outcome === "completed" || value.outcome === "deferred"),
  );
}

export function buildPulseDayCloseSummary(
  feed: PulseFeedResponse,
): PulseDayCloseSummary {
  const items = uniqueItems([
    ...feed.items,
    ...feed.active_analysis_items,
  ]);
  const judgments = items
    .map((item) => item.judgment)
    .filter((judgment): judgment is NonNullable<PulseItem["judgment"]> =>
      Boolean(judgment),
    )
    .filter((judgment) =>
      isSameLocalDay(
        judgment.updated_at,
        feed.snapshot_at,
        feed.timezone,
      ),
    );
  const observation = judgments.filter(
    (judgment) => judgment.next_action === "review_later",
  ).length;

  return {
    judgmentCompleted: judgments.length,
    observation,
    thesisUpdates: judgments.filter(
      (judgment) => judgment.next_action === "update_thesis",
    ).length,
    followUpQuestions: judgments.filter(
      (judgment) => judgment.next_action === "create_question",
    ).length,
    nextChecks:
      feed.summary.actionable_count +
      feed.summary.active_analysis_count +
      observation,
  };
}

function uniqueItems(items: PulseItem[]): PulseItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function isSameLocalDay(
  value: string,
  reference: string,
  timezone: string,
): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date(value)) === formatter.format(new Date(reference));
  } catch {
    return value.slice(0, 10) === reference.slice(0, 10);
  }
}
