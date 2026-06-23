"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { KrwBrand } from "@/components/KrwBrand";
import { normalizeInternalNextPath } from "@/lib/auth/redirect-path";
import { getConfiguredAppOrigin } from "@/lib/auth/origin";
import { trackClientEventWithTimeout } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { easeOutExpo } from "@/lib/animation";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";

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

const SAFE_INTERNAL_ORIGIN = "https://krw-ontology.local";

const loginCopy: Record<
  Locale,
  {
    oauthError: string;
    googleError: string;
    desktopApproveFailed: string;
    desktopApproved: string;
    headline: string;
    intro: string;
    desktopApprovalTitle: string;
    approvalCodeLabel: string;
    desktopChecking: string;
    desktopSignedOut: string;
    desktopApproving: string;
    desktopApprove: string;
    desktopOpen: string;
    googleMoving: string;
    googleContinue: string;
    googleStart: string;
    footnote: string;
    copyright: string;
    privacy: string;
    terms: string;
    refund: string;
    pageTitle: string;
  }
> = {
  ko: {
    oauthError: "Google 인증을 완료하지 못했습니다. 다시 시도해주세요.",
    googleError: "Google 로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    desktopApproveFailed: "Desktop 연결을 승인하지 못했습니다.",
    desktopApproved: "승인 완료. KRW Desktop 앱으로 이동 중입니다.",
    headline: "무료 베타로 기업 분석 시작",
    intro:
      "카드 등록 없이 Google 계정으로 시작합니다. 선택한 회사, 질문 기록, 무료 베타 사용량을 안전하게 이어서 확인할 수 있습니다.",
    desktopApprovalTitle: "KRW Desktop 연결 승인",
    approvalCodeLabel: "승인 코드",
    desktopChecking: "로그인 상태 확인 중...",
    desktopSignedOut: "Google 로그인 후 이 Desktop 연결을 승인할 수 있습니다.",
    desktopApproving: "승인 중...",
    desktopApprove: "Desktop 연결 승인",
    desktopOpen: "KRW Desktop 열기",
    googleMoving: "Google로 이동 중...",
    googleContinue: "Google로 로그인하고 계속",
    googleStart: "Google로 무료 시작",
    footnote: "무료 베타 · 카드 불필요 · 로그인 후 이전 화면으로 돌아갑니다.",
    copyright: "© 2026 KRW Ontology. 모든 권리 보유.",
    privacy: "개인정보처리방침",
    terms: "서비스 약관",
    refund: "환불정책",
    pageTitle: "무료 베타 로그인 | KRW Ontology",
  },
  en: {
    oauthError: "Google authentication could not be completed. Please try again.",
    googleError: "Something went wrong while signing in with Google. Please try again shortly.",
    desktopApproveFailed: "Could not approve the Desktop connection.",
    desktopApproved: "Approved. Opening the KRW Desktop app.",
    headline: "Start company analysis for free",
    intro:
      "Continue with your Google account. Your selected companies, question history, and free beta usage stay connected safely.",
    desktopApprovalTitle: "Approve KRW Desktop connection",
    approvalCodeLabel: "Approval code",
    desktopChecking: "Checking sign-in status...",
    desktopSignedOut: "Sign in with Google to approve this Desktop connection.",
    desktopApproving: "Approving...",
    desktopApprove: "Approve Desktop connection",
    desktopOpen: "Open KRW Desktop",
    googleMoving: "Opening Google...",
    googleContinue: "Sign in with Google and continue",
    googleStart: "Start free with Google",
    footnote: "Free beta · no card required · returns to the previous screen after sign-in.",
    copyright: "© 2026 KRW Ontology. All rights reserved.",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    refund: "Refund Policy",
    pageTitle: "Free beta login | KRW Ontology",
  },
};

function getLocaleFromInternalPath(value: string | null): Locale | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const url = new URL(value, SAFE_INTERNAL_ORIGIN);
    const [, pathLocale] = url.pathname.split("/");
    if (isLocale(pathLocale)) return pathLocale;

    const queryLocale = url.searchParams.get("locale");
    return isLocale(queryLocale) ? queryLocale : null;
  } catch {
    return null;
  }
}

function resolveLoginLocale(
  localeParam: string | null,
  nextParam: string | null,
): Locale {
  if (isLocale(localeParam)) return localeParam;
  return getLocaleFromInternalPath(nextParam) ?? DEFAULT_LOCALE;
}

function LoginContent() {
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion();
  const initialError = searchParams.get("error") === "oauth";
  const rawNextPath = searchParams.get("next");
  const loginLocale = resolveLoginLocale(searchParams.get("locale"), rawNextPath);
  const copy = loginCopy[loginLocale];
  const nextPath = normalizeInternalNextPath(
    rawNextPath,
    localizedPath(loginLocale, "/companies"),
  );
  const desktopCode = normalizeDesktopCode(searchParams.get("desktop_code"));
  const desktopNextPath = desktopCode
    ? `/login?desktop_code=${encodeURIComponent(desktopCode)}${
        loginLocale === DEFAULT_LOCALE ? "" : `&locale=${loginLocale}`
      }`
    : nextPath;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? copy.oauthError : null,
  );
  const [desktopApprovalStatus, setDesktopApprovalStatus] = useState<
    "idle" | "checking" | "signed_out" | "ready" | "approving" | "approved" | "error"
  >(desktopCode ? "checking" : "idle");
  const [desktopApprovalMessage, setDesktopApprovalMessage] = useState<
    string | null
  >(null);
  const [errorVisible, setErrorVisible] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const oauthInFlightRef = useRef(false);
  const supabase = useMemo(() => createClient(), []);
  const entranceTransition = {
    duration: reducedMotion ? 0 : 0.22,
    ease: easeOutExpo,
  };

  useEffect(() => {
    document.title = copy.pageTitle;
  }, [copy.pageTitle]);

  const openDesktopApp = () => {
    window.location.href = "krw-desktop://device-login-approved";
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

  useEffect(() => {
    if (!desktopCode) return;

    let didCancel = false;
    void Promise.resolve()
      .then(async () => {
        if (didCancel) return;
        setDesktopApprovalStatus("checking");
        setDesktopApprovalMessage(null);
        const { data } = await supabase.auth.getUser();
        if (!didCancel) {
          setDesktopApprovalStatus(data.user ? "ready" : "signed_out");
        }
      })
      .catch(() => {
        if (!didCancel) setDesktopApprovalStatus("signed_out");
      });

    return () => {
      didCancel = true;
    };
  }, [desktopCode, supabase]);

  const handleDesktopApprove = async () => {
    if (!desktopCode || desktopApprovalStatus === "approving") return;
    setDesktopApprovalStatus("approving");
    setDesktopApprovalMessage(null);

    try {
      const response = await fetch("/api/desktop/auth/device/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_code: desktopCode }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(
          payload?.error?.public_message ??
            payload?.error?.message ??
            copy.desktopApproveFailed,
        );
      }
      setDesktopApprovalStatus("approved");
      setDesktopApprovalMessage(copy.desktopApproved);
      window.setTimeout(openDesktopApp, 120);
    } catch (approvalError) {
      setDesktopApprovalStatus("error");
      setDesktopApprovalMessage(
        approvalError instanceof Error
          ? approvalError.message
          : copy.desktopApproveFailed,
      );
    }
  };

  const handleGoogleSignIn = async () => {
    if (oauthInFlightRef.current) return;
    oauthInFlightRef.current = true;
    setLoading(true);
    setError(null);
    setErrorVisible(false);

    try {
      const redirectTo = new URL(
        "/auth/callback",
        getConfiguredAppOrigin() ?? window.location.origin,
      );
      redirectTo.searchParams.set("next", desktopNextPath);
      await trackClientEventWithTimeout("signup_started", {
        provider: "google",
        next_path: desktopNextPath,
      });
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectTo.toString(),
        },
      });
      if (authError) throw authError;
    } catch {
      oauthInFlightRef.current = false;
      setError(copy.googleError);
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
            {copy.headline}
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
            {copy.intro}
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

            {desktopCode && (
              <div className="rounded-[8px] border border-primary/25 bg-primary-fixed/55 p-sm text-left">
                <p className="text-[14px] font-extrabold leading-5 text-ink">
                  {copy.desktopApprovalTitle}
                </p>
                <p className="mt-1 text-[13px] font-semibold leading-5 text-body">
                  {copy.approvalCodeLabel}{" "}
                  <span className="font-black text-ink">{desktopCode}</span>
                </p>
                {desktopApprovalStatus === "checking" && (
                  <p className="mt-2 text-[13px] font-semibold leading-5 text-muted">
                    {copy.desktopChecking}
                  </p>
                )}
                {desktopApprovalStatus === "signed_out" && (
                  <p className="mt-2 text-[13px] font-semibold leading-5 text-muted">
                    {copy.desktopSignedOut}
                  </p>
                )}
                {(desktopApprovalStatus === "ready" ||
                  desktopApprovalStatus === "approving" ||
                  desktopApprovalStatus === "error") && (
                  <button
                    type="button"
                    onClick={handleDesktopApprove}
                    disabled={desktopApprovalStatus === "approving"}
                    className="mt-3 h-[44px] w-full rounded-[8px] border border-primary bg-primary px-base text-[14px] font-extrabold leading-[1.15] text-on-primary transition-opacity disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {desktopApprovalStatus === "approving"
                      ? copy.desktopApproving
                      : copy.desktopApprove}
                  </button>
                )}
                {desktopApprovalStatus === "approved" && (
                  <button
                    type="button"
                    onClick={openDesktopApp}
                    className="mt-3 h-[44px] w-full rounded-[8px] border border-primary bg-primary px-base text-[14px] font-extrabold leading-[1.15] text-on-primary transition-opacity"
                  >
                    {copy.desktopOpen}
                  </button>
                )}
                {desktopApprovalMessage && (
                  <p
                    className={`mt-2 text-[13px] font-semibold leading-5 ${
                      desktopApprovalStatus === "approved"
                        ? "text-success"
                        : "text-error"
                    }`}
                  >
                    {desktopApprovalMessage}
                  </p>
                )}
              </div>
            )}

            {(!desktopCode ||
              desktopApprovalStatus === "checking" ||
              desktopApprovalStatus === "signed_out") && (
              <motion.button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading || desktopApprovalStatus === "checking"}
                aria-busy={loading}
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
                {loading
                  ? copy.googleMoving
                  : desktopCode
                    ? copy.googleContinue
                    : copy.googleStart}
              </motion.button>
            )}

            <p className="text-center text-[13px] font-semibold leading-5 text-muted">
              {copy.footnote}
            </p>
          </motion.div>
        </motion.section>
      </main>

      <footer className="relative z-10 border-t border-hairline bg-canvas px-base py-lg text-center">
        <div className="flex flex-col items-center justify-center gap-2 text-[13px] font-semibold leading-[1.5] text-muted sm:flex-row sm:gap-3">
          <span>{copy.copyright}</span>
          <Link
            href={localizedPath(loginLocale, "/privacy")}
            className="transition-colors hover:text-ink"
          >
            {copy.privacy}
          </Link>
          <Link
            href={localizedPath(loginLocale, "/terms")}
            className="transition-colors hover:text-ink"
          >
            {copy.terms}
          </Link>
          <Link
            href={localizedPath(loginLocale, "/refund")}
            className="transition-colors hover:text-ink"
          >
            {copy.refund}
          </Link>
        </div>
      </footer>
    </div>
  );
}

function normalizeDesktopCode(value: string | null): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
  if (normalized.length !== 8) return null;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
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
