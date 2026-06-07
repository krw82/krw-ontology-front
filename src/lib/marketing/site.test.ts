import { describe, expect, it } from "vitest";
import {
  buildQuestionChatHref,
  buildUseCaseChatHref,
  findQuestionTopic,
  findUseCase,
  getQuestionTopicGroups,
  pageMetadata,
  QUESTION_TOPIC_PAGES,
  USE_CASE_PAGES,
} from "./site";

describe("marketing site content model", () => {
  it("keeps question and use-case slugs unique", () => {
    const questionSlugs = QUESTION_TOPIC_PAGES.map((topic) => topic.slug);
    const useCaseSlugs = USE_CASE_PAGES.map((useCase) => useCase.slug);

    expect(new Set(questionSlugs).size).toBe(questionSlugs.length);
    expect(new Set(useCaseSlugs).size).toBe(useCaseSlugs.length);
  });

  it("defines complete playbook fields for every question", () => {
    for (const topic of QUESTION_TOPIC_PAGES) {
      expect(topic.userProblem.length).toBeGreaterThan(20);
      expect(topic.bestFor.length).toBeGreaterThanOrEqual(2);
      expect(topic.notFor.length).toBeGreaterThanOrEqual(1);
      expect(topic.evidenceTargets.length).toBeGreaterThanOrEqual(2);
      expect(topic.promptVariants.length).toBeGreaterThanOrEqual(3);
      expect(topic.expectedAnswerShape.length).toBeGreaterThanOrEqual(2);
      expect(topic.exampleTickers.length).toBeGreaterThanOrEqual(2);
      expect(topic.questionChain.ticker).toBe("AAPL");
      expect(topic.questionChain.stages.length).toBeGreaterThanOrEqual(4);
      expect(topic.questionChain.primaryQuestion).toContain("Apple");
      for (const stage of topic.questionChain.stages) {
        expect(stage.nodes.length).toBeGreaterThanOrEqual(1);
        for (const node of stage.nodes) {
          expect(node.question).toContain("Apple");
        }
      }
    }
  });

  it("resolves all related question and use-case references", () => {
    for (const topic of QUESTION_TOPIC_PAGES) {
      for (const relatedSlug of topic.relatedQuestionSlugs) {
        expect(findQuestionTopic(relatedSlug)?.slug).toBe(relatedSlug);
      }
      for (const relatedSlug of topic.relatedUseCaseSlugs) {
        expect(findUseCase(relatedSlug)?.slug).toBe(relatedSlug);
      }
    }

    for (const useCase of USE_CASE_PAGES) {
      for (const relatedSlug of useCase.relatedQuestionSlugs) {
        expect(findQuestionTopic(relatedSlug)?.slug).toBe(relatedSlug);
      }
      for (const relatedSlug of useCase.recommendedQuestionSlugs) {
        expect(findQuestionTopic(relatedSlug)?.slug).toBe(relatedSlug);
      }
    }
  });

  it("groups questions by category without dropping topics", () => {
    const groupedSlugs = getQuestionTopicGroups().flatMap((group) =>
      group.topics.map((topic) => topic.slug),
    );

    expect(groupedSlugs.sort()).toEqual(
      QUESTION_TOPIC_PAGES.map((topic) => topic.slug).sort(),
    );
  });

  it("builds stable chat URLs for template-driven starts", () => {
    const topic = QUESTION_TOPIC_PAGES[0];
    const useCase = USE_CASE_PAGES[0];

    expect(buildQuestionChatHref(topic)).toBe(
      `/chat/new?templateId=${topic.slug}`,
    );
    expect(buildQuestionChatHref(topic, { ticker: "aapl" })).toContain(
      "ticker=AAPL",
    );
    expect(buildQuestionChatHref(topic, { question: "custom question" })).toBe(
      `/chat/new?templateId=${topic.slug}&query=custom+question`,
    );
    expect(buildQuestionChatHref(topic, { locale: "en" })).toBe(
      `/chat/new?templateId=${topic.slug}&locale=en`,
    );

    const useCaseHref = buildUseCaseChatHref(useCase);
    expect(useCaseHref).toContain(`useCase=${useCase.slug}`);
    expect(useCaseHref).toContain("query=");
    expect(buildUseCaseChatHref(useCase, { locale: "en" })).toContain(
      "locale=en",
    );
  });

  it("builds noindex metadata for non-search utility pages", () => {
    const metadata = pageMetadata({
      title: "질문 그래프",
      path: "/questions",
      noIndex: true,
    });

    expect(metadata.alternates?.canonical).toContain("/questions");
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: false,
    });
  });
});
