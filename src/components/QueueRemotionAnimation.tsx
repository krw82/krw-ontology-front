"use client";

import { Player } from "@remotion/player";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface QueueRemotionAnimationProps {
  className?: string;
  size?: "compact" | "regular";
}

const DURATION_IN_FRAMES = 90;
const FPS = 30;
const WIDTH = 96;
const HEIGHT = 48;

function QueueRemotionScene() {
  const frame = useCurrentFrame() % DURATION_IN_FRAMES;
  const travel = interpolate(frame, [0, 45, 89], [-18, 54, 126], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const runnerOpacity = interpolate(
    frame,
    [0, 10, 66, 89],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        background: "transparent",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          height: 30,
          position: "relative",
          width: 84,
        }}
      >
        {[0, 1, 2].map((index) => {
          const slotFrame = (frame - index * 10 + DURATION_IN_FRAMES) %
            DURATION_IN_FRAMES;
          const pulse = interpolate(
            slotFrame,
            [0, 16, 32, DURATION_IN_FRAMES],
            [0.42, 1, 0.42, 0.42],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          return (
            <div
              key={index}
              style={{
                background: `rgba(0, 82, 255, ${0.12 + pulse * 0.1})`,
                border: "1px solid rgba(0, 82, 255, 0.22)",
                borderRadius: 8,
                height: 20,
                left: index * 28,
                position: "absolute",
                top: 5,
                width: 20,
              }}
            />
          );
        })}
        <div
          style={{
            background: "#0052ff",
            borderRadius: 999,
            boxShadow: "0 6px 14px rgba(0, 82, 255, 0.28)",
            height: 10,
            left: travel,
            opacity: runnerOpacity,
            position: "absolute",
            top: 10,
            width: 10,
          }}
        />
      </div>
    </AbsoluteFill>
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
      <Player
        acknowledgeRemotionLicense
        autoPlay
        clickToPlay={false}
        component={QueueRemotionScene}
        compositionHeight={HEIGHT}
        compositionWidth={WIDTH}
        controls={false}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        initiallyMuted
        loop
        spaceKeyToPlayOrPause={false}
        style={{
          height,
          pointerEvents: "none",
          width,
        }}
      />
    </span>
  );
}
