import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ChatPageClient from "@/app/chat/ChatPageClient";
import GuruDirectoryClient from "@/components/guru/GuruDirectoryClient";
import TopNav from "@/components/TopNav";
import { getAuthUser } from "@/lib/auth";
import {
  shouldPreserveInitialProfile,
  topNavProfileFromUser,
} from "@/lib/auth/user-profile";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { normalizeGuruLensKey } from "@/lib/guru-lenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "구루 상담소 | KRW Ontology",
  description:
    "투자 대가의 질문법으로 내 투자 아이디어를 점검하는 구루 상담소입니다.",
};

type GuruPageProps = {
  searchParams: Promise<{
    guru?: string | string[];
    sessionId?: string | string[];
    draftMessageId?: string | string[];
    query?: string | string[];
    locale?: string | string[];
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
  const shouldOpenChat = Boolean(
    stringParam(query.sessionId) ||
      stringParam(query.draftMessageId) ||
      stringParam(query.query) ||
      normalizeGuruLensKey(guruParam),
  );

  if (shouldOpenChat) {
    return <ChatPageClient workspace="guru" />;
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
      <GuruDirectoryClient locale={locale} />
    </div>
  );
}
