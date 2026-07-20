import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";

export interface CheckupCounts {
  urgentFilings: number;
  unreadFilings: number;
  openQuestions: number;
  staleNotes: number;
}

export function buildCheckupCandidate(
  counts: CheckupCounts,
  timezone: string,
  now: Date,
  checkupAt = "08:30:00",
): PulseCandidate | null {
  const local = localDateParts(now, timezone);
  const [targetHour, targetMinute] = checkupAt.split(":").map(Number);
  if (local.hour < targetHour || (local.hour === targetHour && local.minute < targetMinute)) return null;
  const total = counts.unreadFilings + counts.openQuestions + counts.staleNotes;
  if (total === 0) return null;
  const localDate = `${local.year}-${pad(local.month)}-${pad(local.day)}`;
  const parts = [
    counts.unreadFilings ? `안 읽은 공시 ${counts.unreadFilings}건` : null,
    counts.openQuestions ? `열린 질문 ${counts.openQuestions}개` : null,
    counts.staleNotes ? `다시 볼 메모 ${counts.staleNotes}개` : null,
  ].filter(Boolean).join(" · ");
  const priority = counts.urgentFilings > 0 ? "high" : "normal";
  return {
    item_key: makePulseItemKey("checkup", localDate),
    kind: "checkup",
    trigger: "schedule",
    source_type: "checkup",
    source_id: localDate,
    ticker: null,
    coverage_status: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: "오늘의 리서치 체크업",
    title: counts.urgentFilings > 0
      ? `먼저 확인할 중요 공시가 ${counts.urgentFilings}건 있습니다`
      : `오늘 확인할 항목이 ${total}개 있습니다`,
    body: parts,
    reason_code: "daily_checkup",
    reason_label: "흩어진 새 항목을 하루 한 번 요약했습니다.",
    priority,
    occurred_at: now.toISOString(),
    available_at: now.toISOString(),
    expires_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: `checkup:${localDate}`,
    primary_action: { type: "link", label: "중요 공시 보기", href: "/filings" },
    secondary_actions: [{ type: "mutation", label: "오늘 체크 완료", action: "review" }],
    metadata: {
      urgent_filings: counts.urgentFilings,
      unread_filings: counts.unreadFilings,
      open_questions: counts.openQuestions,
      stale_notes: counts.staleNotes,
    },
  };
}

function localDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
