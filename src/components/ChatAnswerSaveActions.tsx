"use client";

import { useCallback, useState } from "react";

export interface ChatAnswerSaveContext {
  ticker: string;
  sessionId: string;
}

type AnswerSaveTarget = "note" | "card" | "thesis";
type AnswerSaveState = "idle" | "saving" | "saved" | "failed";

const ANSWER_SAVE_ACTIONS: Array<{
  target: AnswerSaveTarget;
  label: string;
  shortLabel: string;
  icon: string;
}> = [
  {
    target: "note",
    label: "리서치 노트로 저장",
    shortLabel: "노트",
    icon: "note_add",
  },
  {
    target: "card",
    label: "종목 카드로 저장",
    shortLabel: "종목 카드",
    icon: "id_card",
  },
  {
    target: "thesis",
    label: "Thesis로 저장",
    shortLabel: "Thesis",
    icon: "fact_check",
  },
];

async function saveAssistantAnswer({
  target,
  ticker,
  sessionId,
  messageId,
  content,
}: {
  target: AnswerSaveTarget;
  ticker: string;
  sessionId: string;
  messageId: string;
  content: string;
}): Promise<void> {
  const encodedTicker = encodeURIComponent(ticker);
  const request =
    target === "note"
      ? {
          url: `/api/watchlist/${encodedTicker}/notes`,
          method: "POST",
          body: {
            title: `${ticker} 채팅 요약`,
            body: content,
            note_type: "chat_summary",
            tags: ["chat"],
            source_chat_session_id: sessionId,
            source_message_id: messageId,
          },
        }
      : target === "card"
        ? {
            url: `/api/watchlist/${encodedTicker}/card`,
            method: "PUT",
            body: {
              title: `${ticker} 종목 카드`,
              content_md: content,
              source_chat_session_id: sessionId,
              source_message_id: messageId,
            },
          }
        : {
            url: `/api/watchlist/${encodedTicker}/theses`,
            method: "POST",
            body: {
              title: `${ticker} 채팅 기반 Thesis`,
              thesis_text: content,
              status: "needs_review",
              tags: ["chat"],
              source_chat_session_id: sessionId,
              source_message_id: messageId,
            },
          };

  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request.body),
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
  const [states, setStates] = useState<
    Record<AnswerSaveTarget, AnswerSaveState>
  >({
    note: "idle",
    card: "idle",
    thesis: "idle",
  });
  const [feedback, setFeedback] = useState("");

  const handleSave = useCallback(
    async (target: AnswerSaveTarget) => {
      if (states[target] === "saving" || states[target] === "saved") return;

      setStates((current) => ({ ...current, [target]: "saving" }));
      setFeedback("");

      try {
        await saveAssistantAnswer({
          target,
          ticker: saveContext.ticker,
          sessionId: saveContext.sessionId,
          messageId,
          content,
        });
        setStates((current) => ({ ...current, [target]: "saved" }));
        const action = ANSWER_SAVE_ACTIONS.find((item) => item.target === target);
        setFeedback(`${action?.shortLabel ?? "답변"} 저장 완료`);
      } catch (error) {
        setStates((current) => ({ ...current, [target]: "failed" }));
        setFeedback(
          error instanceof Error ? error.message : "답변을 저장하지 못했습니다.",
        );
      }
    },
    [content, messageId, saveContext, states],
  );

  return (
    <>
      {ANSWER_SAVE_ACTIONS.map((action) => {
        const state = states[action.target];
        const isSaving = state === "saving";
        return (
          <button
            key={action.target}
            type="button"
            className="inline-flex min-h-8 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-2 text-[12px] font-bold text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
            aria-label={action.label}
            disabled={isSaving || state === "saved"}
            onClick={() => void handleSave(action.target)}
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
                  : action.icon}
            </span>
            <span>{action.shortLabel}</span>
          </button>
        );
      })}
      <span
        aria-live="polite"
        className={[
          "min-w-0 text-[12px] leading-none",
          Object.values(states).some((state) => state === "failed")
            ? "text-error"
            : "text-muted",
        ].join(" ")}
      >
        {feedback}
      </span>
    </>
  );
}
