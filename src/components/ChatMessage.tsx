"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StreamingCitation } from "@/types/api-contracts";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  citations?: StreamingCitation[];
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 pl-[48px]">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-muted rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 bg-muted rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 bg-muted rounded-full animate-bounce" />
      </div>
    </div>
  );
}

export default function ChatMessage({
  role,
  content,
  isStreaming,
  citations,
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex flex-col items-end w-full">
        <div className="max-w-[80%] bg-surface-soft text-ink p-lg rounded-xl rounded-tr-sm border border-hairline">
          <p className="text-[16px] leading-[1.5] font-normal">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full">
      <div className="flex items-start gap-md mb-sm">
        <div className="w-8 h-8 rounded-full bg-primary-container text-primary flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-[18px]">
            auto_awesome
          </span>
        </div>
        <h2 className="text-[18px] leading-[1.33] font-semibold text-ink mt-1 font-normal">
          Ontology Intelligence
        </h2>
      </div>
      {isStreaming && !content ? (
        <LoadingDots />
      ) : (
        <div className="pl-[48px] max-w-[90%] text-body text-[16px] leading-[1.5] space-y-md">
          {content && (
            <div className="prose prose-sm max-w-none text-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          )}
          {isStreaming && <LoadingDots />}

          {/* L-08: Citations rendering */}
          {citations && citations.length > 0 && !isStreaming && (
            <div className="mt-md border-t border-hairline pt-md">
              <p className="text-[14px] leading-[1.4] font-semibold text-muted mb-sm">
                참고 자료
              </p>
              <ul className="space-y-xs">
                {citations.map((citation, i) => {
                  const label = citation.ticker
                    ? `${citation.ticker} - ${citation.document_type || "문서"}`
                    : citation.document_type || `출처 ${i + 1}`;
                  const detail = citation.period || citation.section || "";
                  return (
                    <li key={i} className="text-[14px] leading-[1.4] text-muted">
                      <span className="font-medium text-body">{label}</span>
                      {detail && <span className="ml-xs">({detail})</span>}
                      {citation.quote_text && (
                        <span className="ml-xs">
                          {citation.quote_text.length > 80
                            ? `"${citation.quote_text.slice(0, 80)}..."`
                            : `"${citation.quote_text}"`}
                        </span>
                      )}
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
