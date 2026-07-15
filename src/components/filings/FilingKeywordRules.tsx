"use client";

import { FormEvent, useEffect, useState } from "react";

type Rule = { id: string; phrase: string; ticker: string | null; enabled: boolean };

const PRESETS = ["guidance", "going concern", "restatement", "impairment", "liquidity", "investigation", "cybersecurity"];

export default function FilingKeywordRules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [limit, setLimit] = useState(10);
  const [phrase, setPhrase] = useState("");
  const [ticker, setTicker] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/filing-keyword-rules", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ rules?: Rule[]; limit?: number }> : null)
      .then((payload) => {
        if (!active || !payload) return;
        setRules(payload.rules ?? []);
        setLimit(payload.limit ?? 10);
      });
    return () => { active = false; };
  }, []);

  async function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !phrase.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/filing-keyword-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase, ticker: ticker || null }) });
      const payload = await response.json() as { rule?: Rule; error?: { message?: string } };
      if (!response.ok || !payload.rule) throw new Error(payload.error?.message ?? "키워드 규칙을 저장하지 못했습니다.");
      setRules((current) => [payload.rule!, ...current]);
      setPhrase("");
      setTicker("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "키워드 규칙을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(ruleId: string) {
    setMessage(null);
    const response = await fetch(`/api/filing-keyword-rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("키워드 규칙을 삭제하지 못했습니다.");
      return;
    }
    setRules((current) => current.filter((rule) => rule.id !== ruleId));
  }

  return <section className="mt-lg border-t border-hairline pt-lg">
    <h2 className="text-sm font-extrabold text-ink">키워드 규칙</h2>
    <p className="mt-1 text-xs leading-5 text-muted">추적 중인 기업의 새 8-K·6-K 원문에서 일치한 짧은 문맥만 확인합니다. PDF와 이미지는 초기 검색 대상에서 제외합니다.</p>
    <form onSubmit={(event) => void addRule(event)} className="mt-md grid gap-sm sm:grid-cols-[minmax(0,1fr)_110px_auto]">
      <input value={phrase} onChange={(event) => setPhrase(event.target.value)} maxLength={120} placeholder="예: guidance" className="min-h-10 rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink" aria-label="키워드 또는 구문" />
      <input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} maxLength={12} placeholder="전체 기업" className="min-h-10 rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink" aria-label="특정 종목 코드, 비워 두면 전체" />
      <button type="submit" disabled={saving || rules.length >= limit} className="min-h-10 rounded-[7px] bg-primary px-base text-sm font-extrabold text-on-primary disabled:cursor-not-allowed disabled:opacity-60">{saving ? "추가 중…" : "규칙 추가"}</button>
    </form>
    <div className="mt-sm flex flex-wrap gap-1.5" aria-label="추천 키워드">
      {PRESETS.map((preset) => <button key={preset} type="button" onClick={() => setPhrase(preset)} className="rounded-[999px] border border-hairline px-sm py-1 text-xs font-bold text-muted hover:border-primary hover:text-primary">{preset}</button>)}
    </div>
    {message ? <p className="mt-sm text-xs leading-5 text-error" role="status">{message}</p> : null}
    <p className="mt-sm text-xs text-muted">{rules.length}/{limit}개 사용 중</p>
    {rules.length ? <ul className="mt-sm divide-y divide-hairline rounded-[8px] border border-hairline">{rules.map((rule) => <li key={rule.id} className="flex items-center justify-between gap-sm px-base py-sm"><span className="min-w-0"><span className="block truncate text-sm font-extrabold text-ink">{rule.phrase}</span><span className="block text-xs text-muted">{rule.ticker ? `${rule.ticker}에서만` : "모든 추적 기업"}</span></span><button type="button" onClick={() => void removeRule(rule.id)} className="min-h-9 shrink-0 rounded-[7px] px-sm text-xs font-extrabold text-muted hover:text-error">삭제</button></li>)}</ul> : null}
  </section>;
}
