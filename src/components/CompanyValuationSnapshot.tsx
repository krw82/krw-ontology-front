import type { Locale } from "@/i18n/config";
import type { ValuationSnapshotRow } from "@/lib/valuation/repository";

type CompanyValuationSnapshotProps = {
  locale: Locale;
  valuation: ValuationSnapshotRow | null;
};

type MetricExplanation = {
  label: string;
  description: string;
};

type Copy = {
  eyebrow: string;
  heading: string;
  eps: string;
  per: string;
  pbr: string;
  fcfYield: string;
  notMeaningful: string;
  insufficientData: string;
  reasonNegativeEarnings: string;
  reasonNegativeEquity: string;
  reasonCurrencyMismatch: string;
  reasonInsufficientData: string;
  marketCap: string;
  explanationAction: string;
  explanations: {
    marketCap: MetricExplanation;
    eps: MetricExplanation;
    per: MetricExplanation;
    pbr: MetricExplanation;
    fcfYield: MetricExplanation;
  };
};

function buildCopy(locale: Locale): Copy {
  if (locale === "ko") {
    return {
      eyebrow: "시장 평가",
      heading: "현재 가치평가 스냅샷",
      eps: "희석 EPS TTM",
      per: "PER TTM",
      pbr: "PBR",
      fcfYield: "FCF 수익률",
      notMeaningful: "의미 없음",
      insufficientData: "데이터 부족",
      reasonNegativeEarnings: "최근 12개월 적자",
      reasonNegativeEquity: "자본잠식",
      reasonCurrencyMismatch: "통화 불일치",
      reasonInsufficientData: "데이터 부족",
      marketCap: "시가총액",
      explanationAction: "설명 보기",
      explanations: {
        marketCap: {
          label: "시가총액",
          description:
            "회사가 시장에서 전체적으로 얼마로 평가되는지 보여줘요. 클수록 시장이 더 큰 기업으로 보고 있다는 뜻이에요.",
        },
        eps: {
          label: "희석 EPS TTM",
          description:
            "최근 1년 동안 주식 1주당 얼마나 벌었는지 보여줘요. 높을수록 주주 한 주에 돌아가는 이익이 큰 편이에요.",
        },
        per: {
          label: "PER TTM",
          description:
            "현재 주가가 회사의 이익에 비해 비싼지 가늠하는 데 도움을 줘요. 높으면 성장 기대나 가격 부담이 클 수 있어요.",
        },
        pbr: {
          label: "PBR",
          description:
            "회사가 가진 순자산에 비해 시장의 기대가 얼마나 큰지 보여줘요. 높으면 자산보다 성장 기대를 더 많이 반영했을 수 있어요.",
        },
        fcfYield: {
          label: "FCF 수익률",
          description:
            "회사가 실제로 만들어내는 현금에 비해 주가가 얼마나 효율적인지 보여줘요. 높을수록 주가 대비 현금 창출력이 좋은 편일 수 있어요.",
        },
      },
    };
  }
  return {
    eyebrow: "Market valuation",
    heading: "Current valuation snapshot",
    eps: "Diluted EPS TTM",
    per: "P/E TTM",
    pbr: "P/B",
    fcfYield: "FCF yield",
    notMeaningful: "N.M.",
    insufficientData: "n/a",
    reasonNegativeEarnings: "trailing loss",
    reasonNegativeEquity: "negative equity",
    reasonCurrencyMismatch: "currency mismatch",
    reasonInsufficientData: "insufficient data",
    marketCap: "Market cap",
    explanationAction: "view explanation",
    explanations: {
      marketCap: {
        label: "Market cap",
        description:
          "Shows how much the market values the whole company. A larger number usually means the company is viewed as a larger business.",
      },
      eps: {
        label: "Diluted EPS TTM",
        description:
          "Shows how much the company earned for each share over the past year. Higher usually means more earnings are attributed to each share.",
      },
      per: {
        label: "P/E TTM",
        description:
          "Helps you judge whether the current price is high compared with the company’s earnings. A high value can reflect strong growth expectations or a higher price burden.",
      },
      pbr: {
        label: "P/B",
        description:
          "Shows how much market expectations exceed the company’s net assets. A high value may mean the price reflects more growth expectations than assets alone.",
      },
      fcfYield: {
        label: "FCF yield",
        description:
          "Shows how much cash the company generates relative to its market value. Higher can mean stronger cash generation for the price paid.",
      },
    },
  };
}

export default function CompanyValuationSnapshot({
  locale,
  valuation,
}: CompanyValuationSnapshotProps) {
  if (!valuation) return null;

  const copy = buildCopy(locale);
  const numberLocale = locale === "ko" ? "ko-KR" : "en-US";

  return (
    <section
      className="border-b border-hairline py-7"
      aria-labelledby="valuation-snapshot-heading"
    >
      <div>
        <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
          {copy.eyebrow}
        </p>
        <div className="mt-2">
          <h2
            id="valuation-snapshot-heading"
            className="text-[20px] font-black leading-7 text-ink sm:text-[22px]"
          >
            {copy.heading}
          </h2>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-visible rounded-[8px] border border-hairline bg-hairline md:grid-cols-5">
        <MetricCell
          label={copy.marketCap}
          explanation={copy.explanations.marketCap}
          explanationAction={copy.explanationAction}
          value={formatCompactCurrency(valuation.market_cap, valuation.currency, numberLocale)}
        />
        <MetricCell
          label={copy.eps}
          explanation={copy.explanations.eps}
          explanationAction={copy.explanationAction}
          value={formatEps(valuation.eps_ttm_diluted, valuation.currency, numberLocale)}
        />
        <MetricCell
          label={copy.per}
          explanation={copy.explanations.per}
          explanationAction={copy.explanationAction}
          value={formatMultiple(valuation.pe_ttm, valuation, "pe_ttm", copy)}
        />
        <MetricCell
          label={copy.pbr}
          explanation={copy.explanations.pbr}
          explanationAction={copy.explanationAction}
          value={formatMultiple(valuation.pb, valuation, "pb", copy)}
        />
        <MetricCell
          label={copy.fcfYield}
          explanation={copy.explanations.fcfYield}
          explanationAction={copy.explanationAction}
          value={formatYield(valuation.fcf_yield, valuation, "fcf_yield", copy)}
        />
      </dl>
    </section>
  );
}

function MetricInfo({
  explanation,
  explanationAction,
}: {
  explanation: MetricExplanation;
  explanationAction: string;
}) {
  return (
    <details className="relative inline-flex shrink-0 align-middle">
      <summary
        aria-label={`${explanation.label} ${explanationAction}`}
        className="inline-flex size-5 cursor-pointer list-none items-center justify-center rounded-full border border-hairline bg-canvas text-[10px] font-black text-muted transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-canvas [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden="true">?</span>
      </summary>
      <div className="absolute left-1/2 top-6 z-40 w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[8px] border border-hairline bg-canvas p-3 text-left shadow-[0_8px_24px_rgba(15,23,42,0.14)]">
        <p className="text-[12px] font-bold leading-5 text-ink">{explanation.label}</p>
        <p className="mt-1 text-[12px] leading-5 text-body">{explanation.description}</p>
      </div>
    </details>
  );
}

function MetricCell({
  label,
  explanation,
  explanationAction,
  value,
}: {
  label: string;
  explanation: MetricExplanation;
  explanationAction: string;
  value: string;
}) {
  return (
    <div className="bg-canvas px-sm py-3">
      <dt className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
        <span>{label}</span>
        <MetricInfo explanation={explanation} explanationAction={explanationAction} />
      </dt>
      <dd className="mt-1 text-[18px] font-black leading-6 tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}

type MetricStatusShape = {
  status?: string;
  reason?: string;
};

function getMetricStatus(
  valuation: ValuationSnapshotRow,
  key: string,
): MetricStatusShape | null {
  const raw = valuation.metric_statuses?.[key];
  if (typeof raw === "object" && raw !== null) {
    return raw as MetricStatusShape;
  }
  return null;
}

function reasonLabel(reason: string | undefined, copy: Copy): string | null {
  if (!reason) return null;
  switch (reason) {
    case "negative_earnings":
      return copy.reasonNegativeEarnings;
    case "negative_equity":
      return copy.reasonNegativeEquity;
    case "currency_mismatch":
      return copy.reasonCurrencyMismatch;
    case "missing_prior_balance":
    case "non_comparable_balance_periods":
    case "missing_total_assets":
    case "missing_working_capital":
    case "missing_current_assets_or_liabilities":
    case "missing_tax_inputs":
    case "missing_invested_capital":
    case "missing_operating_income":
    case "invalid_tax_rate":
    case "invalid_current_liabilities":
    case "non_positive_revenue":
    case "non_positive_cost_of_revenue":
      return copy.reasonInsufficientData;
    default:
      return reason;
  }
}

function formatMultiple(
  value: number | null,
  valuation: ValuationSnapshotRow,
  key: string,
  copy: Copy,
): string {
  if (value !== null && Number.isFinite(value)) {
    return `${value.toFixed(1)}×`;
  }
  const status = getMetricStatus(valuation, key);
  if (status?.status === "not_meaningful") {
    const reason = reasonLabel(status.reason, copy);
    return reason ? `${copy.notMeaningful} · ${reason}` : copy.notMeaningful;
  }
  return copy.insufficientData;
}

function formatYield(
  value: number | null,
  valuation: ValuationSnapshotRow,
  key: string,
  copy: Copy,
): string {
  if (value !== null && Number.isFinite(value)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  const status = getMetricStatus(valuation, key);
  if (status?.status === "not_meaningful") {
    const reason = reasonLabel(status.reason, copy);
    return reason ? `${copy.notMeaningful} · ${reason}` : copy.notMeaningful;
  }
  return copy.insufficientData;
}

function formatEps(value: number | null, currency: string, numberLocale: string): string {
  return formatCurrency(value, currency, numberLocale);
}

function formatCurrency(
  value: number | null,
  currency: string,
  numberLocale: string,
): string {
  return formatCurrencyValue(value, currency, numberLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCompactCurrency(value: number | null, currency: string, numberLocale: string): string {
  return formatCurrencyValue(value, currency, numberLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function formatCurrencyValue(
  value: number | null,
  currency: string,
  numberLocale: string,
  options: Intl.NumberFormatOptions,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(numberLocale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      ...options,
    }).format(value);
  } catch {
    return value.toLocaleString(numberLocale, options);
  }
}
