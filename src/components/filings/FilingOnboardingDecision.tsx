"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  remainingCoverageCompanies,
  type CoverageOnboardingProgress,
} from "@/lib/onboarding/coverage-flow";
import { cn } from "@/lib/utils";
import type {
  FilingJudgmentImpact,
  UserFilingJudgment,
} from "@/types/api-contracts";

type TriggerChoice = "next_form" | "seven_days" | "thirty_days";

type FilingOnboardingDecisionProps = {
  filingEventId: string;
  ticker: string;
  formType: string;
  sourceHref: string;
  companiesHref: string;
  continueHref: string | null;
};

const IMPACT_OPTIONS: Array<{
  value: FilingJudgmentImpact;
  label: string;
}> = [
  { value: "positive", label: "긍정적" },
  { value: "neutral", label: "영향 없음" },
  { value: "negative", label: "부정적" },
  { value: "unclear", label: "판단 보류" },
];

export default function FilingOnboardingDecision({
  filingEventId,
  ticker,
  formType,
  sourceHref,
  companiesHref,
  continueHref,
}: FilingOnboardingDecisionProps) {
  const [sourceOpened, setSourceOpened] = useState(false);
  const [sourceChecking, setSourceChecking] = useState(false);
  const [impact, setImpact] = useState<FilingJudgmentImpact | null>(null);
  const [summary, setSummary] = useState("");
  const [triggerChoice, setTriggerChoice] =
    useState<TriggerChoice>("next_form");
  const [judgment, setJudgment] = useState<UserFilingJudgment | null>(null);
  const [progress, setProgress] =
    useState<CoverageOnboardingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutationIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const sourceAttemptedRef = useRef(false);
  const sourceCheckSequenceRef = useRef(0);

  const confirmDurableSourceOpen = useCallback(async () => {
    const sequence = ++sourceCheckSequenceRef.current;
    setSourceChecking(true);
    for (const delay of [180, 400, 800, 1_200]) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
      if (sourceCheckSequenceRef.current !== sequence) return;
      const response = await fetch(
        `/api/onboarding/coverage?${new URLSearchParams({
          filing_event_id: filingEventId,
        }).toString()}`,
        { cache: "no-store" },
      ).catch(() => null);
      if (!response?.ok) continue;
      const payload = (await response.json().catch(() => null)) as {
        progress?: CoverageOnboardingProgress & {
          filing_evidence_opened?: boolean;
        };
      } | null;
      if (!payload) continue;
      if (payload.progress) setProgress(payload.progress);
      if (!payload.progress?.filing_evidence_opened) continue;
      setSourceOpened(true);
      setSourceChecking(false);
      setError(null);
      return;
    }
    if (sourceCheckSequenceRef.current !== sequence) return;
    setSourceChecking(false);
    setError(
      "SEC 원문 열기를 아직 확인하지 못했습니다. 새 탭이 열렸는지 확인한 뒤 다시 시도해주세요.",
    );
  }, [filingEventId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/filings/${encodeURIComponent(filingEventId)}/judgment`, {
        cache: "no-store",
      }),
      fetch(
        `/api/onboarding/coverage?${new URLSearchParams({
          filing_event_id: filingEventId,
        }).toString()}`,
        { cache: "no-store" },
      ),
    ])
      .then(async ([judgmentResponse, progressResponse]) => {
        const existing = judgmentResponse.ok
          ? ((await judgmentResponse.json()) as {
              judgment?: UserFilingJudgment;
            }).judgment ?? null
          : null;
        const nextProgress = progressResponse.ok
          ? ((await progressResponse.json()) as {
              progress?: CoverageOnboardingProgress & {
                filing_evidence_opened?: boolean;
              };
            }).progress ?? null
          : null;
        if (!active) return;
        if (existing) {
          setJudgment(existing);
          setImpact(existing.impact);
          setSummary(existing.summary);
          setTriggerChoice(triggerChoiceFromJudgment(existing));
        }
        if (nextProgress) setProgress(nextProgress);
        if (nextProgress?.filing_evidence_opened) setSourceOpened(true);
      })
      .catch(() => {
        // The form remains usable; completion is still verified after saving.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filingEventId]);

  useEffect(() => {
    const handleFocus = () => {
      if (
        !sourceAttemptedRef.current ||
        sourceOpened ||
        sourceChecking
      ) return;
      void confirmDurableSourceOpen();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [confirmDurableSourceOpen, sourceChecking, sourceOpened]);

  useEffect(() => {
    return () => {
      sourceCheckSequenceRef.current += 1;
    };
  }, []);

  function recordStarted() {
    if (startedRef.current) return;
    startedRef.current = true;
    trackClientEventSilently("filing_judgment_started", {
      filing_event_id: filingEventId,
      ticker,
      source: "onboarding",
    });
  }

  async function saveJudgment() {
    if (!sourceOpened) {
      setError("먼저 SEC 원문을 열어 근거를 확인해주세요.");
      return;
    }
    if (!impact || !summary.trim()) {
      setError("영향과 한 문장 판단을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    recordStarted();
    try {
      mutationIdRef.current ??= createMutationId();
      const response = await fetch(
        `/api/filings/${encodeURIComponent(filingEventId)}/judgment`,
        {
          method: judgment ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_mutation_id: mutationIdRef.current,
            context_ticker: ticker,
            impact,
            next_action: "review_later",
            summary: summary.trim(),
            rationale: "",
            thesis_links: [],
            monitoring_rules: [
              monitoringRule(triggerChoice, normalizedFormType(formType)),
            ],
            ...(judgment
              ? { expected_revision_number: judgment.revision_number }
              : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          (await readErrorMessage(response)) ??
            "판단을 저장하지 못했습니다. 다시 시도해주세요.",
        );
      }
      const payload = (await response.json()) as {
        judgment: UserFilingJudgment;
      };
      setJudgment(payload.judgment);
      mutationIdRef.current = null;
      setProgress(await loadProgressAfterSave());
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "판단을 저장하지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      setSaving(false);
    }
  }

  const activated = progress?.activated === true;
  const remainingCompanies = progress
    ? remainingCoverageCompanies(progress)
    : null;

  return (
    <section className="mt-lg rounded-[10px] border border-primary/30 bg-primary-fixed/45 p-lg">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              step === 0 || sourceOpened || judgment
                ? step <= (judgment ? 2 : sourceOpened ? 1 : 0)
                  ? "bg-primary"
                  : "bg-primary/15"
                : "bg-primary/15",
            )}
          />
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
        {judgment ? "첫 판단 저장 · 3/3" : "첫 판단 준비 · 2/3"}
      </p>
      <h2 className="mt-1 text-[18px] font-black leading-6 text-ink">
        원문 확인 → 내 판단 → 다음 확인 조건
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        자동 요약만으로 끝내지 않고, SEC 원문을 연 뒤 판단과 다음에 돌아올 조건을 함께 남깁니다.
      </p>

      <div className="mt-md rounded-[8px] border border-primary/20 bg-canvas p-sm">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div>
            <p className="text-sm font-extrabold text-ink">1. SEC 원문 확인</p>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              새 탭에서 원문을 열어 핵심 문맥을 확인하세요.
            </p>
          </div>
          <a
            href={sourceHref}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              sourceAttemptedRef.current = true;
              setSourceChecking(true);
              setError(null);
              recordStarted();
              void confirmDurableSourceOpen();
            }}
            className="inline-flex min-h-11 items-center rounded-[7px] border border-primary/30 bg-white px-sm text-sm font-extrabold text-primary hover:bg-primary-fixed"
          >
            {sourceChecking
              ? "원문 확인 중…"
              : sourceOpened
                ? "원문 다시 열기"
                : "SEC 원문 열기"}
            <span className="material-symbols-outlined ml-1 text-[16px]" aria-hidden="true">
              open_in_new
            </span>
          </a>
        </div>
        {sourceOpened ? (
          <p className="mt-2 text-xs font-bold text-emerald-700" role="status">
            원문 열기를 기록했습니다. 이제 판단을 남겨주세요.
          </p>
        ) : sourceChecking ? (
          <p className="mt-2 text-xs font-bold text-primary" role="status">
            새 탭 요청과 서버 기록을 확인하고 있습니다…
          </p>
        ) : null}
      </div>

      <fieldset
        className="mt-md"
        disabled={!sourceOpened || loading || saving}
      >
        <legend className="text-sm font-extrabold text-ink">
          2. 기존 판단에 어떤 영향인가요?
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {IMPACT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={impact === option.value}
              onClick={() => {
                recordStarted();
                setImpact(option.value);
              }}
              className={cn(
                "min-h-11 rounded-[7px] border px-2 text-sm font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                impact === option.value
                  ? "border-primary bg-primary text-on-primary"
                  : "border-hairline bg-canvas text-ink hover:border-primary",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-sm font-extrabold text-ink">
          한 문장 판단
          <textarea
            value={summary}
            maxLength={1200}
            rows={3}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="예: 경영진 변화는 확인했지만 전망 변경이 없어 당장은 관찰이 필요합니다."
            className="mt-2 w-full resize-y rounded-[8px] border border-hairline bg-canvas px-sm py-sm text-sm font-semibold leading-6 text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </fieldset>

      <fieldset
        className="mt-md"
        disabled={!sourceOpened || loading || saving}
      >
        <legend className="text-sm font-extrabold text-ink">
          3. 언제 다시 확인할까요?
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(
            [
              ["next_form", `다음 ${normalizedFormType(formType)}`],
              ["seven_days", "7일 후"],
              ["thirty_days", "30일 후"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-[7px] border px-sm text-sm font-bold",
                triggerChoice === value
                  ? "border-primary bg-primary-fixed text-primary"
                  : "border-hairline bg-canvas text-ink",
              )}
            >
              <input
                type="radio"
                name="coverage-onboarding-trigger"
                value={value}
                checked={triggerChoice === value}
                onChange={() => setTriggerChoice(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p className="mt-3 text-sm font-bold leading-5 text-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={!sourceOpened || !impact || !summary.trim() || saving || loading}
        onClick={() => void saveJudgment()}
        className="mt-md inline-flex min-h-12 items-center rounded-[8px] bg-primary px-base text-sm font-extrabold text-on-primary transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving
          ? "저장 중…"
          : judgment
            ? "판단과 다음 확인 수정"
            : "판단과 다음 확인 저장"}
      </button>

      {judgment ? (
        <div className="mt-md rounded-[8px] border border-hairline bg-canvas p-sm" role="status">
          <p className="text-sm font-black text-ink">
            {activated ? "커버리지 준비 완료" : "첫 판단을 저장했습니다"}
          </p>
          {activated ? (
            <>
              <p className="mt-1 text-xs leading-5 text-muted">
                서버에서 coverage_activated 마일스톤을 확인했습니다. 다음 실제 사건부터 이전 판단과 달라진 점을 이어서 볼 수 있습니다.
              </p>
              {continueHref ? (
                <Link
                  href={continueHref}
                  className="mt-2 inline-flex min-h-11 items-center px-xs text-xs font-extrabold text-primary underline underline-offset-4"
                >
                  원래 작업으로 계속
                </Link>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 text-xs leading-5 text-muted">
                {remainingCompanies && remainingCompanies > 0
                  ? `실제 활성화까지 회사 ${remainingCompanies}개를 더 커버리지에 담아주세요.`
                  : "활성화 조건을 서버에서 확인 중입니다. 원문·판단·다음 확인 조건은 저장되었습니다."}
              </p>
              <Link
                href={companiesHref}
                className="mt-2 inline-flex min-h-11 items-center px-xs text-xs font-extrabold text-primary underline underline-offset-4"
              >
                다음 회사 선택
              </Link>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function monitoringRule(choice: TriggerChoice, formType: string) {
  if (choice === "next_form") {
    return {
      rule_type: "filing_form" as const,
      operator: "matches" as const,
      value: formType,
      next_review_at: null,
    };
  }
  const days = choice === "seven_days" ? 7 : 30;
  return {
    rule_type: "scheduled_review" as const,
    operator: "on_or_after" as const,
    value: null,
    next_review_at: new Date(Date.now() + days * 86_400_000).toISOString(),
  };
}

function normalizedFormType(value: string): string {
  return value.replace(/\/A$/i, "") || value;
}

function triggerChoiceFromJudgment(
  judgment: UserFilingJudgment,
): TriggerChoice {
  const rule = judgment.monitoring_rules[0];
  if (!rule || rule.rule_type !== "scheduled_review" || !rule.next_review_at) {
    return "next_form";
  }
  return Date.parse(rule.next_review_at) - Date.now() <= 14 * 86_400_000
    ? "seven_days"
    : "thirty_days";
}

async function loadProgressAfterSave(): Promise<CoverageOnboardingProgress | null> {
  for (const delay of [0, 250, 800]) {
    if (delay) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
    }
    const response = await fetch("/api/onboarding/coverage", {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) continue;
    const payload = (await response.json()) as {
      progress?: CoverageOnboardingProgress;
    };
    if (payload.progress?.activated || delay === 800) {
      return payload.progress ?? null;
    }
  }
  return null;
}

function createMutationId(): string {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `onboarding-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown };
    };
    return typeof payload.error?.message === "string"
      ? payload.error.message
      : null;
  } catch {
    return null;
  }
}
