import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import AnalyticsBootstrap from "@/components/analytics/AnalyticsBootstrap";
import AppShell from "@/components/AppShell";
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
  themeColor: "#003ec7",
  colorScheme: "only light",
};

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

  return (
    <html lang={localeToHtmlLang(locale)} className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-canvas text-on-surface">
        <AnalyticsBootstrap />
        {/* L-05: Skip to content link for accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[999] focus:px-md focus:py-sm focus:bg-primary focus:text-on-primary focus:rounded"
        >
          {locale === "ko" ? "메인 콘텐츠로 이동" : "Skip to main content"}
        </a>
        <Suspense fallback={children}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
