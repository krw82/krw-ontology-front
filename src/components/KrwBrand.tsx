import Image from "next/image";
import Link from "next/link";

interface KrwMarkProps {
  className?: string;
}

interface KrwBrandProps {
  href?: string;
  dark?: boolean;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function KrwMark({ className = "h-9 w-9" }: KrwMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden rounded-[8px] ${className}`}
    >
      <Image
        src="/krw-logo.svg"
        alt=""
        fill
        sizes="36px"
        className="object-contain"
        priority={false}
        unoptimized
      />
    </span>
  );
}

export function KrwBrand({
  href = "/",
  dark = false,
  compact = false,
  className = "",
  ariaLabel = "KRW Ontology 홈",
}: KrwBrandProps) {
  return (
    <Link
      href={href}
      className={[
        "group flex min-w-0 items-center gap-3",
        dark ? "text-on-dark" : "text-ink",
        className,
      ].join(" ")}
      aria-label={ariaLabel}
    >
      <KrwMark
        className={compact ? "h-8 w-8 shrink-0" : "h-9 w-9 shrink-0"}
      />
      <span className="flex min-w-0 flex-col justify-center">
        <span className="block whitespace-nowrap text-[15px] font-extrabold leading-[1.32] tracking-[0.06em]">
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
