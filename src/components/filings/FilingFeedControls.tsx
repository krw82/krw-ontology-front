"use client";

import { useEffect, useState } from "react";

type FeedState = { active: boolean; created_at: string | null; last_used_at: string | null };

export default function FilingFeedControls() {
  const [state, setState] = useState<FeedState | null>(null);
  const [urls, setUrls] = useState<{ rss: string; ics: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/filing-feed-token", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<FeedState> : null)
      .then((payload) => { if (active && payload) setState(payload); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const issue = async () => {
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/filing-feed-token", { method: "POST" });
      if (!response.ok) throw new Error("feed_issue_failed");
      const { token } = await response.json() as { token: string };
      const base = `${window.location.origin}/api/feeds/filings/${encodeURIComponent(token)}`;
      setUrls({ rss: base, ics: `${base}/calendar` });
      setState({ active: true, created_at: new Date().toISOString(), last_used_at: null });
      setMessage("새 개인 URL을 만들었습니다. 이 화면을 떠나기 전에 필요한 곳에 저장해주세요.");
    } catch {
      setMessage("개인 피드를 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setWorking(false);
    }
  };
  const revoke = async () => {
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/filing-feed-token", { method: "DELETE" });
      if (!response.ok) throw new Error("feed_revoke_failed");
      setState({ active: false, created_at: null, last_used_at: null });
      setUrls(null);
      setMessage("기존 RSS·캘린더 URL을 폐기했습니다.");
    } catch {
      setMessage("개인 피드를 폐기하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setWorking(false);
    }
  };

  return <section className="mt-lg border-t border-hairline pt-lg">
    <h2 className="text-base font-extrabold text-ink">개인 RSS·캘린더</h2>
    <p className="mt-xs text-sm leading-6 text-muted">관심기업의 최근 공시 RSS와 과거 주기 기반 예상 공시 창 ICS를 만듭니다. URL을 아는 사람은 개인 피드를 볼 수 있으므로 공유하지 마세요.</p>
    {urls ? <div className="mt-md space-y-sm"> <FeedUrl label="RSS" url={urls.rss} /><FeedUrl label="예상 공시 창 ICS" url={urls.ics} /></div> : null}
    {message ? <p className="mt-md rounded-[7px] bg-surface-soft px-sm py-sm text-sm leading-6 text-muted" role="status">{message}</p> : null}
    <div className="mt-md flex flex-wrap gap-sm"><button type="button" onClick={() => void issue()} disabled={working} className="min-h-11 rounded-[7px] border border-hairline px-sm text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:opacity-60">{working ? "처리 중…" : state?.active ? "새 URL 재발급" : "개인 URL 만들기"}</button>{state?.active ? <button type="button" onClick={() => void revoke()} disabled={working} className="min-h-11 rounded-[7px] px-sm text-sm font-extrabold text-muted transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-60">URL 폐기</button> : null}</div>
    {state?.active && !urls ? <p className="mt-sm text-xs leading-5 text-muted">보안을 위해 기존 URL은 다시 표시하지 않습니다. 필요하면 새 URL을 재발급하면 이전 URL은 즉시 무효화됩니다.</p> : null}
  </section>;
}

function FeedUrl({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };
  return <div className="rounded-[7px] border border-hairline px-sm py-sm"><div className="flex items-center justify-between gap-sm"><span className="text-xs font-extrabold text-ink">{label}</span><button type="button" onClick={() => void copy()} className="inline-flex min-h-11 items-center px-xs text-xs font-bold text-primary underline underline-offset-4">{copied ? "복사됨" : "복사"}</button></div><p className="mt-1 break-all text-xs leading-5 text-muted">{url}</p></div>;
}
