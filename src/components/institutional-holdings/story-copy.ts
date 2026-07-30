import type { InstitutionalHoldingView } from "@/lib/sec-13f/types";

type StoryCopyInput = {
  hasPreviousFiling: boolean;
  buys: InstitutionalHoldingView[];
  sells: InstitutionalHoldingView[];
};

function holdingLabel(holding: InstitutionalHoldingView) {
  return holding.ticker?.trim() || holding.displayName;
}

export function quarterlyStoryCopy({
  hasPreviousFiling,
  buys,
  sells,
}: StoryCopyInput) {
  if (!hasPreviousFiling) {
    return "직전 공시와 비교할 데이터가 아직 없습니다. 이번 공시의 핵심 보유부터 확인해 보세요.";
  }

  const leadBuy = buys[0];
  const leadSell = sells[0];

  if (leadBuy && leadSell) {
    return (
      holdingLabel(leadBuy) +
      "의 보유 비중은 늘고, " +
      holdingLabel(leadSell) +
      "의 보유 비중은 줄었습니다."
    );
  }

  if (leadBuy) {
    return holdingLabel(leadBuy) + "의 보유 비중이 가장 크게 늘었습니다.";
  }

  if (leadSell) {
    return holdingLabel(leadSell) + "의 보유 비중이 가장 크게 줄었습니다.";
  }

  return "직전 공시와 비교해 표시할 만한 보유 비중 변화가 없습니다.";
}
