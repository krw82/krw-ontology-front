"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CompanyCoverageTimelineItem,
  CompanyCoverageTimelineResponse,
  UserCompanyMonitoringRule,
  UserCompanyQuestion,
  UserCompanyThesis,
  UserCompanyThesisStatus,
  UserThesisCheck,
} from "@/types/api-contracts";

interface CoverageMemoryPanelProps {
  ticker: string;
  initialTheses: UserCompanyThesis[];
  thesisChecks: UserThesisCheck[];
  initialMonitoringRules: UserCompanyMonitoringRule[];
  questions: UserCompanyQuestion[];
}

const STATUS_OPTIONS: Array<{ value: UserCompanyThesisStatus; label: string }> = [
  { value: "active", label: "유지" },
  { value: "needs_review", label: "관찰" },
  { value: "weakened", label: "약화" },
  { value: "mixed", label: "혼합" },
  { value: "archived", label: "종료" },
];

export default function CoverageMemoryPanel({
  ticker,
  initialTheses,
  thesisChecks,
  initialMonitoringRules,
  questions,
}: CoverageMemoryPanelProps) {
  const [theses, setTheses] = useState(initialTheses);
  const [rules, setRules] = useState(initialMonitoringRules);
  const [timeline, setTimeline] = useState<CompanyCoverageTimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [showForm, setShowForm] = useState(initialTheses.length === 0);
  const [title, setTitle] = useState("");
  const [thesisText, setThesisText] = useState("");
  const [counterEvidence, setCounterEvidence] = useState("");
  const [changeCondition, setChangeCondition] = useState("");
  const [variables, setVariables] = useState("");
  const [reviewDays, setReviewDays] = useState("30");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checksByThesis = useMemo(() => {
    const grouped = new Map<string, UserThesisCheck[]>();
    for (const check of thesisChecks) {
      const current = grouped.get(check.thesis_id) ?? [];
      current.push(check);
      grouped.set(check.thesis_id, current);
    }
    return grouped;
  }, [thesisChecks]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/watchlist/${encodeURIComponent(ticker)}/timeline?limit=30`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("timeline_failed");
        return response.json() as Promise<CompanyCoverageTimelineResponse>;
      })
      .then((payload) => setTimeline(payload.items))
      .catch((loadError) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError("판단 타임라인을 불러오지 못했습니다.");
        }
      })
      .finally(() => setTimelineLoading(false));
    return () => controller.abort();
  }, [ticker]);

  async function createThesis() {
    if (!title.trim() || !thesisText.trim() || pending) return;
    setPending("create-thesis");
    setError(null);
    const monitoredVariables = variables
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 3);
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(ticker)}/theses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          thesis_text: thesisText,
          monitored_variables: monitoredVariables,
          counter_evidence: counterEvidence,
          decision_change_condition: changeCondition,
          status: "active",
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload.thesis) {
        throw new Error(readError(payload, "핵심 가설을 저장하지 못했습니다."));
      }
      setTheses((current) => [payload.thesis as UserCompanyThesis, ...current]);
      setTitle("");
      setThesisText("");
      setCounterEvidence("");
      setChangeCondition("");
      setVariables("");
      setShowForm(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "핵심 가설을 저장하지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function updateThesisStatus(thesis: UserCompanyThesis, status: UserCompanyThesisStatus) {
    if (pending) return;
    setPending(`thesis:${thesis.id}`);
    setError(null);
    const previous = thesis.status;
    setTheses((current) => current.map((item) => item.id === thesis.id ? { ...item, status } : item));
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(ticker)}/theses/${encodeURIComponent(thesis.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const payload = await readPayload(response);
      if (!response.ok || !payload.thesis) {
        throw new Error(readError(payload, "가설 상태를 저장하지 못했습니다."));
      }
      setTheses((current) => current.map((item) => item.id === thesis.id ? payload.thesis as UserCompanyThesis : item));
    } catch (saveError) {
      setTheses((current) => current.map((item) => item.id === thesis.id ? { ...item, status: previous } : item));
      setError(saveError instanceof Error ? saveError.message : "가설 상태를 저장하지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function addScheduledReview() {
    if (pending) return;
    setPending("create-rule");
    setError(null);
    const nextReviewAt = new Date(Date.now() + Number(reviewDays) * 24 * 60 * 60 * 1_000).toISOString();
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(ticker)}/monitoring-rules`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rule_type: "scheduled_review",
            next_review_at: nextReviewAt,
          }),
        },
      );
      const payload = await readPayload(response);
      if (!response.ok || !payload.rule) {
        throw new Error(readError(payload, "다음 확인 시점을 저장하지 못했습니다."));
      }
      const rule = payload.rule as UserCompanyMonitoringRule;
      setRules((current) => [rule, ...current.filter((item) => item.id !== rule.id)]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "다음 확인 시점을 저장하지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function disableRule(ruleId: string) {
    if (pending) return;
    setPending(`rule:${ruleId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(ticker)}/monitoring-rules/${encodeURIComponent(ruleId)}`,
        { method: "DELETE" },
      );
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(readError(payload, "다음 확인 조건을 끄지 못했습니다."));
      setRules((current) => current.filter((rule) => rule.id !== ruleId));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "다음 확인 조건을 끄지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  const openQuestions = questions.filter((question) => question.status === "open");

  return (
    <section className="border border-hairline bg-canvas" aria-labelledby="coverage-memory-heading">
      <div className="border-b border-hairline px-sm py-sm md:px-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.12em] text-primary">Personal decision memory</p>
            <h2 id="coverage-memory-heading" className="mt-1 text-[20px] font-black text-ink">내 판단 기억</h2>
            <p className="mt-1 text-[13px] leading-5 text-muted">왜 보는지, 무엇이 틀릴 수 있는지, 언제 다시 판단할지를 한곳에 남깁니다.</p>
          </div>
          <button
            type="button"
            className="min-h-11 rounded-[8px] bg-surface-dark px-4 text-[13px] font-extrabold text-on-dark disabled:opacity-50"
            onClick={() => setShowForm((value) => !value)}
            disabled={Boolean(pending)}
          >
            {showForm ? "작성 닫기" : "핵심 가설 추가"}
          </button>
        </div>
      </div>

      {error ? <p role="alert" className="mx-sm mt-sm rounded-[7px] bg-error-container/40 px-sm py-xs text-[13px] font-bold text-error md:mx-md">{error}</p> : null}

      {showForm ? (
        <div className="grid gap-4 border-b border-hairline bg-surface-soft p-sm md:grid-cols-2 md:p-md">
          <LabeledField label="가설 이름" hint="예: AI 투자 증가를 FCF로 감당할 수 있다">
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className={inputClassName} />
          </LabeledField>
          <LabeledField label="확인 변수 최대 3개" hint="쉼표로 구분 · 예: FCF, CapEx, 재고">
            <input value={variables} onChange={(event) => setVariables(event.target.value)} maxLength={200} className={inputClassName} />
          </LabeledField>
          <LabeledField label="현재 핵심 가설" hint="내가 지금 믿는 이유">
            <textarea value={thesisText} onChange={(event) => setThesisText(event.target.value)} maxLength={20_000} className={textareaClassName} />
          </LabeledField>
          <LabeledField label="반대 근거" hint="내 생각이 틀릴 수 있는 이유">
            <textarea value={counterEvidence} onChange={(event) => setCounterEvidence(event.target.value)} maxLength={8_000} className={textareaClassName} />
          </LabeledField>
          <div className="md:col-span-2">
            <LabeledField label="판단 변경 조건" hint="어떤 사실이 나오면 생각을 바꿀지">
              <textarea value={changeCondition} onChange={(event) => setChangeCondition(event.target.value)} maxLength={4_000} className={textareaClassName} />
            </LabeledField>
          </div>
          <button
            type="button"
            onClick={() => void createThesis()}
            disabled={!title.trim() || !thesisText.trim() || Boolean(pending)}
            className="min-h-11 rounded-[8px] bg-primary px-4 text-[13px] font-extrabold text-on-primary disabled:opacity-45 md:col-span-2 md:justify-self-start"
          >
            {pending === "create-thesis" ? "저장 중…" : "내 판단 기억에 저장"}
          </button>
        </div>
      ) : null}

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
        <div className="min-w-0 border-b border-hairline p-sm lg:border-b-0 lg:border-r md:p-md">
          <h3 className="text-[15px] font-black text-ink">핵심 가설</h3>
          {theses.length ? (
            <div className="mt-3 grid gap-3">
              {theses.map((thesis) => {
                const latestCheck = checksByThesis.get(thesis.id)?.[0];
                return (
                  <article key={thesis.id} className="rounded-[9px] border border-hairline p-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[15px] font-black leading-5 text-ink">{thesis.title}</p>
                        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-body">{thesis.thesis_text}</p>
                      </div>
                      <select
                        value={thesis.status}
                        disabled={Boolean(pending)}
                        onChange={(event) => void updateThesisStatus(thesis, event.target.value as UserCompanyThesisStatus)}
                        className="min-h-11 rounded-[7px] border border-hairline bg-canvas px-3 text-[12px] font-extrabold text-ink"
                        aria-label={`${thesis.title} 상태`}
                      >
                        {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                    {thesis.monitored_variables.length ? <p className="mt-3 text-[12px] font-bold text-primary">확인 변수 · {thesis.monitored_variables.join(" · ")}</p> : null}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <MemoryFact label="반대 근거" value={thesis.counter_evidence || "아직 적지 않았습니다."} />
                      <MemoryFact label="판단 변경 조건" value={thesis.decision_change_condition || "아직 적지 않았습니다."} />
                    </div>
                    {latestCheck ? (
                      <div className="mt-3 rounded-[7px] bg-surface-soft px-sm py-xs text-[12px] leading-5 text-muted">
                        최근 점검 · {latestCheck.summary}
                        {latestCheck.weakening_points.length ? <p className="mt-1 font-bold text-error">약화 근거 · {latestCheck.weakening_points.join(" · ")}</p> : null}
                      </div>
                    ) : null}
                    <details className="mt-3 border-t border-hairline pt-2">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-[12px] font-extrabold text-primary">가설 내용 수정</summary>
                      <ThesisEditor
                        ticker={ticker}
                        thesis={thesis}
                        onSaved={(saved) => setTheses((current) => current.map((item) => item.id === saved.id ? saved : item))}
                      />
                    </details>
                  </article>
                );
              })}
            </div>
          ) : <EmptyMemory text="아직 저장한 가설이 없습니다. 한 문장부터 시작하세요." />}

          <div className="mt-6 flex items-end gap-2 border-t border-hairline pt-4">
            <label className="min-w-0 flex-1 text-[12px] font-extrabold text-muted">
              다음 정기 점검
              <select value={reviewDays} onChange={(event) => setReviewDays(event.target.value)} className="mt-1 min-h-11 w-full rounded-[7px] border border-hairline bg-canvas px-3 text-[13px] font-bold text-ink">
                <option value="7">7일 뒤</option>
                <option value="30">30일 뒤</option>
                <option value="90">90일 뒤</option>
              </select>
            </label>
            <button type="button" onClick={() => void addScheduledReview()} disabled={Boolean(pending)} className="min-h-11 rounded-[7px] border border-primary px-4 text-[13px] font-extrabold text-primary disabled:opacity-45">
              {pending === "create-rule" ? "저장 중…" : "다음 확인 저장"}
            </button>
          </div>
          {rules.length ? (
            <ul className="mt-3 grid gap-2">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between gap-3 rounded-[7px] bg-surface-soft px-sm py-xs text-[12px] font-bold text-body">
                  <span>{monitoringRuleLabel(rule)}</span>
                  <button type="button" onClick={() => void disableRule(rule.id)} disabled={Boolean(pending)} className="min-h-11 shrink-0 px-2 font-extrabold text-muted hover:text-error">끄기</button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <aside className="min-w-0 p-sm md:p-md">
          <h3 className="text-[15px] font-black text-ink">열린 질문</h3>
          {openQuestions.length ? (
            <ul className="mt-3 grid gap-2">
              {openQuestions.slice(0, 5).map((question) => (
                <li key={question.id} className="rounded-[7px] border border-hairline px-sm py-xs text-[12px] font-bold leading-5 text-body">{question.question}</li>
              ))}
            </ul>
          ) : <EmptyMemory text="현재 열린 질문이 없습니다." />}

          <h3 className="mt-6 text-[15px] font-black text-ink">판단 타임라인</h3>
          {timelineLoading ? <p className="mt-3 text-[12px] font-bold text-muted">불러오는 중…</p> : timeline.length ? (
            <ol className="mt-3 grid gap-3">
              {timeline.slice(0, 8).map((item) => <TimelineRow key={`${item.type}:${item.id}`} item={item} />)}
            </ol>
          ) : <EmptyMemory text="첫 공시 판단을 남기면 여기에 변화가 쌓입니다." />}
        </aside>
      </div>
    </section>
  );
}

function LabeledField({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return <label className="block text-[12px] font-extrabold text-ink">{label}<span className="ml-2 font-semibold text-muted">{hint}</span>{children}</label>;
}

function ThesisEditor({ ticker, thesis, onSaved }: { ticker: string; thesis: UserCompanyThesis; onSaved: (thesis: UserCompanyThesis) => void }) {
  const [title, setTitle] = useState(thesis.title);
  const [text, setText] = useState(thesis.thesis_text);
  const [variables, setVariables] = useState(thesis.monitored_variables.join(", "));
  const [counter, setCounter] = useState(thesis.counter_evidence);
  const [condition, setCondition] = useState(thesis.decision_change_condition);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending || !title.trim() || !text.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(ticker)}/theses/${encodeURIComponent(thesis.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          thesis_text: text,
          monitored_variables: variables.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 3),
          counter_evidence: counter,
          decision_change_condition: condition,
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload.thesis) throw new Error(readError(payload, "가설을 수정하지 못했습니다."));
      onSaved(payload.thesis as UserCompanyThesis);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "가설을 수정하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return <div className="grid gap-3 rounded-[7px] bg-surface-soft p-sm sm:grid-cols-2">
    <LabeledField label="가설 이름" hint=""><input className={inputClassName} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></LabeledField>
    <LabeledField label="확인 변수" hint="최대 3개"><input className={inputClassName} value={variables} onChange={(event) => setVariables(event.target.value)} maxLength={200} /></LabeledField>
    <LabeledField label="핵심 가설" hint=""><textarea className={textareaClassName} value={text} onChange={(event) => setText(event.target.value)} maxLength={20_000} /></LabeledField>
    <LabeledField label="반대 근거" hint=""><textarea className={textareaClassName} value={counter} onChange={(event) => setCounter(event.target.value)} maxLength={8_000} /></LabeledField>
    <div className="sm:col-span-2"><LabeledField label="판단 변경 조건" hint=""><textarea className={textareaClassName} value={condition} onChange={(event) => setCondition(event.target.value)} maxLength={4_000} /></LabeledField></div>
    {error ? <p role="alert" className="text-[12px] font-bold text-error sm:col-span-2">{error}</p> : null}
    <button type="button" onClick={() => void save()} disabled={pending || !title.trim() || !text.trim()} className="min-h-11 rounded-[7px] bg-primary px-4 text-[12px] font-extrabold text-on-primary disabled:opacity-45 sm:col-span-2 sm:justify-self-start">{pending ? "저장 중…" : "수정 저장"}</button>
  </div>;
}

function MemoryFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[7px] bg-surface-soft px-sm py-xs"><p className="text-[11px] font-black text-muted">{label}</p><p className="mt-1 whitespace-pre-wrap text-[12px] font-semibold leading-5 text-body">{value}</p></div>;
}

function EmptyMemory({ text }: { text: string }) {
  return <p className="mt-3 rounded-[7px] bg-surface-soft px-sm py-sm text-[12px] font-bold leading-5 text-muted">{text}</p>;
}

function TimelineRow({ item }: { item: CompanyCoverageTimelineItem }) {
  const date = formatDateTime(item.occurred_at);
  if (item.type === "coverage_change") {
    return <li className="border-l-2 border-hairline pl-3"><p className="text-[12px] font-black text-ink">커버리지 · {coverageLevelLabel(item.coverage_level)}</p><p className="mt-1 text-[11px] text-muted">{date}</p></li>;
  }
  return <li className="border-l-2 border-primary pl-3"><Link href={`/filings/${encodeURIComponent(item.filing_event_id)}`} className="text-[12px] font-black leading-5 text-ink hover:text-primary">{item.summary}</Link><p className="mt-1 text-[11px] text-muted">{impactLabel(item.impact)} · {date}</p></li>;
}

function coverageLevelLabel(level: string | null) {
  if (level === null) return "해제";
  return level === "interest" ? "관심" : level;
}

function impactLabel(impact: string) {
  return ({ positive: "긍정", neutral: "영향 없음", negative: "부정", unclear: "판단 보류" } as Record<string, string>)[impact] ?? impact;
}

function monitoringRuleLabel(rule: UserCompanyMonitoringRule) {
  if (rule.rule_type === "scheduled_review" && rule.next_review_at) return `${formatDateTime(rule.next_review_at)} 다시 판단`;
  if (rule.rule_type === "filing_form") return `${rule.value} 제출 시 확인`;
  if (rule.rule_type === "filing_item") return `SEC Item ${rule.value} 발생 시 확인`;
  return `“${rule.value}” 관련 공시 확인`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readError(payload: Record<string, unknown>, fallback: string) {
  const error = payload.error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

const inputClassName = "mt-1 min-h-11 w-full rounded-[7px] border border-hairline bg-canvas px-3 text-[13px] font-semibold text-ink outline-none focus:border-primary";
const textareaClassName = "mt-1 min-h-28 w-full resize-y rounded-[7px] border border-hairline bg-canvas px-3 py-2 text-[13px] font-semibold leading-5 text-ink outline-none focus:border-primary";
