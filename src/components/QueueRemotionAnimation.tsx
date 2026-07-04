"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface QueueRemotionAnimationProps {
  className?: string;
  size?: "compact" | "regular";
}

const DURATION_IN_FRAMES = 90;
const FPS = 30;
const WIDTH = 96;
const HEIGHT = 48;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function interpolate(value: number, input: [number, number], output: [number, number]) {
  const ratio = (value - input[0]) / (input[1] - input[0]);
  return output[0] + clamp(ratio, 0, 1) * (output[1] - output[0]);
}

function easedProgress(value: number, input: [number, number, number, number], output: [number, number, number, number]) {
  if (value <= input[0]) {
    return output[0];
  }
  if (value <= input[1]) {
    return interpolate(value, [input[0], input[1]], [output[0], output[1]]);
  }
  if (value <= input[2]) {
    return output[1] + ((value - input[1]) / (input[2] - input[1])) * (output[2] - output[1]);
  }
  if (value >= input[3]) {
    return output[3];
  }
  return output[2] + ((value - input[2]) / (input[3] - input[2])) * (output[3] - output[2]);
}

function linearTravel(frame: number, width: number) {
  const midpointFrame = 45;
  const end = width + 36;

  if (frame <= midpointFrame) {
    const ratio = clamp(frame / midpointFrame, 0, 1);
    return -18 + ratio * ((width - 42) - -18);
  }

  const ratio = clamp((frame - midpointFrame) / (89 - midpointFrame), 0, 1);
  return (width - 42) + ratio * (end - (width - 42));
}

function pulse(frame: number) {
  return clamp(easedProgress(frame, [0, 12, 36, DURATION_IN_FRAMES], [0.34, 1, 0.34, 0.34]), 0.34, 1);
}

function QueueRemotionScene({ frame, compact }: { frame: number; compact: boolean }) {
  const width = compact ? WIDTH * 0.5 : WIDTH;
  const trackWidth = 84;
  const leftOffset = compact ? 0 : (WIDTH - trackWidth) / 2;
  const travel = linearTravel(frame % DURATION_IN_FRAMES, width);

  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "center",
        background: "transparent",
        display: "flex",
        height: compact ? 24 : 30,
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          height: compact ? 20 : 30,
          position: "relative",
          width: trackWidth,
          left: compact ? -10 : 0,
        }}
      >
        {[0, 1, 2].map((index) => {
          const slotFrame = (frame - index * 10 + DURATION_IN_FRAMES) % DURATION_IN_FRAMES;
          const slotPulse = pulse(slotFrame);

          return (
            <div
              key={index}
              style={{
                background: `rgba(0, 82, 255, ${0.12 + slotPulse * 0.12})`,
                border: "1px solid rgba(0, 82, 255, 0.22)",
                borderRadius: compact ? 6 : 8,
                height: compact ? 14 : 20,
                left: index * (compact ? 20 : 28),
                position: "absolute",
                top: compact ? 3 : 5,
                width: compact ? 14 : 20,
              }}
            />
          );
        })}
        <div
          style={{
            background: "#0052ff",
            borderRadius: 999,
            boxShadow: "0 6px 14px rgba(0, 82, 255, 0.28)",
            height: compact ? 6 : 10,
            left: leftOffset + travel,
            opacity: clamp(easedProgress(frame % DURATION_IN_FRAMES, [0, 10, 66, 89], [0, 1, 1, 0]), 0, 1),
            position: "absolute",
            top: compact ? 7 : 10,
            width: compact ? 6 : 10,
          }}
        />
      </div>
    </span>
  );
}

function StaticQueueGlyph({ size }: { size: "compact" | "regular" }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex items-center justify-center gap-1",
        size === "compact" ? "h-5 w-8" : "h-8 w-12",
      ].join(" ")}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-2 w-2 rounded-[4px] bg-primary-container/45"
        />
      ))}
    </span>
  );
}

export default function QueueRemotionAnimation({
  className,
  size = "regular",
}: QueueRemotionAnimationProps) {
  const reducedMotion = useReducedMotion();
  const width = size === "compact" ? 48 : WIDTH;
  const height = size === "compact" ? 24 : HEIGHT;
  const [frame, setFrame] = useState(0);
  const compact = size === "compact";

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % DURATION_IN_FRAMES);
    }, 1000 / FPS);

    return () => clearInterval(timer);
  }, []);

  if (reducedMotion) {
    return (
      <span className={className} data-testid="queue-remotion-animation">
        <StaticQueueGlyph size={size} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={["inline-flex shrink-0 items-center justify-center", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="queue-remotion-animation"
      style={{ height, width }}
    >
      <QueueRemotionScene frame={frame} compact={compact} />
    </span>
  );
}
