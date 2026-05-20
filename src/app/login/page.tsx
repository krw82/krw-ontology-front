"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { KrwBrand } from "@/components/KrwBrand";
import { createClient } from "@/lib/supabase/client";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/companies";
  }
  return value;
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      viewBox="0 0 533.5 544.3"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M533.5 278.4c0-18.5-1.5-37.1-4.7-55.3H272.1v104.8h147c-6.1 33.8-25.7 63.7-54.4 82.7v68h87.7c51.5-47.4 81.1-117.4 81.1-200.2z"
        fill="#4285F4"
      />
      <path
        d="M272.1 544.3c73.4 0 135.3-24.1 180.4-65.7l-87.7-68c-24.4 16.6-55.9 26-92.6 26-71 0-131.2-47.9-152.8-112.3H28.9v70.1c46.2 91.9 140.3 149.9 243.2 149.9z"
        fill="#34A853"
      />
      <path
        d="M119.3 324.3c-11.4-33.8-11.4-70.4 0-104.2V150H28.9c-38.6 76.9-38.6 167.5 0 244.4l90.4-70.1z"
        fill="#FBBC04"
      />
      <path
        d="M272.1 107.7c38.8-.6 76.3 14 104.4 40.8l77.7-77.7C405 24.6 339.7-.8 272.1 0 168.9 0 74.7 58.2 28.9 150l90.4 70.1c21.5-64.5 81.8-112.4 152.8-112.4z"
        fill="#EA4335"
      />
    </svg>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const initialError = searchParams.get("error") === "oauth";
  const nextPath = safeNextPath(searchParams.get("next"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? "Google 인증을 완료하지 못했습니다. 다시 시도해주세요." : null,
  );
  const [errorVisible, setErrorVisible] = useState(false);
  const trustSignals = ["Google 인증", "개인 세션 보호", "출처 기록 저장"];
  const errorRef = useRef<HTMLDivElement | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let didUpdate = true;
    requestAnimationFrame(() => {
      if (!didUpdate) return;
      const shouldShowError = Boolean(error);
      setErrorVisible(shouldShowError);
      if (shouldShowError) errorRef.current?.focus();
    });
    return () => {
      didUpdate = false;
    };
  }, [error]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    setErrorVisible(false);

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

      <header className="sticky top-0 z-50 h-[72px] w-full flex-shrink-0 border-b border-white/10 bg-surface-dark/85 backdrop-blur-xl">
        <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-base px-base sm:px-md">
          <KrwBrand dark compact />
          <Link
            href="/"
            className="rounded-[8px] border border-white/10 px-3 py-2 text-[14px] font-semibold leading-[1.4] text-on-dark-soft transition-colors hover:border-primary-fixed-dim hover:text-primary-fixed-dim"
          >
            홈
          </Link>
        </div>
      </header>

      <main
        id="main-content"
        className="relative z-10 grid w-full flex-1 grid-cols-1 items-start gap-6 px-base py-lg sm:px-md lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:gap-10 lg:px-xl lg:py-xl"
      >
        <section className="order-1 mx-auto w-full min-w-0 max-w-[720px] lg:mx-0 lg:pl-8">
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary-fixed-dim">
            보안 리서치 공간
          </p>
          <h1 className="mt-4 max-w-[640px] break-keep text-[34px] font-black leading-[1.04] text-on-dark sm:text-[56px]">
            리서치 기록을 안전하게 이어갑니다.
          </h1>
          <p className="mt-4 w-full max-w-[540px] text-[16px] leading-7 text-on-dark-soft sm:mt-5 sm:text-[17px] sm:leading-8">
            Google 계정으로 로그인하면 회사 목록, 채팅 기록, 리서치 결과가
            개인 워크스페이스에 저장됩니다.
          </p>
        </section>

        <section className="order-2 mx-auto w-full max-w-[440px]">
          <div
            className="animate-fade-in-up rounded-[12px] border border-white/12 bg-surface-dark-elevated p-5 text-on-dark shadow-2xl shadow-black/35 opacity-0 sm:p-6"
            style={{ animationDelay: "80ms", animationDuration: "150ms" }}
          >
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary-fixed-dim">
              계정 연결
            </p>

            <h2 className="mt-4 text-[34px] font-black leading-none">
              로그인
            </h2>
            <p className="mt-3 text-[15px] leading-6 text-on-dark-soft">
              질문과 출처 기록을 같은 세션에 보관하려면 Google 계정으로
              인증하세요.
            </p>
            <p className="mt-4 rounded-[8px] border border-white/10 bg-white/[0.05] px-3 py-3 text-[13px] font-semibold leading-5 text-on-dark-soft">
              인증 후 요청한 화면으로 안전하게 이동합니다.
            </p>

            <div className="mt-6 space-y-md">
              {error && (
                <div
                  ref={errorRef}
                  className={`rounded-[8px] border border-error/25 bg-error-container/90 p-sm text-[14px] font-semibold leading-[1.5] text-on-error-container transition-all duration-150 ease-out ${
                    errorVisible
                      ? "translate-y-0 opacity-100"
                      : "-translate-y-1 opacity-0"
                  }`}
                  role="alert"
                  tabIndex={-1}
                >
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="relative flex h-[52px] w-full items-center justify-center gap-sm rounded-[8px] bg-canvas px-base text-[16px] font-extrabold leading-[1.15] text-ink transition-all duration-150 ease-out hover:bg-primary-fixed active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="pointer-events-none relative h-5 w-5 shrink-0">
                  <span
                    aria-hidden="true"
                    className={`absolute inset-0 transition-all duration-150 ease-out ${
                      loading
                        ? "opacity-0 scale-95"
                        : "opacity-100 scale-100"
                    }`}
                  >
                    <GoogleMark />
                  </span>
                  <span
                    aria-hidden="true"
                    className={`absolute inset-0 rounded-full border-2 border-primary border-t-transparent transition-all duration-150 ease-out ${
                      loading
                        ? "opacity-100 scale-100 animate-spin"
                        : "opacity-0 scale-95"
                    }`}
                  />
                </span>
                {loading ? "Google로 이동 중..." : "Google로 계속하기"}
              </button>

              <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-1 text-center text-[12px] font-bold leading-5 text-on-dark-soft/80">
                {trustSignals.map((item, index) => (
                  <li key={item} className="flex items-center gap-x-2">
                    {index > 0 && (
                      <span
                        aria-hidden="true"
                        className="h-1 w-1 rounded-full bg-primary-fixed-dim/70"
                      />
                    )}
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-lg text-center text-[13px] font-semibold leading-[1.5] text-on-dark-soft">
            KRW Ontology · 근거 기반 기업 리서치
          </p>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/5 px-base py-lg text-center">
        <div className="flex flex-col items-center justify-center gap-2 text-[13px] font-semibold leading-[1.5] text-on-dark-soft/70 sm:flex-row sm:gap-3">
          <span>© 2026 KRW Ontology. 모든 권리 보유.</span>
          <Link href="/privacy" className="transition-colors hover:text-on-dark-soft">
            개인정보처리방침
          </Link>
          <Link href="/terms" className="transition-colors hover:text-on-dark-soft">
            서비스 약관
          </Link>
        </div>
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-surface-dark text-on-dark">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-fixed-dim border-t-transparent" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
