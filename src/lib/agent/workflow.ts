export const KRW_ONTOLOGY_RESEARCH_SKILL =
  "/krw-ontology:krw-ontology-research";

export const KRW_ONTOLOGY_ANSWER_COMPOSER_SKILL =
  "/krw-ontology:krw-ontology-answer-composer";

export interface ComposerPassInput {
  question: string;
  research_synthesis: unknown;
  runtime: {
    supports_structured_output: true;
    language: string;
  };
}

export function buildResearchPassPrompt(userMessage: string): string {
  return `${KRW_ONTOLOGY_RESEARCH_SKILL} ${userMessage}`;
}

export function buildComposerPassPrompt(input: ComposerPassInput): string {
  return `${KRW_ONTOLOGY_ANSWER_COMPOSER_SKILL} ${JSON.stringify(input)}`;
}
