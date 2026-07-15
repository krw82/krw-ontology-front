export const DEFAULT_13F_MANAGER_CIK = "0001608046";
export const INSTITUTIONAL_HOLDINGS_DISPLAY_LIMIT = 30;

export interface Known13FManager {
  cik: string;
  name: string;
  displayName: string;
  countryCode: string;
  notes: string;
}

export const KNOWN_13F_MANAGERS: Known13FManager[] = [
  {
    cik: DEFAULT_13F_MANAGER_CIK,
    name: "National Pension Service",
    displayName: "국민연금공단 / National Pension Service",
    countryCode: "KR",
    notes: "Korea National Pension Service 13F filer on SEC EDGAR.",
  },
  {
    cik: "0002012383",
    name: "BlackRock, Inc.",
    displayName: "블랙록 / BlackRock, Inc.",
    countryCode: "US",
    notes: "BlackRock 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001067983",
    name: "Berkshire Hathaway Inc",
    displayName: "버크셔 해서웨이 / Berkshire Hathaway",
    countryCode: "US",
    notes: "Berkshire Hathaway 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001697748",
    name: "ARK Investment Management LLC",
    displayName: "캐시 우드 ARK / ARK Investment Management",
    countryCode: "US",
    notes: "Cathie Wood's ARK Investment Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001536411",
    name: "Duquesne Family Office LLC",
    displayName: "드러켄밀러 / Duquesne Family Office",
    countryCode: "US",
    notes: "Stanley Druckenmiller's Duquesne Family Office 13F filer on SEC EDGAR.",
  },
  {
    cik: "0000850529",
    name: "Fisher Asset Management, LLC",
    displayName: "켄 피셔 / Fisher Asset Management",
    countryCode: "US",
    notes: "Ken Fisher's Fisher Asset Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001336528",
    name: "Pershing Square Capital Management, L.P.",
    displayName: "빌 애크먼 / Pershing Square",
    countryCode: "US",
    notes: "Bill Ackman's Pershing Square Capital Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001656456",
    name: "Appaloosa LP",
    displayName: "데이비드 테퍼 / Appaloosa",
    countryCode: "US",
    notes: "David Tepper's Appaloosa 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001061768",
    name: "Baupost Group LLC/MA",
    displayName: "세스 클라먼 / Baupost Group",
    countryCode: "US",
    notes: "Seth Klarman's Baupost Group 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001040273",
    name: "Third Point LLC",
    displayName: "댄 로브 / Third Point",
    countryCode: "US",
    notes: "Dan Loeb's Third Point 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001029160",
    name: "Soros Fund Management LLC",
    displayName: "조지 소로스 / Soros Fund Management",
    countryCode: "US",
    notes: "George Soros's Soros Fund Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001135730",
    name: "Coatue Management LLC",
    displayName: "필립 라퐁 / Coatue",
    countryCode: "US",
    notes: "Philippe Laffont's Coatue Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001167483",
    name: "Tiger Global Management LLC",
    displayName: "체이스 콜먼 / Tiger Global",
    countryCode: "US",
    notes: "Chase Coleman's Tiger Global Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001103804",
    name: "Viking Global Investors LP",
    displayName: "안드레아스 할보르센 / Viking Global",
    countryCode: "US",
    notes: "Andreas Halvorsen's Viking Global Investors 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001061165",
    name: "Lone Pine Capital LLC",
    displayName: "스티브 맨델 / Lone Pine Capital",
    countryCode: "US",
    notes: "Steve Mandel's Lone Pine Capital 13F filer on SEC EDGAR.",
  },
];

export interface Parsed13FHolding {
  issuerName: string;
  titleOfClass: string;
  cusip: string;
  valueUsd: number;
  shares: number | null;
  shareType: string | null;
  putCall: string | null;
  investmentDiscretion: string | null;
  otherManager: string | null;
  votingAuthoritySole: number | null;
  votingAuthorityShared: number | null;
  votingAuthorityNone: number | null;
}

export interface Sec13FFilingPackage {
  cik: string;
  managerName: string;
  accessionNumber: string;
  form: "13F-HR" | "13F-HR/A";
  filingDate: string;
  reportPeriod: string;
  acceptedAt: string | null;
  filingDetailUrl: string;
  primaryDocumentUrl: string | null;
  informationTableUrl: string;
  holdings: Parsed13FHolding[];
}

export type PositionChangeType =
  | "new"
  | "increased"
  | "decreased"
  | "unchanged"
  | "sold";

export interface InstitutionalHoldingView {
  id: string;
  issuerName: string;
  displayName: string;
  titleOfClass: string;
  cusip: string;
  ticker: string | null;
  valueUsd: number;
  shares: number | null;
  sharesChange: number | null;
  sharesChangePct: number | null;
  portfolioWeight: number;
  previousPortfolioWeight: number | null;
  portfolioWeightChange: number | null;
  previousValueUsd: number | null;
  valueChangeUsd: number | null;
  valueChangePct: number | null;
  changeType: PositionChangeType;
  chatHref: string | null;
}

export interface InstitutionalHoldingShareTrend {
  issuerName: string;
  displayName: string;
  titleOfClass: string;
  cusip: string;
  ticker: string | null;
  sharesByReportPeriod: Record<string, number | null>;
}

export interface InstitutionalTickerActivity {
  cik: string;
  managerName: string;
  managerDisplayName: string | null;
  reportPeriod: string;
  changeType: PositionChangeType;
  valueUsd: number;
  previousValueUsd: number | null;
  shares: number | null;
}

export interface InstitutionalHoldingsDashboard {
  managers: Known13FManager[];
  selectedCik: string;
  displayLimit: number;
  manager: {
    cik: string;
    name: string;
    displayName: string | null;
    countryCode: string | null;
    notes: string | null;
    latestRefreshAt: string | null;
  };
  filing: {
    id: string;
    accessionNumber: string;
    form: string;
    reportPeriod: string;
    filingDate: string;
    acceptedAt: string | null;
    filingDetailUrl: string;
    informationTableUrl: string;
    entryCount: number;
    totalValueUsd: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  previousFiling: {
    id: string;
    reportPeriod: string;
    filingDate: string;
    totalValueUsd: number;
  } | null;
  stats: {
    totalPositions: number;
    totalValueUsd: number;
    newPositions: number;
    increasedPositions: number;
    decreasedPositions: number;
    unchangedPositions: number;
    soldPositions: number;
    top10Weight: number;
  };
  rebalancing: {
    buys: InstitutionalHoldingView[];
    sells: InstitutionalHoldingView[];
  };
  shareTrend: {
    filings: Array<{
      id: string;
      reportPeriod: string;
    }>;
    rows: InstitutionalHoldingShareTrend[];
  };
  holdings: InstitutionalHoldingView[];
}
