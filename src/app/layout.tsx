import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import AnalyticsBootstrap from "@/components/analytics/AnalyticsBootstrap";
import ApiPerformanceReporter from "@/components/analytics/ApiPerformanceReporter";
import WebVitalsReporter from "@/components/analytics/WebVitalsReporter";
import InteractionPerformanceReporter from "@/components/analytics/InteractionPerformanceReporter";
import AppShell from "@/components/AppShell";
import PwaBootstrap from "@/components/pwa/PwaBootstrap";
import {
  DEFAULT_LOCALE,
  isLocale,
  localeToHtmlLang,
} from "@/i18n/config";
import {
  absoluteUrl,
  buildSiteOgImagePath,
  PAGE_OG_IMAGE_SIZE,
  getSiteOrigin,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/marketing/site";
import { getAuthUser } from "@/lib/auth";
import {
  shouldPreserveInitialProfile,
  topNavProfileFromUser,
} from "@/lib/auth/user-profile";
import { getWorkspaceShellMode } from "@/lib/navigation/workspace-routes";
import { DEVELOPMENT_SERVICE_WORKER_RESET_SCRIPT } from "@/lib/pwa/development-service-worker-reset";
import "./globals.css";

const googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION?.trim();
const defaultOgImage = {
  url: absoluteUrl(buildSiteOgImagePath("default")),
  width: PAGE_OG_IMAGE_SIZE.width,
  height: PAGE_OG_IMAGE_SIZE.height,
  alt: `${SITE_NAME} | 근거가 보이는 기업 분석 AI`,
};

export const metadata: Metadata = {
  metadataBase: new URL(getSiteOrigin()),
  applicationName: SITE_NAME,
  title: {
    default: `${SITE_NAME} | 근거가 보이는 기업 분석 AI`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "기업 리서치 AI",
    "미국 주식 공시 분석",
    "10-K 분석",
    "10-Q 분석",
    "공시 근거",
    "투자 thesis check",
  ],
  icons: {
    icon: [
      {
        url: "/favicon.ico",
        sizes: "any",
      },
      {
        url: "/krw-logo.svg",
        type: "image/svg+xml",
      },
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  openGraph: {
    title: `${SITE_NAME} | 근거가 보이는 기업 분석 AI`,
    description: SITE_DESCRIPTION,
    url: getSiteOrigin(),
    siteName: SITE_NAME,
    locale: "ko_KR",
    type: "website",
    images: [defaultOgImage],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | 근거가 보이는 기업 분석 AI`,
    description: SITE_DESCRIPTION,
    images: [defaultOgImage.url],
  },
  ...(googleSiteVerification
    ? {
        verification: {
          google: googleSiteVerification,
        },
      }
    : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#003ec7",
  colorScheme: "only light",
};

function RootAppShellFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[100dvh] w-full flex-col bg-canvas"
    >
      <div className="h-[72px] flex-shrink-0 border-b border-hairline bg-canvas md:h-[64px]">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between px-base sm:px-md">
          <div className="flex items-center gap-sm">
            <div className="h-11 w-11 rounded-[8px] bg-surface-soft" />
            <div className="h-6 w-20 rounded bg-surface-soft" />
          </div>
          <div className="h-11 w-11 rounded-[8px] bg-surface-soft" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1280px] flex-1 px-base py-lg sm:px-xl">
        <div className="h-4 w-24 rounded bg-surface-soft" />
        <div className="mt-3 h-9 w-2/3 max-w-xl rounded bg-surface-soft" />
        <div className="mt-8 grid gap-base">
          <div className="h-40 rounded-[16px] border border-hairline bg-surface-soft" />
          <div className="h-28 rounded-[16px] border border-hairline bg-surface-soft" />
        </div>
      </div>
    </div>
  );
}

async function ResolvedAppShell({
  children,
  shouldSeedWorkspaceProfile,
}: {
  children: React.ReactNode;
  shouldSeedWorkspaceProfile: boolean;
}) {
  const workspaceUser = shouldSeedWorkspaceProfile
    ? await getAuthUser().catch(() => null)
    : null;

  return (
    <AppShell
      initialUserProfile={topNavProfileFromUser(workspaceUser)}
      initialAuthResolved={shouldSeedWorkspaceProfile}
      preserveInitialUserProfile={shouldPreserveInitialProfile(workspaceUser)}
    >
      {children}
    </AppShell>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonces require runtime rendering so Next can attach them.
  await connection();
  const requestHeaders = await headers();
  const requestLocale = requestHeaders.get("x-krw-locale");
  const locale = isLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE;
  const requestPathname = requestHeaders.get("x-krw-pathname") ?? "/";
  const workspaceShellMode = getWorkspaceShellMode(requestPathname);
  const shouldSeedWorkspaceProfile =
    workspaceShellMode === "standard";

  return (
    <html
      lang={localeToHtmlLang(locale)}
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-canvas text-on-surface">
        {process.env.NODE_ENV !== "production" ? (
          // This raw inline script needs the request CSP nonce. Browsers
          // intentionally mask nonce attributes after parsing, so suppress the
          // resulting false hydration warning in `next dev` for this tag only.
          <script
            nonce={requestHeaders.get("x-nonce") ?? undefined}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{
              __html: DEVELOPMENT_SERVICE_WORKER_RESET_SCRIPT,
            }}
          />
        ) : null}
        <AnalyticsBootstrap />
        <ApiPerformanceReporter />
        <WebVitalsReporter />
        <InteractionPerformanceReporter />
        <PwaBootstrap />
        {/* L-05: Skip to content link for accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[999] focus:px-md focus:py-sm focus:bg-primary focus:text-on-primary focus:rounded"
        >
          {locale === "ko" ? "메인 콘텐츠로 이동" : "Skip to main content"}
        </a>
        <Suspense fallback={<RootAppShellFallback />}>
          <ResolvedAppShell
            shouldSeedWorkspaceProfile={shouldSeedWorkspaceProfile}
          >
            {children}
          </ResolvedAppShell>
        </Suspense>
      </body>
    </html>
  );
}
