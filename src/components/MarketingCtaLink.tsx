"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { trackClientEventWithTimeout } from "@/lib/analytics/client";

type MarketingCtaLinkProps = ComponentProps<typeof Link> & {
  ctaId: string;
  ctaLabel: string;
  surface: string;
  analyticsProperties?: Record<string, unknown>;
  trackUpgrade?: boolean;
};

export default function MarketingCtaLink({
  ctaId,
  ctaLabel,
  surface,
  analyticsProperties,
  trackUpgrade = false,
  href,
  onClick,
  children,
  ...props
}: MarketingCtaLinkProps) {
  const router = useRouter();

  return (
    <Link
      href={href}
      onClick={(event) => {
        const destination = typeof href === "string" ? href : href.toString();
        onClick?.(event);
        if (event.defaultPrevented) return;

        const shouldNavigateAfterTracking = shouldHandleClientNavigation(
          event,
          props.target,
          destination,
        );
        if (shouldNavigateAfterTracking) {
          event.preventDefault();
        }

        const tracking = trackClientEventWithTimeout("cta_clicked", {
          cta_id: ctaId,
          cta_label: ctaLabel,
          surface,
          source_surface: surface,
          destination,
          ...analyticsProperties,
        });

        const upgradeTracking = trackUpgrade
          ? trackClientEventWithTimeout("upgrade_clicked", {
            cta_id: ctaId,
            cta_label: ctaLabel,
            surface,
            source_surface: surface,
            destination,
            ...analyticsProperties,
          })
          : Promise.resolve();

        if (shouldNavigateAfterTracking) {
          void Promise.all([tracking, upgradeTracking]).finally(() => {
            router.push(destination);
          });
          return;
        }

        void Promise.all([tracking, upgradeTracking]);
      }}
      {...props}
    >
      {children}
    </Link>
  );
}

function shouldHandleClientNavigation(
  event: MouseEvent<HTMLAnchorElement>,
  target: ComponentProps<typeof Link>["target"],
  destination: string,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    (!target || target === "_self") &&
    destination.startsWith("/")
  );
}
