"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { KrwBrand } from "@/components/KrwBrand";
import { createClient } from "@/lib/supabase/client";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/companies";
  }
  return value;
}

function LoginContent() {
  const searchParams = useSearchParams();
  const initialError = searchParams.get("error") === "oauth";
  const nextPath = safeNextPath(searchParams.get("next"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? "Google 인증을 완료하지 못했습니다. 다시 시도해주세요." : null,
  );
  const supabase = useMemo(() => createClient(), []);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);

    try {
      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("next", nextPath);
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectTo.toString(),
        },
      });
      if (authError) throw authError;
    } catch {
      setError("Google 로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-surface-dark text-on-dark">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px]"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-0 right-0 h-[60vh] w-[60vw] bg-[radial-gradient(circle_at_bottom_right,rgba(184,121,46,0.2),transparent_65%)]"
      />

      <header className="sticky top-0 z-50 h-[72px] w-full flex-shrink-0 border-b border-white/10 bg-surface-dark/85 backdrop-blur-xl">
        <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-base px-base sm:px-md">
          <KrwBrand dark compact />
          <Link
            href="/"
            className="rounded-[8px] border border-white/10 px-3 py-2 text-[14px] font-semibold leading-[1.4] text-stone-300 transition-colors hover:border-accent-yellow hover:text-accent-yellow"
          >
            홈
          </Link>
        </div>
      </header>

      <main className="relative z-10 grid w-full flex-1 grid-cols-1 items-center gap-10 px-base py-xl sm:px-md lg:grid-cols-[minmax(0,1fr)_440px] lg:px-xl">
        <section className="mx-auto w-full min-w-0 max-w-3xl lg:mx-0 lg:pl-8">
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-accent-yellow">
            Secure research workspace
          </p>
          <h1 className="mt-4 max-w-2xl text-balance text-[42px] font-black leading-[0.98] text-stone-50 sm:text-[64px]">
            질문과 근거를 같은 세션에 보관합니다.
          </h1>
          <p className="mt-5 w-full max-w-[576px] text-[17px] leading-8 text-stone-300">
            Google 로그인 후 회사 목록, 채팅 기록, 리서치 아티팩트가 한
            워크스페이스에 연결됩니다.
          </p>

          <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
            {["OAuth session", "RLS protected", "Evidence history"].map(
              (item) => (
                <div
                  key={item}
                  className="rounded-[8px] border border-white/10 bg-white/[0.05] px-4 py-4"
                >
                  <span className="material-symbols-outlined text-[20px] text-accent-yellow">
                    verified
                  </span>
                  <p className="mt-3 text-[13px] font-bold uppercase tracking-[0.08em] text-stone-200">
                    {item}
                  </p>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[440px]">
          <div className="rounded-[12px] border border-white/10 bg-[#f4efe5] p-5 text-ink shadow-2xl shadow-black/35 sm:p-6">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-tertiary">
              Continue to
            </p>
            <div className="mt-3 rounded-[8px] border border-hairline bg-canvas px-3 py-3 font-mono text-[12px] font-bold text-body">
              {nextPath}
            </div>

            <h2 className="mt-8 text-[34px] font-black leading-none">
              로그인
            </h2>
            <p className="mt-3 text-[15px] leading-6 text-body">
              리서치 질문, 회사 범위, citation trail을 이어서 사용하려면
              Google 계정으로 인증하세요.
            </p>

            <div className="mt-6 space-y-md">
              {error && (
                <div className="rounded-[8px] border border-error/20 bg-error-container/35 p-sm text-[14px] font-semibold leading-[1.5] text-error">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="flex h-[52px] w-full items-center justify-center gap-sm rounded-[8px] bg-surface-dark px-base text-[16px] font-extrabold leading-[1.15] text-stone-50 transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-white text-[15px] font-black text-[#4285f4]">
                  G
                </span>
                {loading ? "Google로 이동 중..." : "Google로 계속하기"}
              </button>
            </div>
          </div>

          <p className="mt-lg text-center text-[13px] font-semibold leading-[1.5] text-stone-400">
            KRW Ontology · 근거 기반 기업 리서치
          </p>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/5 px-base py-lg text-center">
        <p className="text-[13px] font-semibold leading-[1.5] text-stone-500">
          © 2026 KRW Ontology. 모든 권리 보유.
        </p>
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-surface-dark text-on-dark">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-yellow border-t-transparent" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
