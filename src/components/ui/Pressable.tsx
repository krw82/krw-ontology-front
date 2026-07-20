"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import styles from "./Pressable.module.css";

type PressableHoverEffect = "none" | "surface" | "primary-border";

export interface PressableProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  hoverEffect?: PressableHoverEffect;
}

const hoverEffectClassNames: Record<PressableHoverEffect, string | undefined> = {
  none: undefined,
  surface: styles.hoverSurface,
  "primary-border": styles.hoverPrimaryBorder,
};

export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(
  function Pressable(
    {
      className,
      hoverEffect = "none",
      type = "button",
      ...buttonProps
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          styles.root,
          hoverEffectClassNames[hoverEffect],
          className,
        )}
        {...buttonProps}
      />
    );
  },
);

Pressable.displayName = "Pressable";
