export type ValuationWorkerCliOptions = {
  once: boolean;
  help: boolean;
  tickers: string[];
};

export function parseValuationWorkerCli(
  argv: readonly string[],
): ValuationWorkerCliOptions {
  let once = false;
  let help = false;
  let tickers: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--once") {
      once = true;
      continue;
    }
    if (argument === "--tickers") {
      const value = argv[index + 1];
      if (!value) throw new Error("--tickers requires a comma-separated value");
      const parsedTickers = parseValuationTickerList(value);
      if (parsedTickers.length === 0) {
        throw new Error("--tickers did not contain a valid ticker");
      }
      tickers = parsedTickers;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown valuation worker argument: ${argument}`);
  }

  return { once, help, tickers };
}

export function parseValuationTickerList(value: string): string[] {
  return [...new Set(
    value
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter((ticker) => /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)),
  )];
}
