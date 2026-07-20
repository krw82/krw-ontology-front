"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";

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
  return (
    <Link
      href={href}
      onClick={(event) => {
        const destination = typeof href === "string" ? href : href.toString();
        onClick?.(event);
        if (event.defaultPrevented) return;

        trackClientEventSilently("cta_clicked", {
          cta_id: ctaId,
          cta_label: ctaLabel,
          surface,
          source_surface: surface,
          destination,
          ...analyticsProperties,
        });

        if (trackUpgrade) {
          trackClientEventSilently("upgrade_clicked", {
            cta_id: ctaId,
            cta_label: ctaLabel,
            surface,
            source_surface: surface,
            destination,
            ...analyticsProperties,
          });
        }
      }}
      {...props}
    >
      {children}
    </Link>
  );
}
