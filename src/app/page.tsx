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
    <div className="min-h-screen overflow-hidden bg-surface-dark text-on-dark">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-surface-dark/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
          <Link
            href="/"
            className="flex items-center gap-3 text-sm font-bold uppercase tracking-[0.2em]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-container text-on-primary">
              K
            </span>
            <span>KRW Ontology</span>
          </Link>

          <div className="hidden items-center gap-8 text-sm text-on-dark-soft md:flex">
            <Link href="/chat" className="transition-colors hover:text-on-dark">
              Research
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-pill border border-white/15 px-4 py-2 text-sm font-semibold text-on-dark transition-colors hover:border-primary-fixed hover:text-primary-fixed sm:inline-flex"
            >
              Sign In
            </Link>
            <Link
              href="/companies"
              className="rounded-pill bg-primary-fixed px-4 py-2 text-sm font-bold text-on-primary-fixed transition-colors hover:bg-primary-fixed-dim"
            >
              Explore
            </Link>
          </div>
        </nav>
      </header>

      <main
        id="main-content"
        className="relative flex min-h-screen items-center px-6 pb-24 pt-32 lg:px-8"
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

        <section className="relative z-10 mx-auto flex max-w-5xl flex-col items-center text-center">
          <h1 className="max-w-4xl text-balance text-[48px] font-black leading-[0.96] tracking-normal text-on-dark md:text-[64px] lg:text-[76px]">
            Welcome to the KRW Ontology Research Cockpit
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-8 text-on-dark-soft md:text-xl">
            Query corporate structures, governance risk, and market context
            with evidence-first Korean equity research workflows.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-10 flex w-full max-w-3xl items-center gap-3 rounded-pill border border-white/15 bg-white/10 p-3 shadow-2xl shadow-primary/20 backdrop-blur-xl"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3 pl-4">
              <span className="material-symbols-outlined text-[24px] text-primary-fixed">
                search
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-14 min-w-0 flex-1 bg-transparent text-base text-on-dark outline-none placeholder:text-on-dark-soft"
                placeholder="Query Samsung, SK Hynix, governance risk, or 한국어 분석..."
                aria-label="Research query"
              />
            </div>
            <button
              type="submit"
              disabled={!query.trim()}
              aria-label="Send query"
              className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-surface-dark shadow-lg shadow-black/20 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              <span className="material-symbols-outlined text-[34px]">
                arrow_upward
              </span>
            </button>
          </form>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-surface-dark px-6 py-6 text-center text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
        © 2026 KRW Ontology Research. Institutional Grade Data.
      </footer>
    </div>
  );
}
