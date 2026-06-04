import Link from "next/link";
import type { CSSProperties } from "react";
import {
  buildQuestionChatHref,
  type QuestionChainNode,
  type QuestionTopicPage,
} from "@/lib/marketing/site";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

interface QuestionChainGraphProps {
  topic: QuestionTopicPage;
  displayTopic?: QuestionTopicPage;
  locale?: Locale;
}

const graphCopy = {
  ko: {
    answerHint: "분기 기준",
    startQuestion: "질문 시작",
    stages: "단계",
  },
  en: {
    answerHint: "Reference",
    startQuestion: "Start question",
    stages: "stages",
  },
} satisfies Record<Locale, Record<string, string>>;

function formatQuestionCount(count: number, locale: Locale) {
  if (locale === "ko") return `${count}개 질문`;
  return `${count} ${count === 1 ? "question" : "questions"}`;
}

function AnswerHint({ value, locale }: { value?: string; locale: Locale }) {
  if (!value) return null;

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <p className="font-mono text-[10px] font-black uppercase leading-4 tracking-[0.14em] text-muted">
        {graphCopy[locale].answerHint}
      </p>
      <p className="mt-1 text-[12px] font-semibold leading-5 text-muted">
        {value}
      </p>
    </div>
  );
}

function QuestionNode({
  node,
  canonicalNode,
  topic,
  index,
  isEntry,
  locale,
  animationDelay = 0,
}: {
  node: QuestionChainNode;
  canonicalNode?: QuestionChainNode;
  topic: QuestionTopicPage;
  index: number;
  isEntry?: boolean;
  locale: Locale;
  animationDelay?: number;
}) {
  const motionStyle = {
    animationDelay: `${animationDelay}ms`,
  } satisfies CSSProperties;
  const content = (
    <>
      <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
        <span
          className={[
            "border-r border-hairline pr-3 pt-0.5 font-mono text-[11px] font-black leading-5",
            isEntry ? "text-primary" : "text-muted",
          ].join(" ")}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="min-w-0">
          <span
            className={[
              "block text-[14px] font-black leading-5 text-ink",
              isEntry ? "group-hover:text-primary" : "",
            ].join(" ")}
          >
            {node.title}
          </span>
          <span className="mt-1 block text-[12px] font-semibold leading-5 text-body">
            {node.question}
          </span>
          {isEntry && (
            <span className="mt-2 block font-mono text-[10px] font-black uppercase leading-4 tracking-[0.14em] text-muted group-hover:text-primary">
              {graphCopy[locale].startQuestion}
            </span>
          )}
        </span>
      </div>
      <AnswerHint value={node.answerHint} locale={locale} />
    </>
  );

  if (!isEntry) {
    return (
      <div
        className="question-chain-node block rounded-[8px] border border-transparent bg-canvas px-3 py-3"
        style={motionStyle}
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={buildQuestionChatHref(topic, {
        ticker: topic.questionChain.ticker,
        question: canonicalNode?.question ?? node.question,
      })}
      className="question-chain-node question-chain-entry group block rounded-[8px] border border-primary bg-surface px-3 py-3 transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      style={motionStyle}
    >
      {content}
    </Link>
  );
}

export default function QuestionChainGraph({
  topic,
  displayTopic = topic,
  locale = DEFAULT_LOCALE,
}: QuestionChainGraphProps) {
  const chain = topic.questionChain;
  const displayChain = displayTopic.questionChain;
  const totalNodeCount = chain.stages.reduce(
    (sum, stage) => sum + stage.nodes.length,
    0,
  );
  const stageStartIndexes = chain.stages.map((_, stageIndex) =>
    chain.stages
      .slice(0, stageIndex)
      .reduce((sum, stage) => sum + stage.nodes.length, 0),
  );

  return (
    <section
      className="rounded-[8px] border border-hairline bg-canvas p-base sm:p-lg"
      aria-label={`${displayChain.companyName} question chain`}
    >
      <div className="flex flex-col gap-3 border-b border-hairline pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
            {displayChain.ticker} question chain
          </p>
          <h2 className="mt-2 text-[24px] font-black leading-8 text-ink sm:text-[30px]">
            {displayChain.title}
          </h2>
          <p className="mt-3 max-w-3xl text-[14px] font-medium leading-6 text-body sm:text-[15px]">
            {displayChain.description}
          </p>
        </div>
        <p className="font-mono text-[12px] font-black leading-5 text-muted">
          {locale === "ko"
            ? `${chain.stages.length}${graphCopy[locale].stages} · ${formatQuestionCount(totalNodeCount, locale)}`
            : `${chain.stages.length} ${graphCopy[locale].stages} · ${formatQuestionCount(totalNodeCount, locale)}`}
        </p>
      </div>

      <div className="mt-6 hidden lg:block">
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${chain.stages.length}, minmax(0, 1fr))`,
          }}
        >
          {chain.stages.map((stage, stageIndex) => {
            const displayStage = displayChain.stages[stageIndex] ?? stage;

            return (
            <div
              key={stage.id}
              className="question-chain-stage question-chain-stage-desktop relative min-w-0 border-l border-hairline pl-4"
              style={{ animationDelay: `${stageIndex * 90}ms` }}
            >
              <div className="pb-3">
                <p className="font-mono text-[11px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                  {String(stageIndex + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-1 text-[15px] font-black leading-5 text-ink">
                  {displayStage.label}
                </h3>
                <p className="mt-1 text-[12px] font-semibold leading-5 text-muted">
                  {formatQuestionCount(stage.nodes.length, locale)}
                </p>
              </div>
              <div className="space-y-2 border-t border-hairline pt-2">
                {stage.nodes.map((node, index) => {
                  const absoluteIndex = stageStartIndexes[stageIndex] + index;
                  const displayNode = displayStage.nodes[index] ?? node;
                  return (
                    <QuestionNode
                      key={node.id}
                      node={displayNode}
                      canonicalNode={node}
                      topic={topic}
                      index={absoluteIndex}
                      isEntry={stageIndex === 0 && absoluteIndex === 0}
                      locale={locale}
                      animationDelay={120 + stageIndex * 90 + index * 35}
                    />
                  );
                })}
              </div>
            </div>
          );
          })}
        </div>
      </div>

      <div className="mt-6 space-y-6 lg:hidden">
        {chain.stages.map((stage, stageIndex) => {
          const displayStage = displayChain.stages[stageIndex] ?? stage;

          return (
          <div
            key={stage.id}
            className="question-chain-stage"
            style={{ animationDelay: `${stageIndex * 80}ms` }}
          >
            <div className="border-b border-hairline pb-2">
              <p className="font-mono text-[11px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                {String(stageIndex + 1).padStart(2, "0")}
              </p>
              <h3 className="font-mono text-[11px] font-black uppercase leading-5 tracking-[0.14em] text-primary">
                {displayStage.label}
              </h3>
            </div>
            <div className="mt-2 space-y-2">
              {stage.nodes.map((node, index) => {
                const absoluteIndex = stageStartIndexes[stageIndex] + index;
                const displayNode = displayStage.nodes[index] ?? node;
                return (
                  <QuestionNode
                    key={node.id}
                    node={displayNode}
                    canonicalNode={node}
                    topic={topic}
                    index={absoluteIndex}
                    isEntry={stageIndex === 0 && absoluteIndex === 0}
                    locale={locale}
                    animationDelay={100 + stageIndex * 80 + index * 35}
                  />
                );
              })}
            </div>
          </div>
        );
        })}
      </div>
    </section>
  );
}
