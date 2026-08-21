import type { CSSProperties } from "react";

/**
 * Ambient ticker · filing tape under the hero.
 *
 * Pure-CSS marquee of real large-cap tickers interleaved with SEC filing
 * types — decoration that keeps the "research desk at work" mood. The track
 * is duplicated once and translated -50% for a seamless loop; reduced-motion
 * pauses the animation (see .home-ticker-tape in globals.css).
 */

const TAPE_ITEMS = [
  "AAPL", "10-K", "MSFT", "10-Q", "NVDA", "8-K", "GOOGL", "10-K",
  "AMZN", "10-Q", "META", "8-K", "AVGO", "10-K", "TSLA", "10-Q",
  "JPM", "8-K", "XOM", "10-K", "LLY", "10-Q", "COST", "8-K",
  "ABBV", "10-K", "CVX", "10-Q", "CRM", "8-K", "AMD", "10-K",
] as const;

function isFilingTag(item: string): boolean {
  return /^(10-K|10-Q|8-K)$/.test(item);
}

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
              {TAPE_ITEMS.map((item, index) => {
                const filing = isFilingTag(item);
                return (
                  <span
                    key={`${copy}-${index}`}
                    className={
                      filing
                        ? "inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary/45"
                        : "inline-flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.14em] text-body/55"
                    }
                  >
                    <span
                      className={
                        filing
                          ? "inline-block h-1 w-1 rounded-full bg-primary/50"
                          : "inline-block h-1 w-1 rounded-full bg-body/35"
                      }
                    />
                    {item}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
