"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import RichAnswerRenderer from "@/components/RichAnswerRenderer";
import type {
  ChatCitation,
  ResearchActivityUpdate,
  ResearchArtifact,
} from "@/types/api-contracts";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  activity?: ResearchActivityUpdate | null;
  citations?: ChatCitation[];
  richAnswers?: ResearchArtifact[];
}

const ACTIVITY_STEPS: Array<{
  stage: ResearchActivityUpdate["stage"];
  label: string;
}> = [
  { stage: "connecting", label: "자료 연결" },
  { stage: "researching", label: "근거 확인" },
  { stage: "checking_evidence", label: "근거 정리" },
  { stage: "composing", label: "답변 구성" },
];

function stageRank(stage: ResearchActivityUpdate["stage"]): number {
  if (stage === "preparing") return 0;
  if (stage === "complete") return ACTIVITY_STEPS.length + 1;
  const index = ACTIVITY_STEPS.findIndex((step) => step.stage === stage);
  return index === -1 ? 0 : index + 1;
}

function LoadingDots({ label = "분석 준비 중" }: { label?: string }) {
  return (
    <div className="flex items-center gap-xs text-[14px] leading-[1.4] text-muted">
      <div className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted" />
      </div>
      <span>{label}</span>
    </div>
  );
}

function ResearchStatusCard({
  activity,
}: {
  activity?: ResearchActivityUpdate | null;
}) {
  const current = activity ?? {
    stage: "preparing" as const,
    label: "분석 준비 중",
  };
  const currentRank = stageRank(current.stage);

  return (
    <div
      className="w-full rounded-[8px] border border-hairline bg-surface p-base shadow-sm sm:max-w-[560px] sm:p-lg"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-center gap-sm">
        <span className="material-symbols-outlined shrink-0 text-[20px] text-primary">
          progress_activity
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium leading-[1.4] text-ink sm:text-[16px]">
            분석 중 · {current.label}
          </p>
          <div className="mt-xs sm:hidden">
            <LoadingDots label={current.label} />
          </div>
        </div>
      </div>

      <div className="mt-base hidden grid-cols-4 gap-xs sm:grid">
        {ACTIVITY_STEPS.map((step, index) => {
          const rank = index + 1;
          const isDone = currentRank > rank;
          const isActive = current.stage === step.stage;
          return (
            <div
              key={step.stage}
              className="min-w-0 rounded-[8px] border border-hairline bg-canvas/70 px-sm py-xs"
            >
              <div className="flex min-w-0 items-center gap-xs">
                <span
                  className={[
                    "h-2 w-2 shrink-0 rounded-full",
                    isDone
                      ? "bg-primary"
                      : isActive
                        ? "animate-pulse bg-primary"
                        : "bg-hairline-soft",
                  ].join(" ")}
                />
                <span
                  className={[
                    "truncate text-[13px] leading-[1.4]",
                    isDone || isActive ? "text-body" : "text-muted",
                  ].join(" ")}
                >
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ChatMessage({
  role,
  content,
  isStreaming,
  activity,
  citations,
  richAnswers,
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex w-full flex-col items-end">
        <div className="max-w-[92%] rounded-[8px] border border-hairline bg-surface p-base text-ink sm:max-w-[80%] sm:p-lg">
          <p className="whitespace-pre-wrap break-words text-[15px] font-normal leading-[1.5] sm:text-[16px]">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col">
      <div className="mb-sm flex items-start gap-sm sm:gap-md">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] bg-surface-dark text-accent-yellow">
          <span className="material-symbols-outlined text-[18px]">
            account_tree
          </span>
        </div>
        <h2 className="mt-1 text-[17px] font-bold leading-[1.33] text-ink sm:text-[18px]">
          Evidence Engine
        </h2>
      </div>
      {isStreaming ? (
        <div className="pl-0 sm:pl-[48px]">
          <ResearchStatusCard activity={activity} />
        </div>
      ) : (
        <div className="max-w-full space-y-md break-words pl-0 text-[15px] leading-[1.5] text-body sm:max-w-[90%] sm:pl-[48px] sm:text-[16px]">
          {richAnswers && richAnswers.length > 0 && !isStreaming ? (
            <div className="space-y-lg">
              {richAnswers.map((answer) => (
                <RichAnswerRenderer
                  key={answer.id}
                  answer={answer}
                  fallbackMarkdown={content}
                />
              ))}
            </div>
          ) : content ? (
            <div className="prose prose-sm max-w-none text-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : null}
          {isStreaming && <LoadingDots />}

          {/* L-08: Citations rendering */}
          {citations && citations.length > 0 && !isStreaming && (
            <div className="mt-md border-t border-hairline pt-md">
              <p className="mb-sm text-[14px] font-semibold leading-[1.4] text-muted">
                참고 자료
              </p>
              <ul className="space-y-xs">
                {citations.map((citation, i) => {
                  const label = citation.ticker
                    ? `${citation.ticker} - ${citation.document_type || "문서"}`
                    : citation.document_type || `출처 ${i + 1}`;
                  const detail = citation.period || citation.section || "";
                  return (
                    <li key={i} className="break-words text-[14px] leading-[1.4] text-muted">
                      <span className="font-medium text-body">{label}</span>
                      {detail && <span className="ml-xs">({detail})</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
