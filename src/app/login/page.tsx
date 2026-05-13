"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);

    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/companies`,
        },
      });
      if (authError) throw authError;
    } catch {
      setError("Google 로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setLoading(false);
    } finally {
      // A successful OAuth start redirects the browser away from this page.
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-surface-dark">
      {/* Geometric network background */}
      <div className="absolute inset-0 opacity-20">
        <svg
          className="w-full h-full"
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0052ff" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#0052ff" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Grid lines */}
          {Array.from({ length: 20 }).map((_, i) => (
            <line
              key={`h-${i}`}
              x1="0"
              y1={i * 40}
              x2="1200"
              y2={i * 40}
              stroke="#1a3a6e"
              strokeWidth="0.5"
              strokeOpacity="0.3"
            />
          ))}
          {Array.from({ length: 30 }).map((_, i) => (
            <line
              key={`v-${i}`}
              x1={i * 40}
              y1="0"
              x2={i * 40}
              y2="800"
              stroke="#1a3a6e"
              strokeWidth="0.5"
              strokeOpacity="0.3"
            />
          ))}
          {/* Network nodes */}
          {[
            [200, 150],
            [400, 200],
            [600, 100],
            [800, 250],
            [300, 400],
            [500, 350],
            [700, 450],
            [900, 150],
            [150, 600],
            [450, 550],
            [650, 600],
            [850, 500],
            [1000, 350],
            [350, 300],
          ].map(([cx, cy], i) => (
            <g key={`node-${i}`}>
              <circle cx={cx} cy={cy} r="3" fill="#0052ff" fillOpacity="0.6" />
              <circle cx={cx} cy={cy} r="8" fill="#0052ff" fillOpacity="0.1" />
            </g>
          ))}
          {/* Connecting lines */}
          {[
            [200, 150, 400, 200],
            [400, 200, 600, 100],
            [600, 100, 800, 250],
            [300, 400, 500, 350],
            [500, 350, 700, 450],
            [200, 150, 300, 400],
            [400, 200, 500, 350],
            [600, 100, 700, 450],
            [800, 250, 900, 150],
            [300, 400, 450, 550],
            [500, 350, 650, 600],
            [700, 450, 850, 500],
            [850, 500, 1000, 350],
            [150, 600, 450, 550],
            [650, 600, 850, 500],
            [350, 300, 500, 350],
            [350, 300, 200, 150],
          ].map(([x1, y1, x2, y2], i) => (
            <line
              key={`edge-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#0052ff"
              strokeWidth="0.8"
              strokeOpacity="0.2"
            />
          ))}
          {/* Central glow */}
          <circle cx="600" cy="400" r="300" fill="url(#glow)" />
        </svg>
      </div>

      {/* Top Nav on Dark */}
      <header className="sticky top-0 z-50 h-[64px] w-full flex-shrink-0 border-b border-white/10 bg-surface-dark">
        <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-base px-base sm:px-md">
          <div className="flex min-w-0 items-center gap-lg">
            <Link
              href="/"
              className="truncate text-[18px] font-semibold leading-[1.33] tracking-tight text-on-dark"
            >
              KRW Ontology
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-md">
            <Link
              href="/"
              className="hidden text-[14px] font-medium leading-[1.4] text-on-dark-soft transition-colors hover:text-on-dark sm:inline"
            >
              홈
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-base py-xl sm:px-md">
        <div className="w-full max-w-[440px] min-w-0">
          {/* Auth Card */}
          <div className="rounded-xl border border-white/10 bg-surface-dark-elevated p-lg sm:rounded-[24px] sm:p-xl">
            <div className="mb-lg text-center sm:mb-xl">
              <h1 className="mb-sm text-[32px] font-normal leading-[1.12] tracking-normal text-on-dark sm:text-[36px]">
                로그인
              </h1>
              <p className="text-[16px] font-normal leading-[1.5] text-on-dark-soft">
                Google 계정으로 로그인하고 온톨로지 리서치를 시작하세요.
              </p>
            </div>

            <div className="space-y-md">
              {error && (
                <div className="rounded-[12px] border border-semantic-down/20 bg-semantic-down/10 p-sm text-[14px] font-normal leading-[1.5] text-semantic-down">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="flex h-[48px] w-full items-center justify-center gap-sm rounded-full bg-white px-base text-[16px] font-semibold leading-[1.15] text-surface-dark transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10 text-[15px] font-bold text-[#4285f4]">
                  G
                </span>
                {loading ? "이동 중..." : "Google로 계속하기"}
              </button>
            </div>
          </div>

          {/* Subtitle */}
          <p className="mt-lg text-center text-[14px] font-normal leading-[1.5] text-on-dark-soft">
            KRW Ontology가 제공하는 근거 기반 기업 리서치.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 px-base py-lg text-center">
        <p className="text-[14px] font-normal leading-[1.5] text-on-dark-soft">
          &copy; 2026 KRW Ontology. 모든 권리 보유.
        </p>
      </footer>
    </div>
  );
}
