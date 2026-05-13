"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const startResearch = (value: string) => {
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    const params = new URLSearchParams({ query: trimmed });
    router.push(`/chat?${params.toString()}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startResearch(query);
  };

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-surface-dark text-on-dark">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-surface-dark/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 text-sm font-bold uppercase tracking-[0.16em] sm:tracking-[0.2em]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-container text-on-primary">
              K
            </span>
            <span className="truncate">KRW Ontology</span>
          </Link>

          <div className="hidden items-center gap-8 text-sm text-on-dark-soft md:flex">
            <Link href="/chat" className="transition-colors hover:text-on-dark">
              리서치
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-pill border border-white/15 px-4 py-2 text-sm font-semibold text-on-dark transition-colors hover:border-primary-fixed hover:text-primary-fixed sm:inline-flex"
            >
              로그인
            </Link>
            <Link
              href="/companies"
              className="rounded-pill bg-primary-fixed px-4 py-2 text-sm font-bold text-on-primary-fixed transition-colors hover:bg-primary-fixed-dim"
            >
              시작하기
            </Link>
          </div>
        </nav>
      </header>

      <main
        id="main-content"
        className="relative flex min-h-[100dvh] items-center px-4 pb-16 pt-28 sm:px-6 sm:pb-24 sm:pt-32 lg:px-8"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden opacity-70"
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 1440 900"
            fill="none"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <pattern
                id="network-grid"
                width="48"
                height="48"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 48 0 L 0 0 0 48"
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />
              </pattern>
              <radialGradient id="blue-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#0052ff" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#0052ff" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="1440" height="900" fill="url(#network-grid)" />
            <circle cx="1060" cy="210" r="260" fill="url(#blue-glow)" />
            <circle cx="340" cy="680" r="220" fill="url(#blue-glow)" />
            <path
              d="M186 636 L364 490 L552 574 L748 402 L944 462 L1166 268"
              stroke="#b7c4ff"
              strokeOpacity="0.48"
              strokeWidth="2"
            />
            <path
              d="M292 266 L468 364 L676 290 L864 348 L1030 214"
              stroke="#f4b000"
              strokeOpacity="0.34"
              strokeWidth="2"
            />
            {[
              [186, 636],
              [364, 490],
              [552, 574],
              [748, 402],
              [944, 462],
              [1166, 268],
              [292, 266],
              [468, 364],
              [676, 290],
              [864, 348],
              [1030, 214],
            ].map(([cx, cy]) => (
              <circle
                key={`${cx}-${cy}`}
                cx={cx}
                cy={cy}
                r="7"
                fill="#ffffff"
                fillOpacity="0.88"
              />
            ))}
          </svg>
        </div>

        <section className="relative z-10 mx-auto flex w-full min-w-0 max-w-5xl flex-col items-center text-center">
          <h1 className="w-full max-w-[22rem] break-words text-balance text-[40px] font-black leading-[1.02] tracking-normal text-on-dark sm:max-w-4xl sm:text-[48px] sm:leading-[0.98] md:text-[64px] lg:text-[76px]">
            KRW.AI 기업 리서치
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-7 text-on-dark-soft sm:mt-7 md:text-xl md:leading-8">
            기존 AI 보다 좀더 자세한 회사, 기업 분석 결과를 확인하세요.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 flex w-full max-w-3xl items-center gap-2 rounded-[28px] border border-white/15 bg-white/10 p-2 shadow-2xl shadow-primary/20 backdrop-blur-xl sm:mt-10 sm:gap-3 sm:rounded-pill sm:p-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 pl-2 sm:gap-3 sm:pl-4">
              <span className="material-symbols-outlined text-[22px] text-primary-fixed sm:text-[24px]">
                search
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-12 min-w-0 flex-1 bg-transparent text-base text-on-dark outline-none placeholder:text-on-dark-soft sm:h-14"
                placeholder="아마존의 클라우드 컴퓨팅 관련 비즈니스에 대해 자세히 알고싶어요, 테슬라에 대해 알려주세요  ..."
                aria-label="리서치 질문"
              />
            </div>
            <button
              type="submit"
              disabled={!query.trim()}
              aria-label="질문 보내기"
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-surface-dark shadow-lg shadow-black/20 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 sm:h-14 sm:w-14"
            >
              <span className="material-symbols-outlined text-[30px] sm:text-[34px]">
                arrow_upward
              </span>
            </button>
          </form>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-surface-dark px-4 py-6 text-center text-xs font-semibold uppercase leading-5 tracking-[0.12em] text-white/45 sm:px-6 sm:tracking-[0.18em]">
        © 2026 KRW Ontology Research. 근거 기반 기업 데이터.
      </footer>
    </div>
  );
}
