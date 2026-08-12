import type { Locale } from "@/i18n/config";
import type { ValuationSnapshotRow } from "@/lib/valuation/repository";

type CompanyFinancialHealthSnapshotProps = {
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
  roe: string;
  roa: string;
  roic: string;
  currentRatio: string;
  currentRatioNote: string;
  ccc: string;
  cccNote: string;
  daysSuffix: string;
  notMeaningful: string;
  insufficientData: string;
  reasonNegativeEquity: string;
  reasonInsufficientData: string;
  reasonInvalidTax: string;
  reasonNonPositiveCapital: string;
  reasonInvalidCurrentLiabilities: string;
  explanationAction: string;
  explanations: {
    roe: MetricExplanation;
    roa: MetricExplanation;
    roic: MetricExplanation;
    currentRatio: MetricExplanation;
    ccc: MetricExplanation;
  };
};

function buildCopy(locale: Locale): Copy {
  if (locale === "ko") {
    return {
      eyebrow: "재무 체력",
      heading: "수익성·운영 지표",
      roe: "ROE TTM",
      roa: "ROA TTM",
      roic: "ROIC TTM",
      currentRatio: "유동비율",
      currentRatioNote: "최신 분기",
      ccc: "현금전환주기",
      cccNote: "일 · TTM 기준",
      daysSuffix: "일",
      notMeaningful: "의미 없음",
      insufficientData: "데이터 부족",
      reasonNegativeEquity: "자본잠식",
      reasonInsufficientData: "계산 입력 부족",
      reasonInvalidTax: "세율 입력 확인 필요",
      reasonNonPositiveCapital: "투하자본 확인 필요",
      reasonInvalidCurrentLiabilities: "유동부채 확인 필요",
      explanationAction: "설명 보기",
      explanations: {
        roe: {
          label: "ROE TTM",
          description:
            "주주가 맡긴 자본으로 얼마나 효율적으로 이익을 냈는지 보여줘요. 높을수록 자본을 잘 활용한 것으로 볼 수 있지만, 빚이 많아도 높아질 수 있어요.",
        },
        roa: {
          label: "ROA TTM",
          description:
            "회사가 가진 전체 자산으로 얼마나 이익을 냈는지 보여줘요. 높을수록 보유한 자산을 효율적으로 운영하는 편이에요.",
        },
        roic: {
          label: "ROIC TTM",
          description:
            "사업에 실제로 투입한 돈으로 본업에서 얼마나 성과를 냈는지 보여줘요. 높을수록 본업의 자본 활용이 좋은 편이에요.",
        },
        currentRatio: {
          label: "유동비율",
          description:
            "곧 갚아야 할 단기 빚을 감당할 여유를 보여줘요. 높을수록 단기 자금 사정이 안정적일 수 있지만, 너무 높으면 자금이 묶여 있을 수도 있어요.",
        },
        ccc: {
          label: "현금전환주기",
          description:
            "상품을 팔고 현금으로 회수하기까지 걸리는 시간을 보여줘요. 짧거나 음수면 현금이 빨리 돌아오는 편이고, 길수록 운영자금 부담이 커질 수 있어요.",
        },
      },
    };
  }
  return {
    eyebrow: "Financial health",
    heading: "Profitability & operating metrics",
    roe: "ROE TTM",
    roa: "ROA TTM",
    roic: "ROIC TTM",
    currentRatio: "Current ratio",
    currentRatioNote: "latest quarter",
    ccc: "Cash conversion cycle",
    cccNote: "days · TTM basis",
    daysSuffix: " d",
    notMeaningful: "N.M.",
    insufficientData: "n/a",
    reasonNegativeEquity: "negative equity",
    reasonInsufficientData: "insufficient inputs",
    reasonInvalidTax: "check tax inputs",
    reasonNonPositiveCapital: "check invested capital",
    reasonInvalidCurrentLiabilities: "check current liabilities",
    explanationAction: "view explanation",
    explanations: {
      roe: {
        label: "ROE TTM",
        description:
          "Shows how efficiently the company turns shareholders’ capital into profit. Higher can be positive, but heavy debt can also push it up.",
      },
      roa: {
        label: "ROA TTM",
        description:
          "Shows how efficiently the company uses everything it owns to make profit. Higher generally means assets are being used more efficiently.",
      },
      roic: {
        label: "ROIC TTM",
        description:
          "Shows how well the core business performs with the money invested in it. Higher generally means better use of operating capital.",
      },
      currentRatio: {
        label: "Current ratio",
        description:
          "Shows how much room the company has to cover near-term bills. Higher can mean more short-term safety, but an unusually high number can also mean cash is tied up.",
      },
      ccc: {
        label: "Cash conversion cycle",
        description:
          "Shows how long it takes for sales to come back as cash. A short or negative cycle is usually easier on cash; a long cycle can increase funding pressure.",
      },
    },
  };
}

export default function CompanyFinancialHealthSnapshot({
  locale,
  valuation,
}: CompanyFinancialHealthSnapshotProps) {
  if (!valuation) return null;

  const copy = buildCopy(locale);
  const headingId = "financial-health-snapshot-heading";

  return (
    <section className="border-b border-hairline py-7" aria-labelledby={headingId}>
      <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
        {copy.eyebrow}
      </p>
      <div className="mt-2">
        <h2 id={headingId} className="text-[20px] font-black leading-7 text-ink sm:text-[22px]">
          {copy.heading}
        </h2>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-visible rounded-[8px] border border-hairline bg-hairline md:grid-cols-5">
        <MetricCell
          label={copy.roe}
          explanation={copy.explanations.roe}
          explanationAction={copy.explanationAction}
          value={formatPercent(valuation.roe_ttm, valuation, "roe_ttm", copy)}
        />
        <MetricCell
          label={copy.roa}
          explanation={copy.explanations.roa}
          explanationAction={copy.explanationAction}
          value={formatPercent(valuation.roa_ttm, valuation, "roa_ttm", copy)}
        />
        <MetricCell
          label={copy.roic}
          explanation={copy.explanations.roic}
          explanationAction={copy.explanationAction}
          value={formatPercent(valuation.roic_ttm, valuation, "roic_ttm", copy)}
        />
        <MetricCell
          label={copy.currentRatio}
          explanation={copy.explanations.currentRatio}
          explanationAction={copy.explanationAction}
          note={copy.currentRatioNote}
          value={formatRatio(valuation.current_ratio, valuation, "current_ratio", copy)}
        />
        <MetricCell
          label={copy.ccc}
          explanation={copy.explanations.ccc}
          explanationAction={copy.explanationAction}
          note={copy.cccNote}
          value={formatDays(valuation.cash_conversion_cycle_days, valuation, "cash_conversion_cycle_days", copy)}
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
  note,
  value,
}: {
  label: string;
  explanation: MetricExplanation;
  explanationAction: string;
  note?: string;
  value: string;
}) {
  return (
    <div className="bg-canvas px-sm py-3">
      <dt className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
        <span>{label}</span>
        <MetricInfo explanation={explanation} explanationAction={explanationAction} />
      </dt>
      {note ? <p className="mt-0.5 text-[10px] leading-4 text-muted">{note}</p> : null}
      <dd className="mt-1 text-[18px] font-black leading-6 tabular-nums text-ink">{value}</dd>
    </div>
  );
}

type CopyWithReasons = Pick<
  Copy,
  | "notMeaningful"
  | "insufficientData"
  | "reasonNegativeEquity"
  | "reasonInsufficientData"
  | "reasonInvalidTax"
  | "reasonNonPositiveCapital"
  | "reasonInvalidCurrentLiabilities"
  | "daysSuffix"
>;

function statusFor(valuation: ValuationSnapshotRow, key: string) {
  const status = valuation.metric_statuses?.[key];
  return typeof status === "object" && status !== null
    ? (status as { status?: string; reason?: string })
    : null;
}

function unavailable(
  valuation: ValuationSnapshotRow,
  key: string,
  copy: CopyWithReasons,
): string {
  const status = statusFor(valuation, key);
  if (status?.status === "not_meaningful") {
    const reason = reasonLabel(status.reason, copy);
    return reason ? `${copy.notMeaningful} · ${reason}` : copy.notMeaningful;
  }
  return copy.insufficientData;
}

function reasonLabel(reason: string | undefined, copy: CopyWithReasons): string | null {
  switch (reason) {
    case "negative_equity":
      return copy.reasonNegativeEquity;
    case "invalid_tax_rate":
    case "missing_tax_inputs":
      return copy.reasonInvalidTax;
    case "non_positive_invested_capital":
      return copy.reasonNonPositiveCapital;
    case "invalid_current_liabilities":
      return copy.reasonInvalidCurrentLiabilities;
    case "missing_prior_balance":
    case "non_comparable_balance_periods":
    case "missing_total_assets":
    case "missing_working_capital":
    case "missing_current_assets_or_liabilities":
    case "missing_invested_capital":
    case "missing_operating_income":
    case "non_positive_revenue":
    case "non_positive_cost_of_revenue":
      return copy.reasonInsufficientData;
    default:
      return reason ?? null;
  }
}

function formatPercent(value: number | null, valuation: ValuationSnapshotRow, key: string, copy: CopyWithReasons) {
  return value !== null && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : unavailable(valuation, key, copy);
}

function formatRatio(value: number | null, valuation: ValuationSnapshotRow, key: string, copy: CopyWithReasons) {
  return value !== null && Number.isFinite(value) ? `${value.toFixed(2)}×` : unavailable(valuation, key, copy);
}

function formatDays(value: number | null, valuation: ValuationSnapshotRow, key: string, copy: CopyWithReasons) {
  return value !== null && Number.isFinite(value)
    ? `${value.toFixed(1)}${copy.daysSuffix}`
    : unavailable(valuation, key, copy);
}
