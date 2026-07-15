import {
  getCompanyDisplayCopyForTicker,
  getSuggestedPromptDisplaysForTickers,
} from "@/content/companies/display";
import type { CompanyMeta } from "@/lib/chat/company-meta";
import type { ShareStarter } from "@/hooks/useShareStarter";
import {
  getGuruLensDisplayName,
  getGuruSuggestedPrompts,
  type GuruLensOption,
} from "@/lib/guru-lenses";
import type { QuestionTopicPage } from "@/lib/marketing/site";
import type { Locale } from "@/i18n/config";

export type ChatPrefillSource =
  | "url_query"
  | "share_cta"
  | "template_id"
  | null;

export function deriveChatPresentationContext({
  contextTickers,
  companyMetaByTicker,
  responseLocale,
  isGuruAdvisor,
  isIdeaGeneration,
  selectedGuruLens,
  queryParam,
  templateId,
  shareToken,
  shareStarter,
  templateTopic,
  activeTicker,
}: {
  contextTickers: readonly string[];
  companyMetaByTicker: Record<string, CompanyMeta>;
  responseLocale: Locale;
  isGuruAdvisor: boolean;
  isIdeaGeneration: boolean;
  selectedGuruLens: GuruLensOption;
  queryParam: string | null;
  templateId: string | null;
  shareToken: string | null;
  shareStarter: ShareStarter | null;
  templateTopic: QuestionTopicPage | null;
  activeTicker: string | null;
}) {
  const contextCompanies = contextTickers.map((contextTicker) => {
    const normalizedTicker = contextTicker.trim().toUpperCase();
    return (
      companyMetaByTicker[normalizedTicker] ?? {
        ticker: normalizedTicker,
        name: null,
        sector: null,
      }
    );
  });
  const contextLabel = contextCompanies
    .map((company) =>
      company.name ? `${company.name} (${company.ticker})` : company.ticker,
    )
    .join(", ");
  const contextTickerText = contextCompanies
    .map((company) => company.ticker)
    .join(" / ");
  const contextDisplayText = contextCompanies
    .map((company) => {
      const copy = getCompanyDisplayCopyForTicker(responseLocale, company.ticker);
      return copy.companyNameKo || copy.name || company.name || company.ticker;
    })
    .join(" / ");
  const contextNameText = contextCompanies
    .map((company) => company.name)
    .filter((name): name is string => Boolean(name))
    .join(", ");
  const contextSectorText = Array.from(
    new Set(
      contextCompanies
        .map((company) => company.sector)
        .filter((sector): sector is string => Boolean(sector)),
    ),
  ).join(" / ");
  const headerActionTicker = contextTickers[0] ?? null;
  const primaryContextCompany = contextCompanies[0] ?? null;
  const guruContextCompany = isGuruAdvisor
    ? primaryContextCompany ?? null
    : null;
  const guruSuggestedPrompts = getGuruSuggestedPrompts(
    selectedGuruLens,
    responseLocale,
    { hasCompanyContext: Boolean(guruContextCompany) },
  );
  const selectedGuruDisplayName = getGuruLensDisplayName(
    selectedGuruLens,
    responseLocale,
  );
  const suggestedPrompts = isGuruAdvisor
    ? guruSuggestedPrompts
    : getSuggestedPromptDisplaysForTickers(responseLocale, contextTickers);
  const emptyStateCopy = isIdeaGeneration
    ? responseLocale === "ko"
      ? {
          headingWithContext: "어떤 종목을 발굴할까요?",
          headingWithoutContext: "어떤 종목을 발굴할까요?",
          descriptionWithoutContext:
            "아이디어, 산업, 리스크, 재무 조건을 넣으면 관련 회사를 넓게 찾아봅니다.",
        }
      : {
          headingWithContext: "What stocks should we discover?",
          headingWithoutContext: "What stocks should we discover?",
          descriptionWithoutContext:
            "Enter an idea, industry, risk, or financial condition to explore related companies broadly.",
        }
    : isGuruAdvisor
      ? responseLocale === "ko"
        ? {
            headingWithContext: `${selectedGuruDisplayName}에게 ${contextTickerText}를 물어보세요.`,
            headingWithoutContext: selectedGuruDisplayName,
            descriptionWithoutContext:
              `${selectedGuruLens.descriptionKo} ${selectedGuruLens.detailKo}`,
          }
        : {
            headingWithContext: `Ask ${selectedGuruDisplayName} about ${contextTickerText}.`,
            headingWithoutContext: selectedGuruDisplayName,
            descriptionWithoutContext:
              `${selectedGuruLens.descriptionEn} ${selectedGuruLens.detailEn}`,
          }
      : responseLocale === "ko"
        ? {
            headingWithContext: `${contextDisplayText}에서 무엇을 확인할까요?`,
            headingWithoutContext: "와이드 리서치",
            descriptionWithoutContext:
              "회사를 모를 때는 아이디어·산업·리스크 조건으로 연관 기업을 넓게 찾아봅니다.",
          }
        : {
            headingWithContext: `What should we check for ${contextDisplayText}?`,
            headingWithoutContext: "Wide research",
            descriptionWithoutContext:
              "When you do not know the company yet, use idea, industry, and risk conditions to expand the candidate set.",
          };
  const queryValue = queryParam?.trim() || null;
  const shareQuestionValue = shareStarter?.question_content.trim() || null;
  const templateQuestion =
    templateTopic &&
    activeTicker?.trim().toUpperCase() === templateTopic.questionChain.ticker
      ? templateTopic.questionChain.primaryQuestion
      : (templateTopic?.question ?? null);
  const initialComposerValue =
    queryValue ?? shareQuestionValue ?? templateQuestion ?? undefined;
  const prefillSource: ChatPrefillSource = queryValue
    ? "url_query"
    : shareQuestionValue
      ? "share_cta"
      : templateTopic
        ? "template_id"
        : null;
  const hasComposerPrefillParams = Boolean(
    queryParam || templateId || shareToken || shareStarter,
  );

  return {
    contextCompanies,
    contextLabel,
    contextTickerText,
    contextDisplayText,
    contextNameText,
    contextSectorText,
    headerActionTicker,
    primaryContextCompany,
    guruContextCompany,
    suggestedPrompts,
    emptyStateCopy,
    initialComposerValue,
    prefillSource,
    hasComposerPrefillParams,
  };
}
