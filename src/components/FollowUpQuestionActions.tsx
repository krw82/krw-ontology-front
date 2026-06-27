"use client";

import { motion } from "motion/react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { cn } from "@/lib/utils";

interface FollowUpQuestionActionsProps {
  questions: readonly string[];
  disabled?: boolean;
  className?: string;
  onSelect: (question: string) => void;
}

export default function FollowUpQuestionActions({
  questions,
  disabled = false,
  className,
  onSelect,
}: FollowUpQuestionActionsProps) {
  if (questions.length === 0) return null;

  return (
    <section
      className={cn(
        "mt-lg border-t border-hairline pt-sm",
        className,
      )}
      aria-label="이어서 볼 질문"
    >
      <p className="text-[12px] font-extrabold leading-5 text-muted">
        이어서 볼 질문
      </p>
      <div className="mt-1 space-y-0.5">
        {questions.map((question, index) => (
          <motion.button
            key={`${index}-${question}`}
            type="button"
            className="group flex w-full items-start gap-3 rounded-[8px] px-2 py-2 text-left text-[14px] font-semibold leading-6 text-body transition-colors hover:bg-surface-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.18,
              delay: index * 0.03,
              ease: "easeOut",
            }}
            disabled={disabled}
            onClick={() => {
              trackClientEventSilently("suggested_question_clicked", {
                source_surface: "assistant_follow_up",
                prompt_id: `assistant_follow_up_${index + 1}`,
                prompt_rank: index + 1,
                prompt_category: "follow_up",
                prompt_length: question.length,
              });
              onSelect(question);
            }}
          >
            <span className="shrink-0 font-mono text-[12px] font-bold leading-6 text-muted-soft">
              {index + 1}.
            </span>
            <span className="min-w-0 flex-1">{question}</span>
            <span
              aria-hidden="true"
              className="material-symbols-outlined mt-0.5 shrink-0 text-[17px] text-muted opacity-55 transition-[color,opacity,transform] group-hover:translate-x-0.5 group-hover:text-ink group-hover:opacity-100"
            >
              arrow_forward
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
