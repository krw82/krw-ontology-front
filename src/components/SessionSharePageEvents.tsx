"use client";

import { useEffect, useRef } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";

interface SessionSharePageEventsProps {
  hasQuestion: boolean;
  tickerCount: number;
}

// Sibling of SharePageEvents, but for /share/s/[token] session share pages.
// Fires its own event names so session vs. message share engagement can be
// distinguished in analytics. Kept as a separate component to preserve the
// "do not modify existing SharePageEvents" constraint.
export default function SessionSharePageEvents({
  hasQuestion,
  tickerCount,
}: SessionSharePageEventsProps) {
  const readMarkerRef = useRef<HTMLSpanElement | null>(null);
  const readTrackedRef = useRef(false);

  useEffect(() => {
    trackClientEventSilently("session_share_viewed", {
      has_question: hasQuestion,
      ticker_count: tickerCount,
    });
  }, [hasQuestion, tickerCount]);

  useEffect(() => {
    const marker = readMarkerRef.current;
    if (!marker) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || readTrackedRef.current) return;
        readTrackedRef.current = true;
        trackClientEventSilently("session_share_answer_read", {
          has_question: hasQuestion,
          ticker_count: tickerCount,
        });
        observer.disconnect();
      },
      { threshold: 1 },
    );

    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasQuestion, tickerCount]);

  return <span ref={readMarkerRef} aria-hidden="true" className="block h-px" />;
}
