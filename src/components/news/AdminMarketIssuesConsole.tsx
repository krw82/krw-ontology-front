"use client";

import { useCallback, useEffect, useState } from "react";

type AdminIssue = {
  id: string;
  title_ko: string;
  summary_ko: string;
  state: string;
  risk_level: string;
  source_count: number;
  updated_at: string;
  entities?: Array<{ ticker?: string | null; entity_name?: string | null }>;
  research_paths?: Array<{
    id?: string;
    question?: string;
    evidence_targets?: string[];
    related_tickers?: string[];
  }>;
  sources?: Array<{
    id: string;
    publisher: string;
    account_handle: string;
    source_class: string;
    original_text: string;
    canonical_url: string;
    published_at: string | null;
  }>;
};

type AdminSettings = {
  feedEnabled: boolean;
  ingestionEnabled: boolean;
  manualReviewRequired: boolean;
  maxPublishedPerDay: number;
  lastError: string | null;
};

type AdminSource = {
  id: string;
  display_name: string;
  account_handle: string;
  source_class: string;
  active: boolean;
};

function asRows(value: unknown): AdminIssue[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rows = (value as Record<string, unknown>).issues;
  return Array.isArray(rows) ? rows as AdminIssue[] : [];
}

export default function AdminMarketIssuesConsole() {
  const [issues, setIssues] = useState<AdminIssue[]>([]);
  const [sources, setSources] = useState<AdminSource[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [status, setStatus] = useState("검수 대기 이슈를 불러오는 중입니다.");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sourceHandle, setSourceHandle] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceClass, setSourceClass] = useState("company_official");

  const load = useCallback(async () => {
    setStatus("검수 대기 이슈를 불러오는 중입니다.");
    try {
      const [issuesResponse, sourcesResponse, settingsResponse] = await Promise.all([
        fetch("/api/admin/news/issues?state=review", { cache: "no-store" }),
        fetch("/api/admin/news/sources", { cache: "no-store" }),
        fetch("/api/admin/news/settings", { cache: "no-store" }),
      ]);
      if (!issuesResponse.ok || !sourcesResponse.ok || !settingsResponse.ok) {
        throw new Error("admin_news_load_failed");
      }
      setIssues(asRows(await issuesResponse.json()));
      const sourcePayload = await sourcesResponse.json() as { sources?: AdminSource[] };
      setSources(Array.isArray(sourcePayload.sources) ? sourcePayload.sources : []);
      const settingsPayload = await settingsResponse.json() as { settings?: AdminSettings };
      setSettings(settingsPayload.settings || null);
      setStatus("");
    } catch {
      setStatus("검수 화면을 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const updateIssue = async (issueId: string, state: "published" | "hidden") => {
    setBusyId(issueId);
    try {
      const response = await fetch("/api/admin/news/issues/" + encodeURIComponent(issueId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!response.ok) throw new Error("issue_update_failed");
      setIssues((current) => current.filter((issue) => issue.id !== issueId));
    } finally {
      setBusyId(null);
    }
  };

  const updateSettings = async (update: Partial<AdminSettings>) => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...update });
    const response = await fetch("/api/admin/news/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!response.ok) {
      setSettings(previous);
      setStatus("설정 저장에 실패했습니다.");
    }
  };

  const toggleSource = async (source: AdminSource) => {
    const response = await fetch("/api/admin/news/sources/" + encodeURIComponent(source.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !source.active }),
    });
    if (!response.ok) {
      setStatus("소스 상태 변경에 실패했습니다.");
      return;
    }
    setSources((current) => current.map((item) => item.id === source.id
      ? { ...item, active: !item.active }
      : item));
  };

  const addSource = async () => {
    const response = await fetch("/api/admin/news/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountHandle: sourceHandle,
        displayName: sourceName,
        sourceClass,
      }),
    });
    if (!response.ok) {
      setStatus("소스 추가에 실패했습니다. 계정 핸들과 분류를 확인해주세요.");
      return;
    }
    setSourceHandle("");
    setSourceName("");
    await load();
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-base pb-3xl pt-xl sm:px-xl">
      <header className="rounded-[24px] border border-[#dbe5f7] bg-[#f7faff] px-lg py-xl">
        <p className="text-[12px] font-extrabold tracking-[0.12em] text-primary">MARKET ISSUES ADMIN</p>
        <h1 className="mt-1 text-[30px] font-black tracking-[-0.05em] text-ink">시장 이슈 검수</h1>
        <p className="mt-sm max-w-2xl text-[14px] leading-6 text-body">
          원문을 확인한 뒤에만 발행합니다. 매매 신호나 수혜주 판단은 이 화면에서도 작성하지 않습니다.
        </p>
      </header>

      {settings ? (
        <section className="mt-xl grid gap-sm rounded-[20px] border border-hairline bg-white p-base md:grid-cols-4">
          <SettingToggle label="피드 공개" checked={settings.feedEnabled} onChange={(feedEnabled) => void updateSettings({ feedEnabled })} />
          <SettingToggle label="수집 워커" checked={settings.ingestionEnabled} onChange={(ingestionEnabled) => void updateSettings({ ingestionEnabled })} />
          <SettingToggle label="수동 검수 강제" checked={settings.manualReviewRequired} onChange={(manualReviewRequired) => void updateSettings({ manualReviewRequired })} />
          <label className="flex min-h-12 items-center justify-between gap-sm rounded-[14px] bg-surface-soft px-sm text-[12px] font-bold text-body">
            일일 발행 한도
            <input
              type="number"
              min="1"
              max="100"
              value={settings.maxPublishedPerDay}
              onChange={(event) => void updateSettings({ maxPublishedPerDay: Number(event.target.value) })}
              className="w-16 rounded border border-hairline bg-white px-2 py-1 text-right text-ink"
            />
          </label>
          {settings.lastError ? <p className="md:col-span-4 text-[12px] text-[#9b4e25]">최근 수집 오류: {settings.lastError}</p> : null}
        </section>
      ) : null}

      <section className="mt-xl">
        <div className="flex items-center justify-between gap-base">
          <div>
            <h2 className="text-[21px] font-extrabold tracking-[-0.04em] text-ink">검수 대기</h2>
            <p className="mt-1 text-[13px] text-muted">원문과 요약이 맞는지 본 뒤 발행하거나 숨깁니다.</p>
          </div>
          <button type="button" onClick={() => void load()} className="min-h-10 rounded-full border border-hairline bg-white px-base text-[12px] font-bold text-body">새로고침</button>
        </div>
        {status ? <p className="mt-base rounded-[16px] border border-dashed border-hairline bg-white p-base text-[13px] text-muted">{status}</p> : null}
        <div className="mt-base grid gap-base">
          {issues.map((issue) => (
            <article key={issue.id} className="rounded-[20px] border border-hairline bg-white p-base sm:p-lg">
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <div className="flex items-center gap-sm text-[11px] font-bold text-muted">
                  <span className="rounded-full bg-[#fff6df] px-sm py-1 text-[#8a6318]">{issue.risk_level} risk</span>
                  <span>원문 {issue.source_count}개</span>
                </div>
                <time className="text-[11px] text-muted">{new Date(issue.updated_at).toLocaleString("ko-KR")}</time>
              </div>
              <h3 className="mt-sm text-[18px] font-extrabold text-ink">{issue.title_ko}</h3>
              <p className="mt-2 text-[13px] leading-6 text-body">{issue.summary_ko}</p>
              <p className="mt-sm text-[12px] text-muted">
                {(issue.entities || []).map((entity) => entity.ticker || entity.entity_name).filter(Boolean).join(" · ") || "연결 기업 미지정"}
              </p>
              {(issue.research_paths || []).length > 0 ? (
                <section className="mt-base rounded-[14px] border border-[#d6e1f8] bg-[#f8faff] p-sm" aria-label="생성된 다음 리서치 질문">
                  <p className="text-[11px] font-extrabold text-primary">다음 리서치 질문</p>
                  <ul className="mt-2 grid gap-2">
                    {issue.research_paths?.map((path, index) => (
                      <li key={path.id || `${path.question}-${index}`} className="rounded-[10px] bg-white px-sm py-2">
                        <p className="text-[12px] font-bold leading-5 text-ink">{path.question || "질문이 비어 있습니다."}</p>
                        {(path.evidence_targets || []).length > 0 ? <p className="mt-1 text-[11px] leading-5 text-muted">확인 자료 · {path.evidence_targets?.join(" · ")}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {(issue.sources || []).length > 0 ? (
                <div className="mt-base grid gap-sm border-t border-hairline pt-base">
                  {issue.sources?.map((source) => (
                    <article key={source.id} className="rounded-[12px] bg-surface-soft px-sm py-sm">
                      <div className="flex flex-wrap items-center justify-between gap-sm">
                        <p className="text-[12px] font-extrabold text-ink">{source.publisher} · @{source.account_handle}</p>
                        <a href={source.canonical_url} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-primary">원문 열기</a>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-body">{source.original_text}</p>
                    </article>
                  ))}
                </div>
              ) : null}
              <div className="mt-base flex flex-wrap gap-sm">
                <button type="button" disabled={busyId === issue.id} onClick={() => void updateIssue(issue.id, "published")} className="min-h-10 rounded-full bg-ink px-base text-[12px] font-extrabold text-white disabled:opacity-50">발행</button>
                <button type="button" disabled={busyId === issue.id} onClick={() => void updateIssue(issue.id, "hidden")} className="min-h-10 rounded-full border border-hairline bg-white px-base text-[12px] font-bold text-body disabled:opacity-50">숨김</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-2xl">
        <h2 className="text-[21px] font-extrabold tracking-[-0.04em] text-ink">선별 X 소스</h2>
        <p className="mt-1 text-[13px] text-muted">공식 계정과 출처가 명확한 계정만 활성화합니다.</p>
        <form
          className="mt-base grid gap-sm rounded-[16px] border border-hairline bg-white p-base sm:grid-cols-[1fr_1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void addSource();
          }}
        >
          <input value={sourceHandle} onChange={(event) => setSourceHandle(event.target.value)} placeholder="@account" required className="min-h-10 rounded border border-hairline px-sm text-[13px]" />
          <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="표시 이름" required className="min-h-10 rounded border border-hairline px-sm text-[13px]" />
          <select value={sourceClass} onChange={(event) => setSourceClass(event.target.value)} className="min-h-10 rounded border border-hairline px-sm text-[12px]">
            <option value="company_official">기업 공식</option>
            <option value="regulator">규제기관</option>
            <option value="government">정부</option>
            <option value="registered_media">등록 매체</option>
            <option value="journalist">기자</option>
            <option value="expert">전문가</option>
          </select>
          <button type="submit" className="min-h-10 rounded-full bg-ink px-base text-[12px] font-bold text-white">추가</button>
        </form>
        <div className="mt-base grid gap-sm sm:grid-cols-2">
          {sources.map((source) => (
            <article key={source.id} className="flex items-center justify-between gap-base rounded-[16px] border border-hairline bg-white p-base">
              <div>
                <p className="text-[14px] font-extrabold text-ink">{source.display_name}</p>
                <p className="mt-1 text-[12px] text-muted">@{source.account_handle} · {source.source_class}</p>
              </div>
              <button type="button" onClick={() => void toggleSource(source)} className={"min-h-9 rounded-full px-sm text-[11px] font-bold " + (source.active ? "bg-[#eaf7ef] text-[#287450]" : "bg-surface-soft text-muted")}>
                {source.active ? "활성" : "중지"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-sm rounded-[14px] bg-surface-soft px-sm text-[12px] font-bold text-body">
      {label}
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
