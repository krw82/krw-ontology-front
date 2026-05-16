import Link from "next/link";

interface KrwMarkProps {
  className?: string;
  dark?: boolean;
}

interface KrwBrandProps {
  href?: string;
  dark?: boolean;
  compact?: boolean;
  className?: string;
}

export function KrwMark({ className = "h-9 w-9", dark = false }: KrwMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        width="120"
        height="120"
        rx="24"
        fill={dark ? "#16181C" : "#FFFFFF"}
        stroke={dark ? "#303744" : "#DDE1FF"}
        strokeWidth="4"
      />
      <path
        d="M28 28V92"
        stroke={dark ? "#B7C4FF" : "#0052FF"}
        strokeLinecap="round"
        strokeWidth="9"
      />
      <path
        d="M72 29L38 60L78 91"
        stroke={dark ? "#B7C4FF" : "#0052FF"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="9"
      />
      <path
        d="M86 30V90"
        stroke={dark ? "#5F7DFF" : "#B7C4FF"}
        strokeLinecap="round"
        strokeWidth="7"
      />
      <circle cx="86" cy="30" r="5" fill={dark ? "#DDE1FF" : "#0052FF"} />
      <circle cx="86" cy="90" r="5" fill={dark ? "#DDE1FF" : "#0052FF"} />
    </svg>
  );
}

export function KrwBrand({
  href = "/",
  dark = false,
  compact = false,
  className = "",
}: KrwBrandProps) {
  return (
    <Link
      href={href}
      className={[
        "group flex min-w-0 items-center gap-3",
        dark ? "text-on-dark" : "text-ink",
        className,
      ].join(" ")}
      aria-label="KRW Ontology 홈"
    >
      <KrwMark
        dark={dark}
        className={compact ? "h-8 w-8 shrink-0" : "h-9 w-9 shrink-0"}
      />
      <span className="flex min-w-0 flex-col justify-center">
        <span className="block truncate text-[15px] font-extrabold leading-[1.18] tracking-[0.06em]">
          KRW Ontology
        </span>
        {!compact && (
          <span
            className={[
              "mt-[4px] block truncate text-[11px] font-semibold leading-[1.1] tracking-[0.12em]",
              dark ? "text-on-dark-soft" : "text-muted",
            ].join(" ")}
          >
            EVIDENCE GRAPH
          </span>
        )}
      </span>
    </Link>
  );
}
