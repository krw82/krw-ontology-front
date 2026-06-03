"use client";

import Link from "next/link";
import { trackClientEventSilently } from "@/lib/analytics/client";

interface ShareStartLinkProps {
  href: string;
  location: "header" | "bottom";
  hasQuestion: boolean;
  className: string;
  children: React.ReactNode;
}

export default function ShareStartLink({
  href,
  location,
  hasQuestion,
  className,
  children,
}: ShareStartLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        trackClientEventSilently("share_cta_clicked", {
          location,
          has_question: hasQuestion,
        });
      }}
    >
      {children}
    </Link>
  );
}
