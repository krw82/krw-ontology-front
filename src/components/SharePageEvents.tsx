"use client";

import { useEffect, useRef } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";

interface SharePageEventsProps {
  hasQuestion: boolean;
  tickerCount: number;
}

export default function SharePageEvents({
  hasQuestion,
  tickerCount,
}: SharePageEventsProps) {
  const readMarkerRef = useRef<HTMLSpanElement | null>(null);
  const readTrackedRef = useRef(false);

  useEffect(() => {
    trackClientEventSilently("share_viewed", {
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
        trackClientEventSilently("share_answer_read", {
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
