import Link from "next/link";

import type { EntitlementStatus } from "@/types/entitlement";

function formatCreditResetTime(entitlement: EntitlementStatus | null): string {
  const rawResetTime =
    entitlement?.usage.resets_at || entitlement?.usage.period_end || "";
  const resetTime = new Date(rawResetTime);
  if (Number.isNaN(resetTime.getTime())) return "다음 주간 충전 시점";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(resetTime);
}

export default function CreditLimitErrorCard({
  entitlement,
}: {
  entitlement: EntitlementStatus | null;
}) {
  const resetLabel = formatCreditResetTime(entitlement);
  const billingHref = entitlement?.upgrade.href || "/settings/billing";

  return (
    <div
      className="overflow-hidden rounded-[8px] border border-hairline bg-canvas shadow-[0_18px_48px_rgba(10,11,13,0.08)]"
      role="alert"
    >
      <div className="h-1 bg-primary" aria-hidden="true" />
      <div className="p-base sm:p-lg">
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="w-full min-w-0 flex-1 [overflow-wrap:normal]">
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
              WEEKLY LIMIT
            </p>
            <h3 className="mt-2 text-[20px] font-black leading-7 text-ink sm:text-[22px]">
              주간 분석 한도를 모두 사용했습니다.
            </h3>
            <p className="mt-2 w-full max-w-[36rem] break-normal text-[14px] font-semibold leading-6 text-body [overflow-wrap:normal] [word-break:keep-all] sm:text-[15px]">
              다음 충전 전까지 새 분석은 시작할 수 없습니다. 기존 리서치와
              노트북은 계속 볼 수 있습니다.
            </p>
          </div>
        </div>

        <div className="mt-base grid gap-2 border-t border-hairline pt-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-muted">
              다음 충전
            </p>
            <p className="mt-1 text-[15px] font-black leading-5 text-ink">
              {resetLabel}
            </p>
          </div>
          <Link
            href={billingHref}
            className="inline-flex h-11 items-center justify-center gap-1 rounded-[8px] bg-surface-dark px-sm text-[14px] font-extrabold text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            업그레이드 플랜 보기
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[18px]"
            >
              arrow_forward
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
