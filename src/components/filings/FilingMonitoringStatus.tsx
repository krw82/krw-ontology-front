"use client";

import { useEffect, useState } from "react";

type MonitoringStatus = {
  status: "not_tracking" | "healthy" | "attention";
  tracked_companies: number;
  last_success_at: string | null;
  overdue_companies: number;
};

export default function FilingMonitoringStatus() {
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/filing-monitoring-status", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<MonitoringStatus> : null)
      .then((payload) => { if (active && payload) setStatus(payload); });
    return () => { active = false; };
  }, []);
  if (!status || status.status === "not_tracking") return null;
  const healthy = status.status === "healthy";
  return <p className={`mt-md rounded-[8px] px-sm py-sm text-xs leading-5 ${healthy ? "bg-surface-soft text-muted" : "bg-primary-fixed text-ink"}`}><span className="font-extrabold">{healthy ? "최근 점검 정상" : "점검이 지연되고 있습니다"}</span> · {status.tracked_companies}개 기업 추적 중{status.last_success_at ? ` · 최근 ${formatTime(status.last_success_at)}` : ""}{status.overdue_companies ? ` · ${status.overdue_companies}개 확인 필요` : ""}</p>;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
