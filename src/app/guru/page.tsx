import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ChatPageClient from "@/app/chat/ChatPageClient";
import ProductOnboardingTour from "@/components/ProductOnboardingTour";
import GuruDirectoryClient from "@/components/guru/GuruDirectoryClient";
import TopNav from "@/components/TopNav";
import { getAuthUser } from "@/lib/auth";
import {
  shouldPreserveInitialProfile,
  topNavProfileFromUser,
} from "@/lib/auth/user-profile";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { normalizeGuruLensKey } from "@/lib/guru-lenses";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "관점별 분석 | KRW.O",
  description:
    "공개된 질문 원칙으로 회사와 아이디어의 근거를 점검하는 분석 공간입니다.",
};

type GuruPageProps = {
  searchParams: Promise<{
    guru?: string | string[];
    sessionId?: string | string[];
    draftMessageId?: string | string[];
    query?: string | string[];
    locale?: string | string[];
    ticker?: string | string[];
    tour?: string | string[];
    onboarding?: string | string[];
    continue?: string | string[];
  }>;
};

function stringParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function buildLoginNext(query: Awaited<GuruPageProps["searchParams"]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    } else if (value) {
      params.set(key, value);
    }
  }

  const queryString = params.toString();
  return queryString ? `/guru?${queryString}` : "/guru";
}

export default async function GuruPage({ searchParams }: GuruPageProps) {
  const query = await searchParams;
  const user = await getAuthUser().catch(() => null);
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(buildLoginNext(query))}`);
  }

  const localeParam = stringParam(query.locale);
  const locale = isLocale(localeParam) ? localeParam : DEFAULT_LOCALE;
  const guruParam = stringParam(query.guru);
  const selectedGuruLens = normalizeGuruLensKey(guruParam);
  const companyTicker = normalizeTicker(stringParam(query.ticker) ?? "");
  const company = companyTicker
    ? await getIndexedCompany(companyTicker)
    : null;
  const displayCopy = company
    ? getCompanyDisplayCopyForTicker(locale, company.ticker)
    : null;
  const companyContext = company
    ? {
        ticker: company.ticker,
        name:
          locale === "ko" && displayCopy?.companyNameKo
            ? displayCopy.companyNameKo
            : company.name,
      }
    : null;
  const forceOnboarding =
    stringParam(query.tour) === "1" || stringParam(query.onboarding) === "1";
  const onboardingContinuePath = stringParam(query.continue);
  const onboardingPathname = locale === DEFAULT_LOCALE ? "/guru" : `/${locale}/guru`;
  const shouldOpenChat = Boolean(
    stringParam(query.sessionId) ||
      stringParam(query.draftMessageId) ||
      stringParam(query.query) ||
      (selectedGuruLens && selectedGuruLens !== "auto"),
  );

  if (shouldOpenChat) {
    return (
      <>
        <ChatPageClient workspace="guru" />
        <ProductOnboardingTour
          pathname={onboardingPathname}
          tour="guru-chat"
          force={forceOnboarding}
          continuePath={onboardingContinuePath}
        />
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <TopNav
        initialUserProfile={topNavProfileFromUser(user)}
        preserveInitialUserProfile={shouldPreserveInitialProfile(user)}
        brandHref="/companies"
        brandAriaLabel="회사 목록으로 이동"
        showSidebarTrigger={false}
        showSidebarCoachmarkTip={false}
        showLocaleSwitcher
      />
      <GuruDirectoryClient locale={locale} company={companyContext} />
      <ProductOnboardingTour
        pathname={onboardingPathname}
        tour="guru-directory"
        force={forceOnboarding}
        continuePath={onboardingContinuePath}
      />
    </div>
  );
}
