"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { KrwBrand } from "@/components/KrwBrand";
import { createClient } from "@/lib/supabase/client";
import { easeOutExpo } from "@/lib/animation";
import { useReducedMotion } from "@/hooks/useReducedMotion";

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
  const reducedMotion = useReducedMotion();
  const initialError = searchParams.get("error") === "oauth";
  const nextPath = safeNextPath(searchParams.get("next"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? "Google 인증을 완료하지 못했습니다. 다시 시도해주세요." : null,
  );
  const [errorVisible, setErrorVisible] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const entranceTransition = {
    duration: reducedMotion ? 0 : 0.22,
    ease: easeOutExpo,
  };

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
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-canvas text-ink">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,11,13,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(10,11,13,0.04)_1px,transparent_1px)] bg-[size:64px_64px]"
      />

      <header className="sticky top-0 z-50 h-[72px] w-full flex-shrink-0 border-b border-hairline bg-canvas/95 backdrop-blur-xl">
        <div className="mx-auto flex h-full w-full max-w-[1600px] items-center px-base sm:px-md">
          <KrwBrand compact />
        </div>
      </header>

      <main
        id="main-content"
        className="relative z-10 flex w-full flex-1 items-center justify-center px-base py-xl sm:px-md lg:px-xl"
      >
        {!reducedMotion && (
          <motion.svg
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[340px] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-visible text-primary"
            fill="none"
            viewBox="0 0 720 340"
          >
            <motion.path
              d="M90 170 C190 92 306 104 360 170 C414 236 530 248 630 170"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.5"
              initial={{ opacity: 0, pathLength: 0 }}
              animate={{ opacity: [0, 0.28, 0], pathLength: [0, 1, 1] }}
              transition={{
                duration: 1.15,
                ease: easeOutExpo,
                times: [0, 0.72, 1],
              }}
            />
            <motion.circle
              cx="360"
              cy="170"
              r="3"
              fill="currentColor"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.38, 0], scale: [0.8, 1, 0.9] }}
              transition={{
                duration: 0.72,
                delay: 0.45,
                ease: easeOutExpo,
              }}
            />
          </motion.svg>
        )}

        <motion.section
          className="relative z-10 w-full max-w-[480px] rounded-[12px] border border-hairline bg-canvas p-6 text-ink shadow-[0_18px_48px_rgba(10,11,13,0.12)] sm:p-8"
          initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...entranceTransition, duration: reducedMotion ? 0 : 0.32 }}
        >
          <motion.h1
            className="break-keep text-[31px] font-black leading-[1.08] text-ink sm:text-[40px]"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reducedMotion ? 0 : 0.28,
              delay: reducedMotion ? 0 : 0.06,
              ease: easeOutExpo,
            }}
          >
            내 리서치 공간으로 들어가기
          </motion.h1>
          <motion.p
            className="mt-4 text-[15px] leading-6 text-body sm:text-[16px] sm:leading-7"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reducedMotion ? 0 : 0.28,
              delay: reducedMotion ? 0 : 0.12,
              ease: easeOutExpo,
            }}
          >
            선택한 회사와 채팅 기록을 이어서 확인하려면 Google로
            로그인하세요.
          </motion.p>

          <motion.div
            className="mt-7 space-y-md"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reducedMotion ? 0 : 0.28,
              delay: reducedMotion ? 0 : 0.18,
              ease: easeOutExpo,
            }}
          >
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

            <motion.button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              whileTap={reducedMotion || loading ? undefined : { scale: 0.985 }}
              className={`relative flex h-[52px] w-full items-center justify-center gap-sm rounded-[8px] border px-base text-[16px] font-extrabold leading-[1.15] text-ink shadow-[0_8px_20px_rgba(10,11,13,0.08)] transition-all duration-150 ease-out hover:border-primary hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70 ${
                loading ? "border-primary bg-primary-fixed" : "border-hairline bg-canvas"
              }`}
            >
              <span className="pointer-events-none relative h-5 w-5 shrink-0">
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 transition-all duration-150 ease-out ${
                    loading ? "opacity-0 scale-95" : "opacity-100 scale-100"
                  }`}
                >
                  <GoogleMark />
                </span>
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-full border-2 border-primary border-t-transparent transition-all duration-150 ease-out ${
                    loading ? "opacity-100 scale-100 animate-spin" : "opacity-0 scale-95"
                  }`}
                />
              </span>
              {loading ? "Google로 이동 중..." : "Google로 계속하기"}
            </motion.button>

            <p className="text-center text-[13px] font-semibold leading-5 text-muted">
              로그인 후 이전 화면으로 돌아갑니다.
            </p>
          </motion.div>
        </motion.section>
      </main>

      <footer className="relative z-10 border-t border-hairline bg-canvas px-base py-lg text-center">
        <div className="flex flex-col items-center justify-center gap-2 text-[13px] font-semibold leading-[1.5] text-muted sm:flex-row sm:gap-3">
          <span>© 2026 KRW Ontology. 모든 권리 보유.</span>
          <Link href="/privacy" className="transition-colors hover:text-ink">
            개인정보처리방침
          </Link>
          <Link href="/terms" className="transition-colors hover:text-ink">
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
        <div className="flex min-h-[100dvh] items-center justify-center bg-canvas text-ink">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
