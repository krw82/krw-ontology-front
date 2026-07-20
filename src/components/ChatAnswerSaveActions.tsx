"use client";

import { useCallback, useState } from "react";
import { signalPwaInstallEngagement } from "@/components/pwa/lifecycle";

export interface ChatAnswerSaveContext {
  ticker: string;
  sessionId: string;
}

type AnswerSaveState = "idle" | "saving" | "saved" | "failed";

async function saveAssistantAnswer({
  ticker,
  sessionId,
  messageId,
  content,
}: {
  ticker: string;
  sessionId: string;
  messageId: string;
  content: string;
}): Promise<void> {
  const encodedTicker = encodeURIComponent(ticker);
  const response = await fetch(`/api/watchlist/${encodedTicker}/notes`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `${ticker} 채팅 요약`,
      body: content,
      note_type: "chat_summary",
      tags: ["chat", "coverage"],
      source_chat_session_id: sessionId,
      source_message_id: messageId,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message || "답변을 저장하지 못했습니다.");
  }
}

export default function ChatAnswerSaveActions({
  messageId,
  content,
  saveContext,
}: {
  messageId: string;
  content: string;
  saveContext: ChatAnswerSaveContext;
}) {
  const [state, setState] = useState<AnswerSaveState>("idle");
  const [feedback, setFeedback] = useState("");

  const handleSave = useCallback(
    async () => {
      if (state === "saving" || state === "saved") return;

      setState("saving");
      setFeedback("");

      try {
        await saveAssistantAnswer({
          ticker: saveContext.ticker,
          sessionId: saveContext.sessionId,
          messageId,
          content,
        });
        setState("saved");
        signalPwaInstallEngagement("research_saved", "chat_answer_actions");
        setFeedback("커버리지에 저장했습니다.");
      } catch (error) {
        setState("failed");
        setFeedback(
          error instanceof Error ? error.message : "답변을 저장하지 못했습니다.",
        );
      }
    },
    [content, messageId, saveContext, state],
  );

  const isSaving = state === "saving";
  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[8px] border border-hairline bg-canvas px-3 text-[12px] font-bold text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
        aria-label="이 답변을 기업 커버리지에 저장"
        disabled={isSaving || state === "saved"}
        onClick={() => void handleSave()}
      >
        <span
          aria-hidden="true"
          className={[
            "material-symbols-outlined text-[16px]",
            isSaving ? "animate-spin" : "",
          ].join(" ")}
        >
          {state === "saved"
            ? "check"
            : isSaving
              ? "progress_activity"
              : "bookmark_add"}
        </span>
        <span>{state === "saved" ? "커버리지에 저장됨" : "커버리지에 저장"}</span>
      </button>
      <span
        aria-live="polite"
        className={[
          "min-w-0 text-[12px] leading-none",
          state === "failed" ? "text-error" : "text-muted",
        ].join(" ")}
      >
        {feedback}
      </span>
    </>
  );
}
