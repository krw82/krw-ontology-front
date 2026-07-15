"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useSearchParams } from "next/navigation";
import { filingEventTagLabel } from "@/lib/filing-notifications/classification";
import { trackClientEventSilently } from "@/lib/analytics/client";

type Filing = {
  id: string;
  ticker: string;
  display_ticker?: string;
  form_type: string;
  filing_date: string;
  is_amendment: boolean;
  primary_event_tag?: string | null;
  sec_items?: string[];
};

type FilingNotification = {
  id: string;
  kind: "filing_received" | "analysis_ready" | "filing_digest";
  title: string;
  body: string;
  destination_path: string;
  read_at: string | null;
  clicked_at: string | null;
  pinned_at: string | null;
  snoozed_until: string | null;
  archived_at: string | null;
  created_at: string;
  filing: Filing;
};

type InboxView = "active" | "later" | "archived";

export default function FilingInbox() {
  const searchParams = useSearchParams();
  const selectedNotificationId = searchParams.get("notification");
  const [notifications, setNotifications] = useState<FilingNotification[]>([]);
  const [recentFilings, setRecentFilings] = useState<Filing[]>([]);
  const [view, setView] = useState<InboxView>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/filings", { cache: "no-store" }),
      fetch("/api/filings/recent?limit=3", { cache: "no-store" }),
    ])
      .then(async ([notificationsResponse, recentResponse]) => {
        if (!notificationsResponse.ok) throw new Error("filings_unavailable");
        const notificationsPayload = await notificationsResponse.json() as { notifications?: FilingNotification[] };
        const recentPayload = recentResponse.ok
          ? await recentResponse.json() as { filings?: Filing[] }
          : { filings: [] as Filing[] };
        return { notifications: notificationsPayload.notifications ?? [], recent: recentPayload.filings ?? [] };
      })
      .then((payload) => {
        if (!active) return;
        setNotifications(payload.notifications);
        setRecentFilings(payload.recent);
        trackClientEventSilently("filings_inbox_viewed", { notification_count: payload.notifications.length, history_count: payload.recent.length });
        if (payload.recent.length) trackClientEventSilently("filing_history_loaded", { count: payload.recent.length, surface: "filing_inbox" });
      })
      .catch(() => {
        if (active) setError("공시 알림을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedNotificationId) return;
    const selected = notifications.find((notification) => notification.id === selectedNotificationId);
    if (!selected || selected.read_at) return;
    void updateNotification(selectedNotificationId, { read: true }, setNotifications);
  }, [notifications, selectedNotificationId]);

  const grouped = useMemo(() => groupNotifications(notifications), [notifications]);
  const visible = grouped[view];

  if (loading) return <p className="text-sm text-muted">공시 알림을 불러오는 중…</p>;
  if (error) return <p className="rounded-[8px] bg-surface-soft p-md text-sm text-muted">{error}</p>;
  if (!notifications.length && !recentFilings.length) return <p className="rounded-[8px] border border-dashed border-hairline p-lg text-sm leading-6 text-muted">아직 공시를 추적 중인 기업이 없습니다. 회사 페이지에서 새 8-K·6-K 공시 알림을 켜면 최근 공시와 다음 알림이 여기에 표시됩니다.</p>;

  return <div className="space-y-xl">
    <section>
      <div className="mb-sm flex flex-wrap items-center justify-between gap-sm">
        <div><h2 className="text-base font-extrabold text-ink">새 공시</h2><p className="mt-0.5 text-xs text-muted">읽음, 나중에 보기, 핀, 보관 상태는 이 공시함에 남습니다.</p></div>
        <InboxTabs view={view} grouped={grouped} onChange={setView} />
      </div>
      {!visible.length ? <p className="rounded-[8px] border border-dashed border-hairline p-md text-sm text-muted">{emptyCopy(view)}</p> : <div className="space-y-sm">{visible.map((notification) => <NotificationCard key={notification.id} notification={notification} selected={notification.id === selectedNotificationId} onChange={setNotifications} />)}</div>}
    </section>
    {recentFilings.length ? <section><div className="mb-sm flex items-center justify-between gap-sm"><h2 className="text-base font-extrabold text-ink">최근 공시</h2><span className="text-xs text-muted">구독 전 제출된 공시</span></div><div className="space-y-sm">{recentFilings.map((filing) => <HistoryCard key={filing.id} filing={filing} />)}</div></section> : null}
  </div>;
}

function InboxTabs({ view, grouped, onChange }: { view: InboxView; grouped: Record<InboxView, FilingNotification[]>; onChange: (view: InboxView) => void }) {
  const items: Array<{ id: InboxView; label: string }> = [{ id: "active", label: "처리할 공시" }, { id: "later", label: "나중에" }, { id: "archived", label: "보관" }];
  return <div className="flex rounded-[7px] border border-hairline p-0.5" role="tablist" aria-label="공시함 상태">
    {items.map((item) => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => onChange(item.id)} className={`min-h-8 rounded-[5px] px-sm text-xs font-extrabold transition-colors ${view === item.id ? "bg-surface text-ink" : "text-muted hover:text-ink"}`}>{item.label} {grouped[item.id].length}</button>)}
  </div>;
}

function NotificationCard({ notification, selected, onChange }: { notification: FilingNotification; selected: boolean; onChange: Dispatch<SetStateAction<FilingNotification[]>> }) {
  const filing = notification.filing;
  const isRead = Boolean(notification.read_at) || selected;
  const isArchived = Boolean(notification.archived_at);
  const isSnoozed = isFuture(notification.snoozed_until);
  const destination = notification.destination_path || `/filings/${encodeURIComponent(filing.id)}`;
  const change = (body: NotificationUpdate) => void updateNotification(notification.id, body, onChange);
  const open = () => {
    change({ clicked: true });
    trackClientEventSilently(notification.kind === "filing_digest" ? "digest_opened" : "filing_notification_clicked", { ticker: displayTicker(filing), form_type: filing.form_type, notification_id: notification.id, surface: "filing_inbox" });
  };
  return <article className={`rounded-[10px] border p-md ${isRead || isArchived ? "border-hairline bg-canvas" : "border-primary/35 bg-primary-fixed"}`}>
    <div className="flex items-start justify-between gap-sm"><FilingMeta filing={filing} />{notification.pinned_at ? <span className="inline-flex items-center gap-1 text-xs font-bold text-primary"><span aria-hidden="true" className="material-symbols-outlined text-[15px]">keep</span>핀</span> : null}</div>
    <h3 className="mt-sm text-base font-extrabold text-ink">{notification.title}</h3>
    <p className="mt-1 text-sm leading-6 text-muted">{notification.body}</p>
    {isSnoozed ? <p className="mt-sm text-xs font-bold text-primary">{formatSnooze(notification.snoozed_until)}까지 나중에 보기</p> : null}
    <div className="mt-md flex flex-wrap items-center justify-between gap-sm">
      <time className="text-xs text-muted" dateTime={filing.filing_date}>{formatDate(filing.filing_date)}</time>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => change({ pinned: !notification.pinned_at })} className="inline-flex min-h-9 items-center rounded-[7px] px-sm text-xs font-extrabold text-muted hover:bg-surface-soft hover:text-primary" aria-label={notification.pinned_at ? "핀 해제" : "핀 고정"}><span aria-hidden="true" className="material-symbols-outlined text-[17px]">{notification.pinned_at ? "keep_off" : "keep"}</span></button>
        {!isArchived ? <button type="button" onClick={() => change({ snoozed_until: isSnoozed ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })} className="inline-flex min-h-9 items-center rounded-[7px] px-sm text-xs font-extrabold text-muted hover:bg-surface-soft hover:text-primary">{isSnoozed ? "지금 보기" : "나중에"}</button> : null}
        <button type="button" onClick={() => change({ archived: !isArchived })} className="inline-flex min-h-9 items-center rounded-[7px] px-sm text-xs font-extrabold text-muted hover:bg-surface-soft hover:text-primary">{isArchived ? "복원" : "보관"}</button>
        <Link href={destination} onClick={open} className="inline-flex min-h-9 items-center rounded-[7px] border border-hairline px-sm text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary">{notification.kind === "filing_digest" ? "공시함 보기" : "공시 보기"}<span aria-hidden="true" className="material-symbols-outlined ml-1 text-[16px]">arrow_forward</span></Link>
      </div>
    </div>
  </article>;
}

function HistoryCard({ filing }: { filing: Filing }) {
  const label = filingEventTagLabel(filing.primary_event_tag);
  return <article className="rounded-[10px] border border-hairline bg-canvas p-md"><FilingMeta filing={filing} /><h3 className="mt-sm text-base font-extrabold text-ink">{label ?? "SEC 공시"}</h3><p className="mt-1 text-sm leading-6 text-muted">{filing.sec_items?.length ? `SEC Item ${filing.sec_items.join(", ")} 감지` : "구독 전 제출된 최근 공시입니다."}</p><div className="mt-md flex items-center justify-between gap-md"><time className="text-xs text-muted" dateTime={filing.filing_date}>{formatDate(filing.filing_date)}</time><Link href={`/filings/${encodeURIComponent(filing.id)}`} onClick={() => trackClientEventSilently("historical_filing_opened", { filing_event_id: filing.id, ticker: displayTicker(filing), form_type: filing.form_type })} className="inline-flex min-h-9 items-center rounded-[7px] border border-hairline px-sm text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary">공시 보기<span aria-hidden="true" className="material-symbols-outlined ml-1 text-[16px]">arrow_forward</span></Link></div></article>;
}

function FilingMeta({ filing }: { filing: Filing }) {
  return <div className="flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.04em] text-primary"><span>{displayTicker(filing)}</span><span className="rounded-[5px] border border-current/20 px-1.5 py-0.5">{filing.form_type}</span>{filing.is_amendment ? <span>정정</span> : null}</div>;
}

type NotificationUpdate = { read?: boolean; clicked?: boolean; pinned?: boolean; archived?: boolean; snoozed_until?: string | null };

async function updateNotification(notificationId: string, body: NotificationUpdate, setNotifications: Dispatch<SetStateAction<FilingNotification[]>>) {
  const response = await fetch(`/api/filing-notifications/${encodeURIComponent(notificationId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) return;
  const now = new Date().toISOString();
  setNotifications((current) => current.map((item) => item.id !== notificationId ? item : {
    ...item,
    ...(body.read ? { read_at: now } : {}),
    ...(body.clicked ? { clicked_at: now, read_at: now } : {}),
    ...(body.pinned === undefined ? {} : { pinned_at: body.pinned ? now : null }),
    ...(body.archived === undefined ? {} : {
      archived_at: body.archived ? now : null,
      ...(body.archived ? { read_at: now, snoozed_until: null } : {}),
    }),
    ...(body.snoozed_until === undefined ? {} : { snoozed_until: body.snoozed_until }),
  }));
}

function groupNotifications(notifications: FilingNotification[]): Record<InboxView, FilingNotification[]> {
  const now = Date.now();
  const groups: Record<InboxView, FilingNotification[]> = { active: [], later: [], archived: [] };
  for (const notification of notifications) {
    if (notification.archived_at) groups.archived.push(notification);
    else if (notification.snoozed_until && Date.parse(notification.snoozed_until) > now) groups.later.push(notification);
    else groups.active.push(notification);
  }
  for (const items of Object.values(groups)) items.sort((left, right) => Number(Boolean(right.pinned_at)) - Number(Boolean(left.pinned_at)) || Date.parse(right.created_at) - Date.parse(left.created_at));
  return groups;
}

function emptyCopy(view: InboxView) {
  if (view === "later") return "나중에 보기로 미룬 공시가 없습니다.";
  if (view === "archived") return "보관한 공시가 없습니다.";
  return "처리할 새 공시가 없습니다.";
}

function isFuture(value: string | null) {
  return Boolean(value && Date.parse(value) > Date.now());
}

function formatSnooze(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function displayTicker(filing: Filing) {
  return filing.display_ticker ?? filing.ticker;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(date);
}
