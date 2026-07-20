"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { cn } from "@/lib/utils";

const promptCycleIntervalMs = 2200;
const MotionLink = motion.create(Link);

interface SuggestedPromptActionsProps {
  prompts: readonly string[];
  groupId: string;
  className?: string;
  disabled?: boolean;
  hrefs?: readonly string[];
  analytics?: {
    promptCategory?: string;
    promptIds?: readonly string[];
    sourceSurface: string;
    ticker?: string | null;
    tickers?: readonly string[];
  };
  onSelect?: (prompt: string) => void;
}

function PromptContent({
  index,
  prompt,
  isActive,
}: {
  index: number;
  prompt: string;
  isActive: boolean;
}) {
  return (
    <>
      {isActive && (
        <motion.span
          layoutId="empty-state-prompt-active"
          aria-hidden="true"
          className="absolute inset-0 rounded-[8px] bg-surface"
          transition={{
            duration: 0.36,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      )}
      <span className="relative z-10 shrink-0 font-mono text-[12px] font-bold leading-6 text-muted-soft">
        {index + 1}.
      </span>
      <span className="relative z-10 min-w-0 flex-1">{prompt}</span>
      <AnimatePresence initial={false} mode="popLayout">
        {isActive && (
          <motion.span
            key="active-prompt-arrow"
            layoutId="empty-state-prompt-arrow"
            aria-hidden="true"
            className="material-symbols-outlined relative z-10 shrink-0 text-[18px] text-muted transition-colors group-hover:text-ink"
            initial={{ opacity: 0, x: -3 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 3 }}
            transition={{
              duration: 0.22,
              ease: "easeOut",
            }}
          >
            arrow_forward
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

export default function SuggestedPromptActions({
  prompts,
  groupId,
  className,
  disabled = false,
  hrefs,
  analytics,
  onSelect,
}: SuggestedPromptActionsProps) {
  const [rawActivePromptIndex, setRawActivePromptIndex] = useState(0);
  const activePromptIndex =
    prompts.length > 0 ? rawActivePromptIndex % prompts.length : 0;

  useEffect(() => {
    if (disabled || prompts.length === 0) return;

    const timeoutId = window.setTimeout(() => {
      setRawActivePromptIndex(
        (currentIndex) => (currentIndex + 1) % prompts.length,
      );
    }, promptCycleIntervalMs);

    return () => window.clearTimeout(timeoutId);
  }, [activePromptIndex, disabled, prompts.length]);

  if (prompts.length === 0) return null;

  const itemClassName =
    "group relative flex w-full items-center gap-3 overflow-hidden rounded-[8px] border border-transparent px-3 py-2.5 text-left text-[14px] font-semibold leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

  const trackPromptClick = (prompt: string, index: number): void => {
    if (!analytics) return;
    trackClientEventSilently("suggested_question_clicked", {
      source_surface: analytics.sourceSurface,
      ticker: analytics.ticker ?? analytics.tickers?.[0] ?? null,
      tickers: analytics.tickers ?? (analytics.ticker ? [analytics.ticker] : []),
      prompt_id: analytics.promptIds?.[index] ?? `${groupId}_${index + 1}`,
      prompt_rank: index + 1,
      prompt_category: analytics.promptCategory ?? null,
      prompt_length: prompt.length,
    });
  };

  return (
    <div className={cn("space-y-1", className)}>
      <LayoutGroup id={groupId}>
        {prompts.map((prompt, index) => {
          const isActivePrompt = index === activePromptIndex;
          const href = hrefs?.[index];
          const sharedProps = {
            layout: true,
            className: cn(
              itemClassName,
              isActivePrompt
                ? "border-hairline text-ink"
                : "text-body hover:border-hairline-soft hover:bg-surface-soft hover:text-ink",
            ),
            onFocus: () => setRawActivePromptIndex(index),
            onMouseEnter: () => setRawActivePromptIndex(index),
            initial: { opacity: 0, y: 6 },
            animate: { opacity: 1, y: 0 },
            transition: {
              duration: 0.2,
              delay: 0.1 + index * 0.04,
              ease: "easeOut" as const,
            },
          };

          if (href) {
            return (
              <MotionLink
                key={prompt}
                {...sharedProps}
                href={href}
                aria-disabled={disabled}
                onClick={(event) => {
                  if (disabled) {
                    event.preventDefault();
                    return;
                  }
                  trackPromptClick(prompt, index);
                  onSelect?.(prompt);
                }}
              >
                <PromptContent
                  index={index}
                  prompt={prompt}
                  isActive={isActivePrompt}
                />
              </MotionLink>
            );
          }

          return (
            <motion.button
              type="button"
              key={prompt}
              {...sharedProps}
              onClick={() => {
                trackPromptClick(prompt, index);
                onSelect?.(prompt);
              }}
              disabled={disabled}
            >
              <PromptContent
                index={index}
                prompt={prompt}
                isActive={isActivePrompt}
              />
            </motion.button>
          );
        })}
      </LayoutGroup>
    </div>
  );
}
