import { permanentRedirect } from "next/navigation";
import {
  findQuestionTopic,
  findUseCase,
  USE_CASE_PAGES,
  type QuestionTopicPage,
} from "@/lib/marketing/site";

type UseCasePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return USE_CASE_PAGES.map((useCase) => ({ slug: useCase.slug }));
}

export default async function UseCaseLandingPage({ params }: UseCasePageProps) {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  const canonicalQuestion = useCase?.recommendedQuestionSlugs
    .map(findQuestionTopic)
    .find((topic): topic is QuestionTopicPage => Boolean(topic));

  permanentRedirect(
    canonicalQuestion ? `/questions/${canonicalQuestion.slug}` : "/questions",
  );
}
