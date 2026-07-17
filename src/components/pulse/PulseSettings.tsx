"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PulseItemKind, PulsePreferences } from "@/types/api-contracts";

interface PulseSettingsProps {
  initialPreferences: PulsePreferences;
}

const KIND_OPTIONS: Array<{ kind: PulseItemKind; label: string; description: string }> = [
  { kind: "filing", label: "카탈로그 공시", description: "카탈로그 기업의 8-K·6-K·Form 4" },
  { kind: "analysis", label: "내 분석 상태", description: "회사 채팅에서 직접 시작한 분석" },
  { kind: "question", label: "열린 질문", description: "리서치 노트북의 다음 질문" },
  { kind: "resurface", label: "다시 보기", description: "오래된 메모와 투자 관점" },
  { kind: "learning", label: "짧은 학습", description: "주 1회 공시 읽기 가이드" },
];

export default function PulseSettings({ initialPreferences }: PulseSettingsProps) {
  const router = useRouter();
  const [preferences, setPreferences] = useState(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function toggleKind(kind: PulseItemKind) {
    setPreferences((current) => ({
      ...current,
      enabled_kinds: current.enabled_kinds.includes(kind)
        ? current.enabled_kinds.filter((value) => value !== kind)
        : [...current.enabled_kinds, kind],
    }));
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    const response = await fetch("/api/pulse/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: preferences.timezone,
        enabled_kinds: preferences.enabled_kinds.filter((kind) => kind !== "checkup"),
        daily_checkup_enabled: false,
        question_cadence: preferences.enabled_kinds.includes("question") ? preferences.question_cadence : "off",
        resurface_cadence: preferences.enabled_kinds.includes("resurface") ? preferences.resurface_cadence : "off",
        learning_cadence: preferences.enabled_kinds.includes("learning") ? "weekly" : "off",
        learning_enabled: preferences.enabled_kinds.includes("learning"),
        resurfacing_enabled: preferences.enabled_kinds.includes("resurface"),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setStatus("설정을 저장하지 못했습니다. 잠시 뒤 다시 시도해주세요.");
      return;
    }
    const payload = await response.json() as { preferences: PulsePreferences };
    setPreferences(payload.preferences);
    setStatus("저장했습니다.");
    router.refresh();
  }

  return (
    <main id="main-content" className="mx-auto w-full max-w-[680px] px-base py-2xl sm:px-xl sm:py-3xl">
      <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-xs text-[13px] font-bold text-muted hover:text-ink">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>피드로 돌아가기
      </button>
      <p className="mt-xl text-[11px] font-black uppercase tracking-[0.18em] text-primary">Research feed</p>
      <h1 className="mt-sm text-3xl font-black tracking-[-0.045em] text-ink">피드 설정</h1>
      <p className="mt-sm text-sm leading-6 text-muted">원하는 종류만 남겨도 중요한 공시의 원본 알림 설정은 바뀌지 않습니다.</p>

      <section className="mt-xl overflow-hidden rounded-[18px] border border-hairline bg-white">
        {KIND_OPTIONS.map((option, index) => {
          const checked = preferences.enabled_kinds.includes(option.kind);
          return (
            <label key={option.kind} className={`flex cursor-pointer items-center justify-between gap-base px-lg py-base ${index ? "border-t border-hairline" : ""}`}>
              <span>
                <span className="block text-sm font-extrabold text-ink">{option.label}</span>
                <span className="mt-1 block text-[12px] text-muted">{option.description}</span>
              </span>
              <input type="checkbox" checked={checked} onChange={() => toggleKind(option.kind)} className="peer sr-only" />
              <span aria-hidden="true" className="relative h-7 w-12 shrink-0 rounded-full bg-hairline transition-colors peer-checked:bg-primary after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          );
        })}
      </section>

      <section className="mt-base rounded-[18px] border border-hairline bg-white p-lg">
        <label htmlFor="pulse-timezone" className="block text-sm font-extrabold text-ink">기준 시간대</label>
        <p className="mt-1 text-[12px] text-muted">피드 날짜와 질문·학습 노출 주기에 사용합니다.</p>
        <select id="pulse-timezone" value={preferences.timezone} onChange={(event) => setPreferences((current) => ({ ...current, timezone: event.target.value }))} className="mt-base h-11 w-full rounded-[10px] border border-hairline bg-white px-sm text-sm font-semibold text-ink outline-none focus:border-primary">
          <option value="Asia/Seoul">서울 (KST)</option>
          <option value="America/New_York">뉴욕 (ET)</option>
          <option value="UTC">UTC</option>
        </select>
      </section>

      <section className="mt-base rounded-[18px] border border-hairline bg-white p-lg">
        <h2 className="text-sm font-extrabold text-ink">노출 빈도</h2>
        <div className="mt-base grid gap-base sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-muted">
            질문
            <select value={preferences.question_cadence} onChange={(event) => setPreferences((current) => ({ ...current, question_cadence: event.target.value as PulsePreferences["question_cadence"] }))} className="mt-xs h-10 w-full rounded-[9px] border border-hairline bg-white px-sm text-sm text-ink">
              <option value="daily">매일</option>
              <option value="three_weekly">주 3회</option>
              <option value="off">표시 안 함</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold text-muted">
            다시 보기
            <select value={preferences.resurface_cadence} onChange={(event) => setPreferences((current) => ({ ...current, resurface_cadence: event.target.value as PulsePreferences["resurface_cadence"] }))} className="mt-xs h-10 w-full rounded-[9px] border border-hairline bg-white px-sm text-sm text-ink">
              <option value="weekly">매주</option>
              <option value="biweekly">격주</option>
              <option value="off">표시 안 함</option>
            </select>
          </label>
        </div>
      </section>

      <div className="mt-xl flex items-center gap-base">
        <button type="button" disabled={saving} onClick={() => void save()} className="min-h-11 rounded-[11px] bg-primary px-lg text-sm font-extrabold text-white disabled:opacity-50">
          {saving ? "저장 중…" : "설정 저장"}
        </button>
        <p className="text-[12px] text-muted" role="status">{status}</p>
      </div>
    </main>
  );
}
