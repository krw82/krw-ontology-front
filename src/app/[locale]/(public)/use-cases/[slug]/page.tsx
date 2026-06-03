import { notFound, permanentRedirect } from "next/navigation";
import { SUPPORTED_LOCALES, isLocale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
import {
  findQuestionTopic,
  findUseCase,
  USE_CASE_PAGES,
  type QuestionTopicPage,
} from "@/lib/marketing/site";

type UseCasePageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export function generateStaticParams() {
  return SUPPORTED_LOCALES.flatMap((locale) =>
    USE_CASE_PAGES.map((useCase) => ({ locale, slug: useCase.slug })),
  );
}

export default async function UseCaseLandingPage({ params }: UseCasePageProps) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  const useCase = findUseCase(slug);
  const canonicalQuestion = useCase?.recommendedQuestionSlugs
    .map(findQuestionTopic)
    .find((topic): topic is QuestionTopicPage => Boolean(topic));

  permanentRedirect(
    localizedPath(
      locale,
      canonicalQuestion ? `/questions/${canonicalQuestion.slug}` : "/questions",
    ),
  );
}
