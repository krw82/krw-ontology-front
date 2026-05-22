"use client";

import type { EntitlementStatus } from "@/types/entitlement";

interface UsageStatusProps {
  entitlement: EntitlementStatus | null;
  loading?: boolean;
  variant?: "composer" | "menu" | "panel";
}

function usageLabel(entitlement: EntitlementStatus | null): string {
  if (!entitlement) return "사용량 확인 중";

  return `${entitlement.usage.remaining_questions.toLocaleString()}회 남음`;
}

function usageDetail(entitlement: EntitlementStatus | null): string {
  if (!entitlement) return "오늘 리서치 사용량을 불러오는 중입니다.";

  return `${entitlement.usage.questions_used.toLocaleString()}/${entitlement.usage.questions_limit.toLocaleString()}회 사용`;
}

export default function UsageStatus({
  entitlement,
  loading = false,
  variant = "composer",
}: UsageStatusProps) {
  const percent = loading ? 0 : entitlement?.usage.percent_used ?? 0;
  const planLabel = entitlement?.plan.label ?? "Free";
  const alertLevel = entitlement?.usage.alert_level ?? "ok";
  const accentClass =
    alertLevel === "blocked"
      ? "bg-error"
      : alertLevel === "warning"
        ? "bg-primary"
        : "bg-primary-container";
  const textClass =
    alertLevel === "blocked"
      ? "text-error"
      : alertLevel === "warning"
        ? "text-primary"
        : "text-primary";

  if (variant === "panel") {
    return (
      <div className="rounded-[8px] border border-hairline bg-canvas p-base sm:p-lg">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
              {planLabel}
            </p>
            <h2 className={`mt-2 text-[20px] font-black leading-[1.2] ${alertLevel === "blocked" ? "text-error" : "text-ink"}`}>
              {usageLabel(entitlement)}
            </h2>
          </div>
          <p className="text-[13px] font-semibold leading-5 text-muted">
            {usageDetail(entitlement)}
          </p>
        </div>
        <div className="mt-base h-2 overflow-hidden rounded-full bg-surface-dim">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${accentClass}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {entitlement?.upgrade.enabled && (
          <div className="mt-base rounded-[8px] border border-hairline bg-surface px-sm py-sm">
            <p className={`text-[13px] font-extrabold leading-5 ${textClass}`}>
              {entitlement.upgrade.title}
            </p>
            <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
              {entitlement.upgrade.message}
            </p>
          </div>
        )}
        <p className="mt-sm text-[13px] font-medium leading-5 text-muted">
          월간 사용량은 현재 플랜 쿼터 기준으로 표시됩니다.
        </p>
      </div>
    );
  }

  if (variant === "menu") {
    return (
      <div className="rounded-[8px] border border-hairline bg-surface px-sm py-sm">
        <div className="flex items-center justify-between gap-sm">
          <span className="truncate text-[13px] font-extrabold leading-5 text-ink">
            {planLabel}
          </span>
          <span className={`shrink-0 text-[12px] font-bold leading-5 ${textClass}`}>
            {usageLabel(entitlement)}
          </span>
        </div>
        <div className="mt-xs h-1.5 overflow-hidden rounded-full bg-surface-dim">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${accentClass}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-xs text-xs text-muted-soft">
      <span className="hidden font-semibold text-muted sm:inline">
        {planLabel}
      </span>
      <span aria-hidden="true" className="hidden text-muted-soft sm:inline">
        ·
      </span>
      <span className={`truncate ${alertLevel === "blocked" ? "text-error" : ""}`}>
        {usageDetail(entitlement)}
      </span>
    </div>
  );
}
