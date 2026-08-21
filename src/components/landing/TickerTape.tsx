import type { CSSProperties } from "react";

/**
 * Ambient ticker tape under the hero.
 *
 * Pure-CSS marquee of real large-cap tickers — decoration that keeps the
 * "research desk at work" mood. The track is duplicated once and translated
 * -50% for a seamless loop; reduced-motion pauses the animation (see
 * .home-ticker-tape in globals.css).
 */

const TAPE_ITEMS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA",
  "JPM", "V", "XOM", "UNH", "LLY", "COST", "HD", "MRK",
  "ABBV", "CVX", "PEP", "CRM", "AMD", "NFLX", "INTC", "QCOM",
  "KO", "DIS", "PFE", "T", "BA", "GS", "WMT", "MCD",
] as const;

export function TickerTape() {
  const trackStyle: CSSProperties = {
    animationDuration: "46s",
  };

  return (
    <div
      aria-hidden="true"
      className="relative z-10 mx-auto mt-14 w-full max-w-7xl sm:mt-20"
    >
      <div className="home-ticker-tape relative overflow-hidden py-3 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <div
          className="home-ticker-tape-track flex w-max items-center gap-8 will-change-transform"
          style={trackStyle}
        >
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center gap-8" aria-hidden={copy === 1}>
              {TAPE_ITEMS.map((item, index) => (
                <span
                  key={`${copy}-${index}`}
                  className="inline-flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.14em] text-body/55"
                >
                  <span className="inline-block h-1 w-1 rounded-full bg-body/35" />
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
