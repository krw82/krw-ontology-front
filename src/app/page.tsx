"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { KrwBrand } from "@/components/KrwBrand";

const evidenceCards = [
  { label: "SOURCE", value: "10-K · FY2025", detail: "Item 1 / 사업 개요" },
  { label: "ENTITY", value: "AWS", detail: "cloud infrastructure segment" },
  { label: "SIGNAL", value: "Margin driver", detail: "capex, utilization, mix" },
];

const workflowSteps = ["공시 수집", "개념 연결", "근거 답변"];

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const startResearch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const params = new URLSearchParams({ query: trimmed });
    router.push(`/chat?${params.toString()}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startResearch(query);
  };

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-surface-dark text-on-dark">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-surface-dark/85 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <KrwBrand dark />

          <div className="hidden items-center gap-8 text-sm font-semibold text-stone-400 md:flex">
            <Link href="/chat" className="transition-colors hover:text-stone-50">
              리서치
            </Link>
            <Link
              href="/companies"
              className="transition-colors hover:text-stone-50"
            >
              회사 목록
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-[8px] border border-white/15 px-4 py-2 text-sm font-semibold text-stone-200 transition-colors hover:border-accent-yellow hover:text-accent-yellow sm:inline-flex"
            >
              로그인
            </Link>
            <Link
              href="/companies"
              className="rounded-[8px] bg-primary-fixed px-4 py-2 text-sm font-extrabold text-on-primary-fixed transition-colors hover:bg-primary-fixed-dim"
            >
              시작하기
            </Link>
          </div>
        </nav>
      </header>

      <main
        id="main-content"
        className="relative min-h-[100dvh] px-4 pb-16 pt-28 sm:px-6 sm:pb-24 sm:pt-32 lg:px-8"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px]"
        />
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 h-[52vh] w-[52vw] bg-[radial-gradient(circle_at_top_left,rgba(230,201,141,0.18),transparent_62%)]"
        />

        <section className="relative z-10 mx-auto grid w-full max-w-7xl items-center gap-12 lg:min-h-[calc(100dvh-160px)] lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)]">
          <div className="min-w-0">
            <div className="mb-6 inline-flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] font-bold uppercase tracking-[0.14em] text-accent-yellow">
              <span className="h-2 w-2 rounded-full bg-semantic-up" />
              Evidence-first Research OS
            </div>

            <h1 className="max-w-4xl text-balance text-[48px] font-black leading-[0.96] tracking-normal text-stone-50 sm:text-[64px] lg:text-[84px]">
              기업 질문을
              <span className="block text-accent-yellow">근거 그래프로</span>
              답합니다.
            </h1>

            <p className="mt-6 max-w-2xl text-pretty text-[17px] leading-8 text-stone-300 sm:text-[20px]">
              KRW Ontology는 공시 문장, 사업 활동, 리스크 요인을 연결해
              답변이 어디에서 왔는지 끝까지 추적할 수 있게 합니다.
            </p>

            <form
              onSubmit={handleSubmit}
              className="mt-8 flex w-full max-w-3xl items-center gap-2 rounded-[12px] border border-white/15 bg-stone-50 p-2 shadow-2xl shadow-black/35 sm:mt-10 sm:gap-3"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3 pl-2 sm:pl-4">
                <span className="material-symbols-outlined text-[24px] text-tertiary-container">
                  search
                </span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-12 min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:text-muted sm:h-14"
                  placeholder="예: 아마존의 클라우드 컴퓨팅 사업이 영업이익에 미친 영향"
                  aria-label="리서치 질문"
                />
              </div>
              <button
                type="submit"
                disabled={!query.trim()}
                aria-label="질문 보내기"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-surface-dark text-stone-50 transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40 sm:h-14 sm:w-14"
              >
                <span className="material-symbols-outlined text-[28px]">
                  arrow_upward
                </span>
              </button>
            </form>

            <div className="mt-8 grid max-w-3xl grid-cols-3 gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-stone-400 sm:gap-3">
              {workflowSteps.map((step, index) => (
                <div
                  key={step}
                  className="rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-3"
                >
                  <span className="mr-2 font-mono text-accent-yellow">
                    0{index + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>
          </div>

          <div className="relative lg:min-h-[640px]">
            <div className="relative rounded-[16px] border border-white/10 bg-[#f4efe5] p-4 text-ink shadow-2xl shadow-black/40 sm:p-5 lg:absolute lg:inset-x-0 lg:top-0">
              <div className="flex items-center justify-between border-b border-[#d8cfc0] pb-4">
                <div>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-tertiary">
                    Live research trace
                  </p>
                  <h2 className="mt-2 text-[24px] font-black leading-none">
                    AMZN · Cloud margin question
                  </h2>
                </div>
                <span className="rounded-[8px] bg-surface-dark px-3 py-2 font-mono text-[12px] font-bold text-accent-yellow">
                  3 sources
                </span>
              </div>

              <div className="mt-5 grid gap-3">
                {evidenceCards.map((card) => (
                  <div
                    key={card.label}
                    className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-[8px] border border-[#ded6c8] bg-canvas px-3 py-3"
                  >
                    <span className="font-mono text-[11px] font-bold tracking-[0.14em] text-muted">
                      {card.label}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-extrabold text-ink">
                        {card.value}
                      </p>
                      <p className="mt-1 text-[13px] leading-5 text-body">
                        {card.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-[8px] bg-surface-dark p-4 text-stone-50">
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-stone-400">
                    ontology path
                  </p>
                  <p className="text-[12px] font-semibold text-accent-yellow">
                    confidence · high
                  </p>
                </div>
                <div className="grid grid-cols-[1fr_32px_1fr_32px_1fr] items-center gap-2">
                  {["10-K", "AWS", "Operating margin"].map((node, index) => (
                    <div key={node} className="contents">
                      <div className="whitespace-nowrap rounded-[8px] border border-white/10 bg-white/[0.06] px-2 py-4 text-center text-[12px] font-bold leading-4 sm:px-3 sm:text-[13px]">
                        {node}
                      </div>
                      {index < 2 && (
                        <span className="material-symbols-outlined text-center text-[18px] text-accent-yellow">
                          arrow_forward
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 border-l-2 border-tertiary-container pl-4">
                <p className="text-[15px] font-bold leading-6">
                  답변은 공시 원문과 연결된 사업 활동 노드에서 생성됩니다.
                </p>
                <p className="mt-2 text-[13px] leading-5 text-body">
                  답변 카드마다 source label, period, section이 남아 검증 가능한
                  리서치 기록으로 보관됩니다.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-surface-dark px-4 py-6 text-center text-xs font-bold uppercase leading-5 tracking-[0.14em] text-white/45 sm:px-6">
        © 2026 KRW Ontology Research. Evidence-backed company intelligence.
      </footer>
    </div>
  );
}
