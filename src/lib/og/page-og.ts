import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";
import { getQuestionTopicDisplay } from "@/content/questions/display";
import {
  findQuestionTopic,
  SITE_DESCRIPTION,
  SITE_NAME,
  type QuestionTopicPage,
} from "@/lib/marketing/site";
import type { IndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";

export interface PageOgCopy {
  kicker: string;
  title: string;
  description: string;
  footer: string;
  badge: string;
  brandName: string;
  alt: string;
}

export function parseOgLocale(value: string | null): Locale {
  return isLocale(value) ? value : "ko";
}

export function buildSitePageOgCopy(
  variant: string,
  locale: Locale,
): PageOgCopy {
  const copy = siteVariantCopy[locale][variant] ?? siteVariantCopy[locale].default;
  return buildCopy({
    ...copy,
    brandName: SITE_NAME,
  });
}

export function buildCompanyPageOgCopy(
  ticker: string,
  locale: Locale,
  company?: IndexedCompany | null,
): PageOgCopy {
  const normalizedTicker = normalizeTicker(ticker) || ticker.toUpperCase();
  const displayCopy = normalizedTicker
    ? getCompanyDisplayCopyForTicker(locale, normalizedTicker)
    : {};
  const name =
    locale === "ko"
      ? displayCopy.companyNameKo ?? company?.name ?? normalizedTicker
      : displayCopy.name ?? company?.name ?? normalizedTicker;
  const sector = displayCopy.sector ?? company?.sector ?? null;
  const title =
    locale === "ko"
      ? `${normalizedTicker} ${name} 기업 리서치`
      : `${normalizedTicker} ${name} company research`;
  const description =
    locale === "ko"
      ? `${name}의 실적 변화, 리스크, 사업 흐름을 회사 보고서 근거로 확인합니다.`
      : `Review ${name}'s performance changes, risks, and business drivers with filing-grounded evidence.`;

  return buildCopy({
    kicker: locale === "ko" ? "기업 리서치" : "Company research",
    title,
    description,
    footer:
      locale === "ko"
        ? "매일 공시·뉴스·기관 보유·내부자 거래를 모아 오늘 확인할 리서치 거리를 골라줍니다."
        : "Filings, news, 13F holdings, and insider trades — daily research leads worth checking.",
    badge: sector || (locale === "ko" ? "공시 기반" : "Filing-grounded"),
    brandName: SITE_NAME,
  });
}

export function buildQuestionPageOgCopy(
  slug: string,
  locale: Locale,
): PageOgCopy {
  const topic = findQuestionTopic(slug);
  if (!topic) {
    return buildSitePageOgCopy("questions", locale);
  }

  return buildQuestionTopicCopy(topic, locale);
}

function buildQuestionTopicCopy(
  topic: QuestionTopicPage,
  locale: Locale,
): PageOgCopy {
  const displayTopic = getQuestionTopicDisplay(locale, topic);
  return buildCopy({
    kicker: locale === "ko" ? "질문 그래프" : "Question graph",
    title:
      locale === "ko"
        ? `${displayTopic.shortTitle} 리서치 흐름`
        : `${displayTopic.shortTitle} research flow`,
    description: displayTopic.description,
    footer:
      locale === "ko"
        ? "질문 하나에서 끝나지 않고, 다음 리서치 질문으로 이어갑니다."
        : "Move from one question into the next filing-grounded research path.",
    badge: displayTopic.category,
    brandName: SITE_NAME,
  });
}

function buildCopy({
  kicker,
  title,
  description,
  footer,
  badge,
  brandName,
}: Omit<PageOgCopy, "alt">): PageOgCopy {
  const safeTitle = truncate(title, 58);
  const safeDescription = truncate(description, 118);
  return {
    kicker: truncate(kicker, 32),
    title: safeTitle,
    description: safeDescription,
    footer: truncate(footer, 96),
    badge: truncate(badge, 32),
    brandName,
    alt: `${safeTitle} | ${brandName}`,
  };
}

function truncate(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(clean);
  if (characters.length <= maxLength) return clean;
  return `${characters.slice(0, maxLength - 1).join("").trimEnd()}...`;
}

const siteVariantCopy: Record<Locale, Record<string, Omit<PageOgCopy, "alt" | "brandName">>> = {
  ko: {
    default: {
      kicker: "공시 기반 기업 분석",
      title: "공시 근거가 보이는 기업 분석 AI",
      description: SITE_DESCRIPTION,
      footer: "매일 공시·뉴스·기관 보유·내부자 거래를 모아 오늘 확인할 리서치 거리를 골라줍니다.",
      badge: "KRW Research",
    },
    home: {
      kicker: "개인 리서치 데스크",
      title: "매일 확인할 리서치 거리를 골라 드립니다",
      description:
        "공시·뉴스·기관 보유·내부자 거래를 한 곳에 모아, 오늘 확인할 리서치 거리를 골라 드립니다.",
      footer: "오늘의 리서치는 매일 새로 도착합니다.",
      badge: "Filing-grounded",
    },
    pricing: {
      kicker: "기능별 플랜",
      title: "미국 상장기업 리서치를 필요한 만큼 시작하세요",
      description:
        "리서치 범위에 맞는 기능별 플랜을 선택해 기업 분석을 이어가세요.",
      footer: "긴 보고서 대신 질문 중심 리서치 흐름으로 시작합니다.",
      badge: "Plans",
    },
    companies: {
      kicker: "회사 찾기",
      title: "분석할 회사를 고르세요",
      description:
        "티커, 회사명, 사업 활동, 리스크 키워드로 공시 기반 리서치가 가능한 회사를 찾습니다.",
      footer: "회사를 알면 검색하고, 조건이 있으면 확인할 회사를 좁히세요.",
      badge: "Company list",
    },
    questions: {
      kicker: "질문 그래프",
      title: "기업 리서치 질문을 흐름으로 시작하세요",
      description:
        "매출 성장, 마진 변화, 리스크 요인, 세그먼트 성과를 질문 그래프로 이어갑니다.",
      footer: "첫 질문 이후에도 이어서 볼 질문으로 리서치가 계속됩니다.",
      badge: "Question flows",
    },
  },
  en: {
    default: {
      kicker: "Filing-grounded research",
      title: "Company analysis AI with visible evidence",
      description:
        "Trace U.S. public company performance changes, risks, and business drivers back to filing evidence.",
      footer: "Filings, news, 13F holdings, and insider trades — daily research leads worth checking.",
      badge: "KRW Research",
    },
    home: {
      kicker: "Personal research desk",
      title: "Daily research leads worth checking",
      description:
        "Filings, market news, institutional holdings, and insider trades in one place — so today's research finds you.",
      footer: "A fresh set of research questions arrives every day.",
      badge: "Filing-grounded",
    },
    pricing: {
      kicker: "Usage-based plans",
      title: "Start U.S. company research at your pace",
      description:
        "Choose a usage-based plan that fits your research scope as your company analysis needs grow.",
      footer: "Move from long filings to question-driven research workflows.",
      badge: "Plans",
    },
    companies: {
      kicker: "Company search",
      title: "Choose a company to analyze",
      description:
        "Find supported companies by ticker, name, business activity, and risk keyword.",
      footer: "Search when you know the company, or use discovery when you do not.",
      badge: "Company list",
    },
    questions: {
      kicker: "Question graphs",
      title: "Start company research from connected questions",
      description:
        "Explore revenue growth, margin change, risk factors, and segment performance through question flows.",
      footer: "Continue from one answer into the next useful research question.",
      badge: "Question flows",
    },
  },
};
