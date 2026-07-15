import type { Locale } from "@/i18n/config";
import { KNOWN_13F_MANAGERS, type Known13FManager } from "@/lib/sec-13f/types";

interface ManagerSeoCopy {
  slug: string;
  shortNameKo: string;
  shortNameEn: string;
  personKo?: string;
  personEn?: string;
  focusKo: string;
  focusEn: string;
  profileKo: string;
  profileEn: string;
  watchPointsKo: string[];
  watchPointsEn: string[];
  questionsKo: string[];
  questionsEn: string[];
  limitsKo: string[];
  limitsEn: string[];
}

const MANAGER_SEO_COPY_BY_CIK: Record<string, ManagerSeoCopy> = {
  "0001608046": {
    slug: "national-pension-service",
    shortNameKo: "국민연금",
    shortNameEn: "National Pension Service",
    focusKo: "한국 국민연금의 미국 상장주식 보유 변화",
    focusEn: "U.S. equity holdings disclosed by Korea's National Pension Service",
    profileKo:
      "국민연금은 한국의 대표 공적 연기금으로, 13F에서는 미국 대형주와 장기 분산 포트폴리오의 변화가 주로 관찰됩니다.",
    profileEn:
      "National Pension Service is Korea's major public pension fund. Its 13F is useful for reading broad U.S. large-cap allocation changes rather than short-term trading signals.",
    watchPointsKo: [
      "대형 기술주, 헬스케어, 금융 비중이 분기별로 어떻게 이동하는지",
      "상위 보유 종목의 비중 변화가 시장 전체 리밸런싱인지 특정 thesis 변화인지",
      "새로 편입되거나 비중이 크게 줄어든 종목이 KRW 지원 회사인지",
    ],
    watchPointsEn: [
      "How large-cap technology, healthcare, and financial weights shift quarter to quarter.",
      "Whether top-position changes look like broad rebalancing or a company-specific thesis shift.",
      "Which new or reduced positions are available for filing-grounded KRW follow-up research.",
    ],
    questionsKo: [
      "국민연금이 비중을 늘린 상위 보유 종목의 매출·마진 근거를 확인해줘.",
      "국민연금 13F에서 기술주 비중 변화가 어떤 회사 리스크와 연결되는지 정리해줘.",
      "국민연금의 신규 편입 종목 중 공시 기준으로 먼저 볼 만한 회사를 골라줘.",
      "국민연금 상위 보유 종목의 리밸런싱이 방어적 변화인지 성장주 선호인지 나눠줘.",
    ],
    questionsEn: [
      "Check the revenue and margin evidence behind the top positions NPS increased.",
      "Summarize how NPS technology weight changes connect to company-specific filing risks.",
      "Find which newly added NPS positions are worth reviewing first with filing evidence.",
      "Separate whether NPS top-position changes look defensive or growth-oriented.",
    ],
    limitsKo: [
      "국민연금 13F는 전체 운용자산 중 미국 상장주식 일부만 보여줍니다.",
      "장기 분산 투자 성격이 강하므로 단기 투자 판단의 근거로 단독 사용하면 안 됩니다.",
    ],
    limitsEn: [
      "NPS 13F only shows part of the fund's U.S. listed equity exposure.",
      "Because the portfolio is broadly diversified, it should not be used alone for a short-term investment decision.",
    ],
  },
  "0002012383": {
    slug: "blackrock",
    shortNameKo: "블랙록",
    shortNameEn: "BlackRock",
    focusKo: "글로벌 자산운용사의 미국 상장주식 보유 현황",
    focusEn: "U.S. listed equity holdings from the global asset manager",
    profileKo:
      "블랙록의 13F는 액티브 판단만이 아니라 ETF와 인덱스 운용 노출이 섞인 대형 자산운용사 보유 현황입니다.",
    profileEn:
      "BlackRock's 13F mixes active decisions with index and ETF-related exposure, so it is best used as a market-structure and ownership context page.",
    watchPointsKo: [
      "상위 보유 종목 변화가 인덱스·ETF 흐름인지 특정 기업 선호인지",
      "대형주 쏠림과 sector별 비중 변화가 어느 회사 질문으로 이어지는지",
      "보유 변화보다 ownership context가 중요한 회사가 어디인지",
    ],
    watchPointsEn: [
      "Whether top holding changes reflect index/ETF flows or company-specific preference.",
      "Which sector weight changes create useful company research questions.",
      "Where ownership context matters more than the raw holding change.",
    ],
    questionsKo: [
      "블랙록 상위 보유 종목 중 ownership context가 중요한 회사를 골라줘.",
      "블랙록 13F의 sector 비중 변화가 어떤 기업 리스크와 연결되는지 정리해줘.",
      "블랙록이 많이 보유한 회사의 공시상 장기 성장 근거를 비교해줘.",
      "블랙록 보유 비중 변화와 무관하게 원문 근거로 봐야 할 리스크를 뽑아줘.",
    ],
    questionsEn: [
      "Identify BlackRock top holdings where ownership context is most relevant.",
      "Connect BlackRock sector weight changes to company-level filing risks.",
      "Compare filing-backed long-term growth evidence for companies BlackRock holds heavily.",
      "Highlight risks worth reading even when BlackRock's holding change is not thesis-driven.",
    ],
    limitsKo: [
      "블랙록 13F는 인덱스 운용 영향이 커서 투자 의견으로 단순 해석하기 어렵습니다.",
      "비중 변화는 자금 유입·유출, ETF 구성, corporate action의 영향을 받을 수 있습니다.",
    ],
    limitsEn: [
      "BlackRock's 13F is heavily influenced by index products, so it is not a clean investment opinion.",
      "Weight changes can reflect flows, ETF composition, or corporate actions rather than a fundamental call.",
    ],
  },
  "0001067983": {
    slug: "berkshire-hathaway",
    shortNameKo: "버크셔 해서웨이",
    shortNameEn: "Berkshire Hathaway",
    personKo: "워런 버핏",
    personEn: "Warren Buffett",
    focusKo: "워런 버핏의 버크셔 해서웨이 13F 포트폴리오 변화",
    focusEn: "Berkshire Hathaway 13F portfolio changes associated with Warren Buffett",
    profileKo:
      "버크셔 해서웨이 13F는 집중형 장기 포트폴리오와 현금흐름·브랜드·자본배분 중심 투자 관점을 읽는 데 적합합니다.",
    profileEn:
      "Berkshire Hathaway's 13F is useful for studying a concentrated, long-term portfolio with emphasis on cash generation, brand durability, and capital allocation.",
    watchPointsKo: [
      "상위 집중 종목의 비중이 유지되는지, 줄어드는지",
      "금융, 소비재, 에너지, 기술 노출이 어떤 현금흐름 논지와 연결되는지",
      "버크셔가 줄인 종목에서 thesis 약화 신호가 공시에도 보이는지",
    ],
    watchPointsEn: [
      "Whether the largest concentrated positions are being maintained or reduced.",
      "How financials, consumer, energy, and technology exposure connect to cash-flow theses.",
      "Whether reduced positions show filing evidence of weakening business assumptions.",
    ],
    questionsKo: [
      "버크셔 상위 보유 종목의 현금흐름과 자본배분 근거를 비교해줘.",
      "버크셔가 비중을 줄인 종목에서 공시상 thesis 약화 신호가 있는지 봐줘.",
      "버크셔 포트폴리오의 금융·소비재·에너지 노출을 회사별 리스크로 나눠줘.",
      "버크셔가 오래 보유한 종목의 방어력과 성장 한계를 같이 정리해줘.",
    ],
    questionsEn: [
      "Compare the cash-flow and capital allocation evidence behind Berkshire's top holdings.",
      "Check whether Berkshire's reduced positions show filing-backed thesis weakness.",
      "Break Berkshire's financials, consumer, and energy exposure into company-level risks.",
      "Summarize both durability and growth limits for Berkshire's long-held positions.",
    ],
    limitsKo: [
      "버크셔 13F에는 비상장 자회사와 현금, 채권, 일부 해외 노출이 충분히 반영되지 않습니다.",
      "버크셔의 매매 시점은 공개보다 늦게 보이므로 현재 판단으로 단정하면 안 됩니다.",
    ],
    limitsEn: [
      "Berkshire's 13F excludes much of the operating-company, cash, bond, and some foreign exposure context.",
      "The disclosed trade timing is delayed, so it should not be treated as Berkshire's current action.",
    ],
  },
  "0001697748": {
    slug: "ark-invest",
    shortNameKo: "ARK Invest",
    shortNameEn: "ARK Invest",
    personKo: "캐시 우드",
    personEn: "Cathie Wood",
    focusKo: "캐시 우드 ARK의 혁신 성장주 중심 보유 변화",
    focusEn: "Cathie Wood's ARK 13F holdings across innovation-oriented growth stocks",
    profileKo:
      "ARK Invest 13F는 혁신 성장주, AI, 소프트웨어, 바이오, 플랫폼 기업에 대한 고변동성 성장 thesis 변화를 보기 좋습니다.",
    profileEn:
      "ARK Invest's 13F is useful for tracking high-volatility innovation themes across AI, software, biotech, and platform companies.",
    watchPointsKo: [
      "고성장주 비중 변화가 매출 성장 근거와 실제로 연결되는지",
      "적자 성장 기업의 현금흐름·희석 리스크가 커지고 있는지",
      "테마 노출이 넓어졌는지 특정 종목 집중이 강해졌는지",
    ],
    watchPointsEn: [
      "Whether growth-stock weight changes are supported by revenue evidence.",
      "Whether cash-flow and dilution risk is rising for loss-making growth companies.",
      "Whether theme exposure is broadening or concentrating in fewer names.",
    ],
    questionsKo: [
      "ARK가 늘린 성장주의 매출 성장 근거와 현금흐름 리스크를 같이 봐줘.",
      "ARK 13F에서 AI·소프트웨어 노출이 실제 실적 동인과 연결되는지 정리해줘.",
      "ARK가 줄인 종목에서 성장 둔화나 비용 부담이 공시에 보이는지 확인해줘.",
      "ARK 보유 종목 중 기대는 큰데 공시 근거가 약한 회사를 걸러줘.",
    ],
    questionsEn: [
      "Review both revenue growth evidence and cash-flow risk for growth stocks ARK increased.",
      "Check whether ARK's AI and software exposure connects to real performance drivers.",
      "Look for filing evidence of slowing growth or rising costs in names ARK reduced.",
      "Filter ARK holdings where expectations look high but filing support looks weak.",
    ],
    limitsKo: [
      "ARK 13F는 테마와 변동성이 강해 단기 가격 움직임에 크게 흔들릴 수 있습니다.",
      "13F에는 펀드별 실시간 매매와 비중 조절이 늦게 반영됩니다.",
    ],
    limitsEn: [
      "ARK's holdings are theme-heavy and volatile, so short-term price moves can dominate the signal.",
      "13F data reflects fund activity with a delay and does not show real-time rebalancing.",
    ],
  },
  "0001536411": {
    slug: "duquesne-family-office",
    shortNameKo: "드러켄밀러",
    shortNameEn: "Duquesne Family Office",
    personKo: "스탠리 드러켄밀러",
    personEn: "Stanley Druckenmiller",
    focusKo: "스탠리 드러켄밀러 패밀리오피스의 분기 보유 변화",
    focusEn: "Stanley Druckenmiller's quarterly 13F holdings through Duquesne Family Office",
    profileKo:
      "Duquesne 13F는 매크로 관점과 개별 성장주·경기민감주 선택이 함께 나타나는 비교적 민첩한 포트폴리오입니다.",
    profileEn:
      "Duquesne's 13F often combines macro positioning with selective growth and cyclical equity exposure.",
    watchPointsKo: [
      "금리, AI, 원자재, 경기민감 노출이 어떤 회사로 표현되는지",
      "분기마다 빠르게 바뀐 포지션이 실적 근거와 맞는지",
      "상위 집중 종목이 매크로 thesis인지 개별 기업 thesis인지",
    ],
    watchPointsEn: [
      "Which companies express rate, AI, commodity, or cyclical exposure.",
      "Whether fast quarterly position changes line up with filing evidence.",
      "Whether top concentrated holdings reflect macro theses or company-specific theses.",
    ],
    questionsKo: [
      "Duquesne 상위 보유 종목을 매크로 thesis와 개별 기업 thesis로 나눠줘.",
      "드러켄밀러가 늘린 종목의 실적 동인이 현재 매크로 환경과 맞는지 봐줘.",
      "Duquesne가 줄인 종목에서 공시상 리스크가 커졌는지 확인해줘.",
      "AI·에너지·금리 민감 종목을 현금흐름 관점으로 비교해줘.",
    ],
    questionsEn: [
      "Separate Duquesne top holdings into macro theses and company-specific theses.",
      "Check whether increased Duquesne positions fit the current macro backdrop based on filings.",
      "Review whether reduced Duquesne names show rising filing risks.",
      "Compare AI, energy, and rate-sensitive names through cash-flow evidence.",
    ],
    limitsKo: [
      "Duquesne의 13F는 빠르게 바뀔 수 있어 공개 시점에는 포지션이 달라졌을 수 있습니다.",
      "매크로 hedge나 비상장·파생 노출은 13F만으로 확인하기 어렵습니다.",
    ],
    limitsEn: [
      "Duquesne positions can change quickly, so the public 13F may be stale by the time it is read.",
      "Macro hedges, private positions, and derivatives are not visible in a standard 13F view.",
    ],
  },
  "0000850529": {
    slug: "fisher-asset-management",
    shortNameKo: "켄 피셔",
    shortNameEn: "Fisher Asset Management",
    personKo: "켄 피셔",
    personEn: "Ken Fisher",
    focusKo: "켄 피셔의 Fisher Asset Management 13F 보유 현황",
    focusEn: "Ken Fisher's Fisher Asset Management 13F holdings",
    profileKo:
      "Fisher Asset Management 13F는 넓은 글로벌 대형주 보유와 sector 분산을 통해 장기 성장·품질 노출을 확인하기 좋습니다.",
    profileEn:
      "Fisher Asset Management's 13F is useful for reading broad large-cap exposure and sector diversification tied to quality and long-term growth.",
    watchPointsKo: [
      "대형 기술주와 경기민감 섹터 비중이 어떻게 균형을 이루는지",
      "광범위한 보유 중 실제로 리서치 우선순위가 높은 종목이 어디인지",
      "상위 종목 변화가 구조적 성장인지 단순 리밸런싱인지",
    ],
    watchPointsEn: [
      "How large-cap technology and cyclical sector exposure are balanced.",
      "Which holdings deserve research priority within a broad portfolio.",
      "Whether top changes reflect structural growth preference or routine rebalancing.",
    ],
    questionsKo: [
      "켄 피셔 상위 보유 종목 중 장기 성장 근거가 가장 뚜렷한 회사를 골라줘.",
      "Fisher 13F의 기술주와 경기민감주 노출을 공시 리스크 기준으로 나눠줘.",
      "Fisher가 비중을 늘린 회사의 매출 성장과 마진 방어력을 비교해줘.",
      "넓은 보유 중 리서치 우선순위가 낮은 종목을 제외해줘.",
    ],
    questionsEn: [
      "Find Fisher top holdings with the clearest filing-backed long-term growth evidence.",
      "Split Fisher technology and cyclical exposure by company-level filing risk.",
      "Compare revenue growth and margin durability for companies Fisher increased.",
      "Exclude lower-priority names from Fisher's broad holdings list.",
    ],
    limitsKo: [
      "Fisher 13F는 보유 종목 수가 많아 단일 종목 변화의 의미가 약할 수 있습니다.",
      "대형주 중심 분산 포트폴리오는 개별 종목 변화보다 포트폴리오 맥락이 중요합니다.",
    ],
    limitsEn: [
      "Because Fisher holds many names, a single holding change may carry limited signal.",
      "For diversified large-cap portfolios, portfolio context often matters more than inferred trade intent.",
    ],
  },
  "0001336528": {
    slug: "pershing-square",
    shortNameKo: "퍼싱 스퀘어",
    shortNameEn: "Pershing Square",
    personKo: "빌 애크먼",
    personEn: "Bill Ackman",
    focusKo: "빌 애크먼의 집중형 13F 포트폴리오",
    focusEn: "Bill Ackman's concentrated 13F portfolio through Pershing Square",
    profileKo:
      "Pershing Square 13F는 집중형 포트폴리오와 경영·브랜드·가격결정력 thesis를 읽는 데 적합합니다.",
    profileEn:
      "Pershing Square's 13F is useful for reading a concentrated portfolio built around management, brand, and pricing-power theses.",
    watchPointsKo: [
      "소수 상위 종목의 비중 변화가 thesis 유지인지 재평가인지",
      "브랜드, 가격결정력, 자사주·자본배분 근거가 공시에 보이는지",
      "새로운 집중 포지션이 기존 포트폴리오와 어떤 리스크를 공유하는지",
    ],
    watchPointsEn: [
      "Whether changes in a few large positions reflect thesis persistence or reassessment.",
      "Whether brand, pricing power, buyback, and capital allocation evidence appears in filings.",
      "Which risks new concentrated positions share with existing holdings.",
    ],
    questionsKo: [
      "Pershing Square 상위 보유 종목의 가격결정력과 마진 근거를 비교해줘.",
      "빌 애크먼이 집중 보유한 회사의 자본배분 정책을 공시 기준으로 정리해줘.",
      "Pershing 포트폴리오에서 thesis가 깨질 수 있는 리스크 신호를 뽑아줘.",
      "새로 늘린 종목이 기존 집중 포트폴리오와 어떤 공통 리스크를 갖는지 봐줘.",
    ],
    questionsEn: [
      "Compare pricing power and margin evidence across Pershing Square top holdings.",
      "Summarize capital allocation policies for Bill Ackman's concentrated positions.",
      "Identify thesis-break risk signals in the Pershing portfolio.",
      "Check which risks a newly increased position shares with the existing concentrated portfolio.",
    ],
    limitsKo: [
      "집중형 포트폴리오는 한 종목 변화의 의미가 크지만, 13F만으로 전체 thesis를 알 수는 없습니다.",
      "옵션, 파생, 해외 보유, activism 진행 상황은 13F에 충분히 나오지 않을 수 있습니다.",
    ],
    limitsEn: [
      "In a concentrated portfolio, one position matters more, but 13F alone does not reveal the full thesis.",
      "Options, derivatives, foreign holdings, and activism details may not be fully visible.",
    ],
  },
  "0001656456": {
    slug: "appaloosa",
    shortNameKo: "Appaloosa",
    shortNameEn: "Appaloosa",
    personKo: "데이비드 테퍼",
    personEn: "David Tepper",
    focusKo: "데이비드 테퍼의 Appaloosa 13F 보유 변화",
    focusEn: "David Tepper's Appaloosa 13F holdings",
    profileKo:
      "Appaloosa 13F는 경기·금리·위험자산 선호 변화가 대형 기술주와 경기민감주 보유로 어떻게 표현되는지 보기 좋습니다.",
    profileEn:
      "Appaloosa's 13F helps read how risk appetite, rates, and cyclical views are expressed through large-cap technology and cyclical holdings.",
    watchPointsKo: [
      "위험자산 선호가 강해질 때 늘린 종목과 줄인 종목",
      "AI·반도체·중국 관련 노출이 실제 공시 근거와 맞는지",
      "상위 포지션 변화가 시장 방향성 베팅인지 개별 기업 판단인지",
    ],
    watchPointsEn: [
      "Which names Appaloosa increases or reduces when risk appetite changes.",
      "Whether AI, semiconductor, and China-related exposure is supported by filings.",
      "Whether top changes look like market-direction bets or company-specific calls.",
    ],
    questionsKo: [
      "Appaloosa의 AI·반도체 보유 변화가 실제 매출 동인과 연결되는지 확인해줘.",
      "데이비드 테퍼가 줄인 종목에서 경기민감 리스크가 커졌는지 봐줘.",
      "Appaloosa 상위 보유 종목을 시장 방향성 베팅과 기업별 thesis로 나눠줘.",
      "중국·소비·기술 노출이 있는 종목의 공시 리스크를 비교해줘.",
    ],
    questionsEn: [
      "Check whether Appaloosa's AI and semiconductor changes connect to real revenue drivers.",
      "Review whether reduced names show rising cyclical risk in filings.",
      "Split Appaloosa top holdings into market-direction bets and company-specific theses.",
      "Compare filing risks for holdings with China, consumer, or technology exposure.",
    ],
    limitsKo: [
      "Appaloosa 포지션은 시장 환경에 따라 빠르게 바뀔 수 있습니다.",
      "13F는 macro hedge와 비상장·파생 포지션을 충분히 보여주지 않습니다.",
    ],
    limitsEn: [
      "Appaloosa positions can change quickly with market conditions.",
      "13F does not fully show macro hedges, private positions, or derivatives.",
    ],
  },
  "0001061768": {
    slug: "baupost-group",
    shortNameKo: "Baupost Group",
    shortNameEn: "Baupost Group",
    personKo: "세스 클라먼",
    personEn: "Seth Klarman",
    focusKo: "세스 클라먼의 Baupost Group 13F 포트폴리오",
    focusEn: "Seth Klarman's Baupost Group 13F portfolio",
    profileKo:
      "Baupost 13F는 가치투자, 이벤트, 특수상황 성격의 포지션을 공시 근거로 다시 확인하기 좋은 출발점입니다.",
    profileEn:
      "Baupost's 13F is a useful starting point for value, event-driven, and special-situation research based on company filings.",
    watchPointsKo: [
      "저평가 논지가 매출·현금흐름 방어력과 맞는지",
      "특수상황 또는 이벤트성 포지션이 어떤 촉매와 리스크를 갖는지",
      "비중 증가가 장기 가치 thesis인지 단기 이벤트 대응인지",
    ],
    watchPointsEn: [
      "Whether valuation-oriented holdings have durable revenue and cash-flow evidence.",
      "Which catalysts and risks support special-situation positions.",
      "Whether increases look like long-term value theses or event responses.",
    ],
    questionsKo: [
      "Baupost 보유 종목 중 저평가 근거가 공시상 가장 탄탄한 회사를 골라줘.",
      "세스 클라먼 포트폴리오에서 이벤트성 포지션의 촉매와 리스크를 나눠줘.",
      "Baupost가 늘린 종목의 현금흐름 방어력과 부채 리스크를 비교해줘.",
      "가치주처럼 보이지만 thesis가 약할 수 있는 회사를 걸러줘.",
    ],
    questionsEn: [
      "Find Baupost holdings with the strongest filing-backed value evidence.",
      "Separate catalysts and risks for event-driven Baupost positions.",
      "Compare cash-flow durability and debt risk for positions Baupost increased.",
      "Filter companies that look like value stocks but have weak thesis support.",
    ],
    limitsKo: [
      "Baupost의 특수상황 논지는 13F만으로 촉매와 hedge를 완전히 파악하기 어렵습니다.",
      "가치투자 포지션은 오래 유지될 수 있어 분기 변화만 보면 오해할 수 있습니다.",
    ],
    limitsEn: [
      "Baupost's special-situation theses may depend on catalysts or hedges that 13F does not show.",
      "Value positions can be held for long periods, so quarterly changes can be misleading.",
    ],
  },
  "0001040273": {
    slug: "third-point",
    shortNameKo: "Third Point",
    shortNameEn: "Third Point",
    personKo: "댄 로브",
    personEn: "Dan Loeb",
    focusKo: "댄 로브 Third Point의 13F 보유 변화",
    focusEn: "Dan Loeb's Third Point 13F holdings",
    profileKo:
      "Third Point 13F는 이벤트, activism, 성장주와 가치주를 오가는 포트폴리오 변화를 추적하는 데 유용합니다.",
    profileEn:
      "Third Point's 13F is useful for tracking event-driven, activist, growth, and value positioning across market regimes.",
    watchPointsKo: [
      "신규 포지션이 이벤트·activism 가능성과 연결되는지",
      "기존 보유 축소가 thesis 종료인지 리스크 관리인지",
      "성장주와 가치주 사이의 노출 변화가 어떤 회사 근거를 요구하는지",
    ],
    watchPointsEn: [
      "Whether new positions may connect to event or activist situations.",
      "Whether reductions look like thesis exits or risk management.",
      "What filing evidence is needed when exposure shifts between growth and value.",
    ],
    questionsKo: [
      "Third Point 신규 편입 종목의 이벤트 촉매와 공시 리스크를 정리해줘.",
      "댄 로브가 줄인 종목에서 thesis 종료 신호가 있는지 확인해줘.",
      "Third Point 포트폴리오의 성장주와 가치주 노출을 실적 근거로 비교해줘.",
      "activism 가능성이 있는 종목의 자본배분과 비용 구조를 봐줘.",
    ],
    questionsEn: [
      "Summarize event catalysts and filing risks for Third Point's new positions.",
      "Check whether reduced Third Point holdings show thesis-exit signals.",
      "Compare Third Point growth and value exposure using performance evidence.",
      "Review capital allocation and cost structure for holdings with activist potential.",
    ],
    limitsKo: [
      "Third Point의 activism 논지는 13F보다 별도 서한·공개 발언에서 더 분명할 수 있습니다.",
      "13F에는 이벤트 trade의 hedge와 exit 계획이 보이지 않습니다.",
    ],
    limitsEn: [
      "Third Point activism theses may be clearer in letters or public statements than in 13F data.",
      "13F does not show event-trade hedges or exit plans.",
    ],
  },
  "0001029160": {
    slug: "soros-fund-management",
    shortNameKo: "Soros Fund Management",
    shortNameEn: "Soros Fund Management",
    personKo: "조지 소로스",
    personEn: "George Soros",
    focusKo: "Soros Fund Management의 13F 보유 현황",
    focusEn: "Soros Fund Management 13F holdings",
    profileKo:
      "Soros Fund Management 13F는 매크로와 이벤트 성격이 섞인 미국 상장주식 노출을 확인하는 참고 페이지입니다.",
    profileEn:
      "Soros Fund Management's 13F is a reference point for U.S. listed equity exposure that may mix macro and event-driven themes.",
    watchPointsKo: [
      "신규·감소 포지션이 macro regime 변화와 연결되는지",
      "상위 보유 종목이 이벤트, 방어, 성장 중 어느 성격인지",
      "공시 근거가 약한 테마성 보유를 어떻게 제외할지",
    ],
    watchPointsEn: [
      "Whether new or reduced positions connect to macro regime shifts.",
      "Whether top holdings look event-driven, defensive, or growth-oriented.",
      "How to exclude thematic holdings with weak filing support.",
    ],
    questionsKo: [
      "Soros Fund 상위 보유 종목을 이벤트·방어·성장 thesis로 분류해줘.",
      "소로스 포트폴리오에서 macro 민감도가 큰 회사를 골라 리스크를 정리해줘.",
      "신규 편입 종목 중 공시 근거로 먼저 확인할 만한 회사를 뽑아줘.",
      "테마성 보유처럼 보이지만 실적 근거가 약한 종목을 걸러줘.",
    ],
    questionsEn: [
      "Classify Soros Fund top holdings into event, defensive, and growth theses.",
      "Find holdings with high macro sensitivity and summarize filing risks.",
      "Pick newly added positions worth reviewing first with filing evidence.",
      "Filter thematic-looking holdings where performance support appears weak.",
    ],
    limitsKo: [
      "Soros Fund의 전체 macro book은 13F 주식 보유만으로 파악할 수 없습니다.",
      "공개 지연 때문에 포지션 의도가 이미 바뀌었을 수 있습니다.",
    ],
    limitsEn: [
      "Soros Fund's broader macro book cannot be inferred from 13F equities alone.",
      "Disclosure delay means the position intent may already have changed.",
    ],
  },
  "0001135730": {
    slug: "coatue",
    shortNameKo: "Coatue",
    shortNameEn: "Coatue",
    personKo: "필립 라퐁",
    personEn: "Philippe Laffont",
    focusKo: "필립 라퐁 Coatue의 기술주 중심 13F 보유 변화",
    focusEn: "Philippe Laffont's Coatue 13F holdings",
    profileKo:
      "Coatue 13F는 기술주, 인터넷, AI 인프라, 소프트웨어 노출을 통해 성장주 thesis 변화를 추적하기 좋습니다.",
    profileEn:
      "Coatue's 13F is useful for tracking growth theses across technology, internet, AI infrastructure, and software exposure.",
    watchPointsKo: [
      "AI 인프라와 소프트웨어 보유가 실제 매출·마진 근거와 연결되는지",
      "고밸류 성장주에서 비용 구조와 현금흐름 압력이 커지는지",
      "기술주 내에서 플랫폼, 반도체, 클라우드 노출이 어떻게 바뀌는지",
    ],
    watchPointsEn: [
      "Whether AI infrastructure and software holdings connect to real revenue and margin evidence.",
      "Whether expensive growth names show rising cost-structure or cash-flow pressure.",
      "How platform, semiconductor, and cloud exposure shifts within technology.",
    ],
    questionsKo: [
      "Coatue의 AI 인프라 보유 종목을 매출 전환 근거 기준으로 비교해줘.",
      "필립 라퐁이 늘린 소프트웨어 종목의 마진 개선 가능성을 공시로 봐줘.",
      "Coatue가 줄인 성장주에서 현금흐름 압력이 커졌는지 확인해줘.",
      "기술주 내 플랫폼·반도체·클라우드 노출을 리스크별로 나눠줘.",
    ],
    questionsEn: [
      "Compare Coatue AI infrastructure holdings by revenue-conversion evidence.",
      "Check margin-improvement potential for software names Philippe Laffont increased.",
      "Review whether reduced growth names show rising cash-flow pressure.",
      "Split platform, semiconductor, and cloud exposure by risk type.",
    ],
    limitsKo: [
      "Coatue의 비상장 기술 투자와 hedge는 13F에 나오지 않습니다.",
      "기술주 포지션은 valuation 변화에 민감하므로 공시 근거와 가격 리스크를 분리해야 합니다.",
    ],
    limitsEn: [
      "Coatue's private technology investments and hedges are not visible in 13F data.",
      "Technology positions are valuation-sensitive, so filing evidence and price risk should be separated.",
    ],
  },
  "0001167483": {
    slug: "tiger-global",
    shortNameKo: "Tiger Global",
    shortNameEn: "Tiger Global",
    personKo: "체이스 콜먼",
    personEn: "Chase Coleman",
    focusKo: "체이스 콜먼 Tiger Global의 성장주 13F 보유 변화",
    focusEn: "Chase Coleman's Tiger Global 13F holdings",
    profileKo:
      "Tiger Global 13F는 인터넷, 소프트웨어, 플랫폼 성장주에 대한 집중도와 성장 기대 변화를 확인하기 좋습니다.",
    profileEn:
      "Tiger Global's 13F is useful for reading concentration and growth-expectation shifts across internet, software, and platform companies.",
    watchPointsKo: [
      "플랫폼 성장주 비중이 다시 커지는지 또는 줄어드는지",
      "성장 둔화와 비용 절감이 동시에 나타나는 회사가 어디인지",
      "비상장 성장투자와 연결된 공개시장 노출을 어떻게 해석할지",
    ],
    watchPointsEn: [
      "Whether platform-growth exposure is expanding or contracting again.",
      "Which companies show both slowing growth and cost discipline.",
      "How public holdings may relate to broader private growth investing themes.",
    ],
    questionsKo: [
      "Tiger Global 상위 성장주의 매출 성장 둔화와 비용 절감 효과를 같이 봐줘.",
      "체이스 콜먼이 늘린 플랫폼 기업의 장기 마진 구조를 공시 기준으로 정리해줘.",
      "Tiger가 줄인 종목에서 성장 thesis가 깨지는 신호가 있는지 확인해줘.",
      "인터넷·소프트웨어 보유 종목 중 공시 근거가 가장 강한 회사를 골라줘.",
    ],
    questionsEn: [
      "Review revenue deceleration and cost discipline together for Tiger Global growth holdings.",
      "Summarize long-term margin structure for platform companies Chase Coleman increased.",
      "Check whether reduced Tiger holdings show growth-thesis break signals.",
      "Find the strongest filing-backed internet or software holdings in the Tiger portfolio.",
    ],
    limitsKo: [
      "Tiger Global의 비상장 투자 손익과 공개주식 보유는 13F에서 함께 보이지 않습니다.",
      "성장주 포트폴리오는 valuation 압축과 business quality를 따로 봐야 합니다.",
    ],
    limitsEn: [
      "Tiger Global's private investment exposure is not shown alongside public 13F holdings.",
      "For growth portfolios, valuation compression and business quality need separate analysis.",
    ],
  },
  "0001103804": {
    slug: "viking-global",
    shortNameKo: "Viking Global",
    shortNameEn: "Viking Global",
    personKo: "안드레아스 할보르센",
    personEn: "Andreas Halvorsen",
    focusKo: "Viking Global의 대형주 중심 13F 포트폴리오 변화",
    focusEn: "Viking Global's 13F portfolio changes",
    profileKo:
      "Viking Global 13F는 대형 성장주와 품질주를 중심으로 sector 간 포지션 이동을 보기 좋은 롱온리/롱쇼트 계열 포트폴리오입니다.",
    profileEn:
      "Viking Global's 13F is useful for reading large-cap growth and quality exposure across sectors in a long/short-oriented investment process.",
    watchPointsKo: [
      "대형 성장주와 방어적 품질주 사이 비중 변화",
      "헬스케어, 기술, 소비재 노출이 어떤 공시 근거로 뒷받침되는지",
      "상위 보유의 리스크가 실적, 규제, 비용 중 어디에 있는지",
    ],
    watchPointsEn: [
      "How weights shift between large-cap growth and defensive quality.",
      "Which filing evidence supports healthcare, technology, and consumer exposure.",
      "Whether top-position risk is tied to performance, regulation, or cost structure.",
    ],
    questionsKo: [
      "Viking Global 상위 보유 종목을 성장주와 품질주로 나눠 공시 근거를 비교해줘.",
      "Viking이 늘린 헬스케어·기술 종목의 규제와 비용 리스크를 정리해줘.",
      "줄어든 종목에서 실적 둔화가 공시에 보이는지 확인해줘.",
      "Viking 포트폴리오의 sector 이동이 방어적인지 공격적인지 판단해줘.",
    ],
    questionsEn: [
      "Compare Viking top holdings as growth names versus quality names using filing evidence.",
      "Summarize regulatory and cost risks for healthcare and technology names Viking increased.",
      "Check whether reduced names show performance deceleration in filings.",
      "Assess whether Viking sector shifts look defensive or offensive.",
    ],
    limitsKo: [
      "Viking의 short book과 hedge는 13F에 나오지 않아 순노출을 알 수 없습니다.",
      "롱 포지션만 보고 전체 투자 방향을 단정하면 안 됩니다.",
    ],
    limitsEn: [
      "Viking's short book and hedges are not visible in 13F, so net exposure is unknown.",
      "Long positions alone should not be treated as the full investment stance.",
    ],
  },
  "0001061165": {
    slug: "lone-pine-capital",
    shortNameKo: "Lone Pine Capital",
    shortNameEn: "Lone Pine Capital",
    personKo: "스티브 맨델",
    personEn: "Steve Mandel",
    focusKo: "스티브 맨델 Lone Pine Capital의 13F 보유 현황",
    focusEn: "Steve Mandel's Lone Pine Capital 13F holdings",
    profileKo:
      "Lone Pine 13F는 고품질 성장주, 인터넷 플랫폼, 소비·기술 노출을 통해 장기 compounding thesis를 확인하기 좋습니다.",
    profileEn:
      "Lone Pine's 13F is useful for reading quality-growth and long-term compounding theses across internet, consumer, and technology holdings.",
    watchPointsKo: [
      "고품질 성장주가 매출 성장과 마진 방어를 동시에 보여주는지",
      "소비·인터넷 플랫폼 노출이 경기 둔화에 얼마나 민감한지",
      "새로 늘린 종목의 장기 compounding 근거가 공시에 있는지",
    ],
    watchPointsEn: [
      "Whether quality-growth holdings show both revenue growth and margin durability.",
      "How sensitive consumer and internet platform exposure is to macro slowdown.",
      "Whether newly increased names have filing evidence for long-term compounding.",
    ],
    questionsKo: [
      "Lone Pine 상위 보유 종목의 장기 compounding 근거를 공시 기준으로 비교해줘.",
      "스티브 맨델이 늘린 소비·인터넷 기업의 경기 둔화 리스크를 봐줘.",
      "Lone Pine 포트폴리오에서 마진 방어력이 약한 회사를 걸러줘.",
      "신규 또는 증가 종목 중 성장과 현금흐름이 같이 좋은 회사를 골라줘.",
    ],
    questionsEn: [
      "Compare long-term compounding evidence across Lone Pine top holdings.",
      "Review macro slowdown risks for consumer and internet companies Steve Mandel increased.",
      "Filter Lone Pine holdings with weaker margin durability.",
      "Find new or increased names with both growth and cash-flow support.",
    ],
    limitsKo: [
      "Lone Pine의 13F는 long exposure만 보여주며 short와 hedge는 확인할 수 없습니다.",
      "품질 성장주 thesis는 valuation 리스크와 사업 근거를 분리해서 봐야 합니다.",
    ],
    limitsEn: [
      "Lone Pine's 13F shows long exposure only; shorts and hedges are not visible.",
      "Quality-growth theses require separating valuation risk from business evidence.",
    ],
  },
};

export interface Curated13FManagerPage {
  manager: Known13FManager;
  slug: string;
  shortName: string;
  personName: string | null;
  focus: string;
  profile: string;
  watchPoints: string[];
  questions: string[];
  limits: string[];
}

export function listCurated13FManagerPages(
  locale: Locale = "ko",
): Curated13FManagerPage[] {
  return KNOWN_13F_MANAGERS.map((manager) => managerPageFromKnown(manager, locale));
}

export function findCurated13FManagerPageBySlug(
  slug: string,
  locale: Locale = "ko",
): Curated13FManagerPage | null {
  return (
    listCurated13FManagerPages(locale).find((page) => page.slug === slug) ?? null
  );
}

export function findCurated13FManagerPageByCik(
  cik: string,
  locale: Locale = "ko",
): Curated13FManagerPage | null {
  return (
    listCurated13FManagerPages(locale).find((page) => page.manager.cik === cik) ??
    null
  );
}

export function allCurated13FManagerSlugs(): string[] {
  return listCurated13FManagerPages().map((page) => page.slug);
}

function managerPageFromKnown(
  manager: Known13FManager,
  locale: Locale,
): Curated13FManagerPage {
  const copy = MANAGER_SEO_COPY_BY_CIK[manager.cik] ?? fallbackCopy(manager);
  return {
    manager,
    slug: copy.slug,
    shortName: locale === "ko" ? copy.shortNameKo : copy.shortNameEn,
    personName: locale === "ko" ? copy.personKo ?? null : copy.personEn ?? null,
    focus: locale === "ko" ? copy.focusKo : copy.focusEn,
    profile: locale === "ko" ? copy.profileKo : copy.profileEn,
    watchPoints: locale === "ko" ? copy.watchPointsKo : copy.watchPointsEn,
    questions: locale === "ko" ? copy.questionsKo : copy.questionsEn,
    limits: locale === "ko" ? copy.limitsKo : copy.limitsEn,
  };
}

function fallbackCopy(manager: Known13FManager): ManagerSeoCopy {
  return {
    slug: manager.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    shortNameKo: manager.displayName.split("/")[0]?.trim() || manager.name,
    shortNameEn: manager.name,
    focusKo: `${manager.displayName} 13F 보유 공시`,
    focusEn: `${manager.name} 13F holdings`,
    profileKo: `${manager.displayName}의 13F 보유 공시를 manager별 리서치 출발점으로 정리합니다.`,
    profileEn: `${manager.name} 13F holdings are organized as a starting point for follow-up company research.`,
    watchPointsKo: [
      "상위 보유 종목과 분기 비중 변화",
      "신규 편입 또는 큰 폭 감소 종목",
      "KRW에서 공시 기반으로 이어서 확인할 수 있는 회사",
    ],
    watchPointsEn: [
      "Top holdings and quarterly weight changes.",
      "New positions or large reductions.",
      "Companies available for filing-grounded follow-up research in KRW.",
    ],
    questionsKo: [
      `${manager.displayName} 상위 보유 종목의 사업 근거를 정리해줘.`,
      "신규 편입 종목 중 먼저 확인할 회사를 골라줘.",
      "비중 감소 종목에서 리스크 신호가 있는지 봐줘.",
      "13F 변화가 공시 리서치로 이어지는 질문을 만들어줘.",
    ],
    questionsEn: [
      `Summarize business evidence behind ${manager.name}'s top holdings.`,
      "Pick newly added positions to review first.",
      "Check whether reduced positions show risk signals.",
      "Turn 13F changes into filing research questions.",
    ],
    limitsKo: [
      "13F는 보고 기준일의 과거 보유 스냅샷입니다.",
      "공매도, 파생, 비공개 처리 항목은 보이지 않을 수 있습니다.",
    ],
    limitsEn: [
      "13F is a historical report-period snapshot.",
      "Shorts, derivatives, and confidential treatment items may not be visible.",
    ],
  };
}
