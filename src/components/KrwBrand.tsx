import Link from "next/link";

interface KrwMarkProps {
  className?: string;
}

interface KrwBrandProps {
  href?: string;
  dark?: boolean;
  compact?: boolean;
  className?: string;
}

export function KrwMark({ className = "h-9 w-9" }: KrwMarkProps) {
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
        fill="#0B1020"
      />
      <path
        d="M28 28V92"
        stroke="#F3EEE4"
        strokeLinecap="round"
        strokeWidth="9"
      />
      <path
        d="M72 29L38 60L78 91"
        stroke="#F3EEE4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="9"
      />
      <path
        d="M86 30V90"
        stroke="#B8792E"
        strokeLinecap="round"
        strokeWidth="7"
      />
      <circle cx="86" cy="30" r="5" fill="#E6C98D" />
      <circle cx="86" cy="90" r="5" fill="#E6C98D" />
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
        dark ? "text-stone-50" : "text-ink",
        className,
      ].join(" ")}
      aria-label="KRW Ontology 홈"
    >
      <KrwMark className={compact ? "h-8 w-8 shrink-0" : "h-9 w-9 shrink-0"} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-extrabold leading-none tracking-[0.06em]">
          KRW Ontology
        </span>
        {!compact && (
          <span
            className={[
              "mt-[5px] block truncate text-[11px] font-semibold leading-none tracking-[0.12em]",
              dark ? "text-stone-400" : "text-muted",
            ].join(" ")}
          >
            EVIDENCE GRAPH
          </span>
        )}
      </span>
    </Link>
  );
}
