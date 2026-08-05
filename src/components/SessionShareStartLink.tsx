"use client";

import Link from "next/link";
import { trackClientEventSilently } from "@/lib/analytics/client";

interface SessionShareStartLinkProps {
  href: string;
  // Broader than ShareStartLink's "header" | "bottom": session share pages
  // report location="session_share" so analytics can distinguish the source.
  location: string;
  hasQuestion: boolean;
  className: string;
  children: React.ReactNode;
}

// Sibling of ShareStartLink, but for /share/s/[token] session share pages.
// Fires its own `session_share_cta_clicked` event. Kept as a separate
// component to preserve the "do not modify existing ShareStartLink" constraint.
export default function SessionShareStartLink({
  href,
  location,
  hasQuestion,
  className,
  children,
}: SessionShareStartLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        trackClientEventSilently("session_share_cta_clicked", {
          location,
          has_question: hasQuestion,
        });
      }}
    >
      {children}
    </Link>
  );
}
