"use client";

import { useState } from "react";
import { buildCompanyTickerLogoUrl } from "@/lib/brandfetch-logo";

interface CompanyLogoProps {
  ticker: string;
  companyName: string;
  className?: string;
  imageSize?: number;
}

export default function CompanyLogo({
  ticker,
  companyName,
  className = "h-10 w-10 text-[11px] sm:h-11 sm:w-11",
  imageSize = 96,
}: CompanyLogoProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const logoUrl = buildCompanyTickerLogoUrl(ticker, { size: imageSize });
  const fallbackLabel = ticker.slice(0, 2).toUpperCase();
  const logoSrc = logoUrl && !imageFailed ? logoUrl : undefined;
  const showImage = Boolean(logoSrc);
  const showFallback = !showImage || !imageLoaded;

  return (
    <span
      aria-hidden="true"
      className={[
        "relative grid shrink-0 place-items-center overflow-hidden rounded-[8px] border border-hairline bg-surface font-black leading-none text-muted",
        className,
      ].join(" ")}
    >
      {showFallback && (
        <span className="grid h-full w-full place-items-center" title={companyName}>
          {fallbackLabel}
        </span>
      )}
      {showImage ? (
        /* eslint-disable-next-line @next/next/no-img-element -- Brandfetch Logo API requires direct browser embedding. */
        <img
          src={logoSrc}
          alt=""
          width={imageSize}
          height={imageSize}
          loading="lazy"
          decoding="async"
          referrerPolicy="origin"
          draggable={false}
          className={[
            "absolute inset-0 h-full w-full object-contain p-1 transition-opacity duration-150",
            imageLoaded ? "opacity-100" : "opacity-0",
          ].join(" ")}
          onError={() => setImageFailed(true)}
          onLoad={() => setImageLoaded(true)}
        />
      ) : null}
    </span>
  );
}
