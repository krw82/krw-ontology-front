"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import BillingPlanAction from "@/components/BillingPlanAction";
import ChatArtifacts from "@/components/ChatArtifacts";
import ChatMessage from "@/components/ChatMessage";
import CompaniesBrowser from "@/components/CompaniesBrowser";
import CompanyCard, { type CompanyCardData } from "@/components/CompanyCard";
import CompanyWatchlistActions from "@/components/CompanyWatchlistActions";
import Composer, {
  type ComposerSendOptions,
  type ComposerSendResult,
} from "@/components/Composer";
import EvidenceGraphPreview from "@/components/EvidenceGraphPreview";
import FloatingAskBar from "@/components/FloatingAskBar";
import {
  EvidenceCardItem,
  EvidenceCardsStagger,
  HeroEyebrow,
  HeroHeading,
  HeroSubtext,
  InsightBlock,
  QuestionFormEntrance,
  TraceCardEntrance,
  WorkflowSteps,
} from "@/components/HeroSection";
import {
  HomeEvidenceCards,
  HomeHeaderActions,
  HomePrimaryCtas,
  HomeQuestionForm,
  HomeTraceExplorer,
  type HomeEvidenceCard,
  type HomeTraceNode,
} from "@/components/HomeInteractions";
import { KrwBrand, KrwMark } from "@/components/KrwBrand";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import QuestionChainGraph from "@/components/QuestionChainGraph";
import QueueRemotionAnimation from "@/components/QueueRemotionAnimation";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import ResearchProgress from "@/components/ResearchProgress";
import RunStatusDock from "@/components/RunStatusDock";
import { ShareOgImage } from "@/components/ShareOgImage";
import ShareStartLink from "@/components/ShareStartLink";
import SharedAnswerPageContent from "@/components/SharedAnswerPageContent";
import SuggestedPromptActions from "@/components/SuggestedPromptActions";
import TopNav from "@/components/TopNav";
import UsageStatus from "@/components/UsageStatus";
import WatchlistHomeClient from "@/components/watchlist/WatchlistHomeClient";
import type { ToolCallState } from "@/hooks/useChat";
import type { QuestionTopicPage } from "@/lib/marketing/site";
import type { PublicMessageShare } from "@/lib/share/message-share";
import type { ShareOgCopy } from "@/lib/share/share-og";
import type {
  AtomicNewsEventCard,
  ChatArtifact,
  ChatArtifactSelection,
  ChatCitation,
  ResearchActivityUpdate,
  WatchlistOverviewResponse,
} from "@/types/api-contracts";
import type { EntitlementStatus } from "@/types/entitlement";

type ComposerPreview = {
  content: string;
  userUrls: string[];
};

type CoverageState = "rendered" | "covered" | "runtime" | "nonVisual";

type CoverageItem = {
  name: string;
  state: CoverageState;
  section: string;
  note: string;
};

const sampleUserUrls = [
  "https://www.apple.com/newsroom/2026/06/apple-previews-major-software-updates/",
];
const sampleNowIso = "2026-06-21T15:00:00.000Z";
const sampleTenMinutesAgoIso = "2026-06-21T14:50:00.000Z";
const sampleOneDayAgoIso = "2026-06-20T15:00:00.000Z";
const sampleTwoDaysAgoIso = "2026-06-19T15:00:00.000Z";
const samplePeriodStartIso = "2026-06-19T00:00:00.000Z";
const samplePeriodEndIso = "2026-06-26T00:00:00.000Z";
const sampleQueuedAtIso = "2026-06-21T14:58:30.000Z";
const sampleRunStartedAt = "2026-06-21T14:59:15.000Z";
const sampleWorkDurationMs = 45_000;
const sampleToolStartedAt = Date.parse("2026-06-21T14:59:15.000Z");
const sampleToolFinishedAt = Date.parse("2026-06-21T14:59:16.500Z");
const sampleRunningToolStartedAt = Date.parse("2026-06-21T14:59:48.000Z");

const sampleCompanies: CompanyCardData[] = [
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    companyNameKo: "애플",
    sector: "기술",
    description: "아이폰 매출과 프로 모델 수요의 가격·물량 기여",
    core_strength: "서비스 및 앱스토어 구독·거래형 수익 구조",
    critical_risk: "중화권과 지역별 매출 흐름, 규제 리스크",
    coverage: "12개 공시 인덱싱 · 10-K, 10-Q · 최신 FY2026Q1",
  },
  {
    ticker: "NVDA",
    name: "NVIDIA Corporation",
    companyNameKo: "엔비디아",
    sector: "반도체",
    description: "AI 데이터센터 GPU 수요와 네트워킹 매출 흐름",
    core_strength: "데이터센터 GPU와 소프트웨어 생태계",
    critical_risk: "공급 제약, 고객 집중도, 중국 수출 규제",
    coverage: "10개 공시 인덱싱 · 10-K, 10-Q · 최신 FY2026Q1",
  },
  {
    ticker: "ABBV",
    name: "AbbVie Inc.",
    companyNameKo: "애브비",
    sector: "제약",
    description: "휴미라 의존도 축소와 스카이리지·린버크 전환 속도",
    core_strength: "면역질환 포트폴리오 성장",
    critical_risk: "특허 만료, 약가 압력, 경쟁 심화",
    coverage: "9개 공시 인덱싱 · 10-K, 10-Q · 최신 FY2026Q1",
  },
];

const samplePrompts = [
  "AI 데이터센터 투자 확대는 어떤 기업에 가장 큰 수혜인가요?",
  "메모리 가격 상승은 어떤 반도체 기업에 유리한가요?",
  "소비 둔화에도 마진을 방어할 수 있는 기업은 어디인가요?",
];

const sampleMarkdown = [
  "## 핵심 판단",
  "",
  "Apple의 단기 매출은 iPhone 교체 주기보다 Services의 방어력이 더 중요합니다.",
  "",
  "| 항목 | 확인 포인트 |",
  "| --- | --- |",
  "| 제품 | Pro 모델 수요와 가격·물량 기여 |",
  "| 서비스 | 구독형 수익과 App Store 거래형 수익 |",
  "",
  "> 공시 근거가 없는 추정은 별도로 표시해야 합니다.",
].join("\n");

const sampleActivityRunning: ResearchActivityUpdate = {
  stage: "researching",
  label: "공시 근거 확인 중",
};

const sampleActivityQueued: ResearchActivityUpdate = {
  stage: "queued",
  label: "대기열에 추가됨",
  queue: {
    queued_ahead: 2,
    running_count: 1,
    concurrency_limit: 1,
    queued_at: sampleQueuedAtIso,
  },
};

const sampleToolCalls: ToolCallState[] = [
  {
    tool_call_id: "tool-1",
    tool_name: "krw_ontology_company_context",
    status: "completed",
    result_summary: "AAPL 사업·재무 컨텍스트 확인",
    duration_ms: 1430,
    started_at: sampleToolStartedAt,
    finished_at: sampleToolFinishedAt,
  },
  {
    tool_call_id: "tool-2",
    tool_name: "krw_ontology_retrieve",
    status: "running",
    arguments: { ticker: "AAPL", query: "services margin revenue" },
    started_at: sampleRunningToolStartedAt,
  },
];

const sampleCitations: ChatCitation[] = [
  {
    ticker: "AAPL",
    document_type: "annual_report",
    period: "FY2025",
    section: "Management Discussion",
    quote_text:
      "Services net sales increased year over year driven by broad-based growth.",
    claim_text: "서비스 매출은 전년 대비 성장했습니다.",
    evidence_grade: "high",
    source_quality: "filing_direct",
    object_id: "dev-citation-1",
    trace_json: { path: ["company", "services", "net sales"] },
  },
];

const sampleNewsEvents: AtomicNewsEventCard[] = [
  {
    id: "event-positive",
    ticker: "AAPL",
    company_name: "Apple Inc.",
    event_title: "Apple previews major software updates",
    event_title_ko: "애플이 주요 소프트웨어 업데이트를 공개",
    original_headline: "Apple previews major software updates",
    short_summary:
      "새로운 OS 업데이트가 기기 교체 수요와 서비스 사용량에 영향을 줄 수 있습니다.",
    summary_ko:
      "새 OS 기능은 iPhone·Mac 사용 경험을 강화하고 서비스 체류 시간을 늘릴 수 있습니다.",
    price_impact_direction: "positive",
    investment_axes: ["demand", "services", "margin"],
    primary_source: {
      title: "Apple previews major software updates",
      title_ko: "애플이 주요 소프트웨어 업데이트를 공개",
      url: sampleUserUrls[0],
      domain: "apple.com",
      publisher: "Apple Newsroom",
      published_at: sampleOneDayAgoIso,
    },
    ui: {
      badge_ko: "수요 확인",
      button_label_ko: "이 뉴스로 리서치",
    },
  },
  {
    id: "event-mixed",
    ticker: "AAPL",
    company_name: "Apple Inc.",
    event_title: "Regulators review app store policies",
    event_title_ko: "규제 당국이 앱스토어 정책을 검토",
    original_headline: "Regulators review app store policies",
    short_summary:
      "앱스토어 수수료와 결제 정책은 서비스 매출의 질을 다시 점검하게 합니다.",
    summary_ko:
      "규제 변화는 Services 성장률과 마진에 혼재된 영향을 줄 수 있습니다.",
    price_impact_direction: "mixed",
    investment_axes: ["risk_factors", "operating_margin", "competition"],
    primary_source: {
      title: "Regulators review app store policies",
      url: "https://example.com/regulatory-review",
      domain: "example.com",
      publisher: "Example News",
      published_at: sampleTwoDaysAgoIso,
    },
    ui: {
      badge_ko: "규제 변수",
      button_label_ko: "리스크로 확인",
    },
  },
];

const sampleArtifact: ChatArtifact = {
  id: "artifact-news-selection",
  session_id: "dev-session",
  message_id: "dev-message",
  run_id: "dev-run",
  type: "news_event_selection",
  payload_json: {
    kind: "news_event_selection",
    version: 1,
    original_question: "이 URL 내용이 애플에 어떤 의미인지 봐줘.",
    events: sampleNewsEvents,
  },
  created_at: sampleNowIso,
};

const sampleArtifactSelections: ChatArtifactSelection[] = [
  {
    id: "selection-1",
    artifact_id: sampleArtifact.id,
    session_id: "dev-session",
    event_id: "event-positive",
    selected_payload_json: {},
    user_message_id: null,
    research_run_id: null,
    status: "completed",
    created_at: sampleNowIso,
  },
];

const baseEntitlement: EntitlementStatus = {
  status: "standard",
  plan: {
    key: "pro",
    label: "Pro",
    status_label: "활성",
    description: "가장 높은 공개 플랜",
  },
  usage: {
    period: "weekly",
    period_label: "이번 주",
    period_start: samplePeriodStartIso,
    period_end: samplePeriodEndIso,
    budget_used_usd: 12,
    budget_reserved_usd: 1,
    budget_limit_usd: 20,
    remaining_budget_usd: 7,
    daily_budget_used_usd: 3,
    daily_budget_reserved_usd: 0,
    daily_budget_limit_usd: 10,
    per_run_reserve_usd: 1,
    credits_used_raw: 6_400_000,
    credits_reserved_raw: 0,
    credits_limit_raw: 10_000_000,
    credits_remaining_raw: 3_600_000,
    credits_used_display: 64,
    credits_reserved_display: 0,
    credits_limit_display: 100,
    credits_remaining_display: 36,
    analysis_credits_used: 64,
    analysis_credits_reserved: 0,
    analysis_credits_limit: 100,
    remaining_analysis_credits: 36,
    daily_analysis_credits_used: 8,
    daily_analysis_credits_reserved: 0,
    daily_analysis_credits_limit: 30,
    per_run_analysis_credits: 1,
    run_count: 8,
    percent_used: 64,
    alert_level: "ok",
    can_run: true,
    unlimited: false,
    resets_at: samplePeriodEndIso,
  },
  features: [],
  upgrade: {
    label: "업그레이드",
    href: "/pricing",
    enabled: false,
    title: "Pro 사용 중",
    message: "현재 가장 높은 공개 플랜입니다.",
  },
};

const warningEntitlement: EntitlementStatus = {
  ...baseEntitlement,
  plan: { ...baseEntitlement.plan, key: "standard", label: "Standard" },
  usage: {
    ...baseEntitlement.usage,
    percent_used: 92,
    alert_level: "warning",
    remaining_analysis_credits: 8,
    credits_remaining_raw: 800_000,
  },
  upgrade: {
    label: "Pro 보기",
    href: "/pricing",
    enabled: true,
    title: "분석량이 거의 다 찼습니다.",
    message: "Pro로 올리면 더 넓은 분석을 이어갈 수 있습니다.",
  },
};

const blockedEntitlement: EntitlementStatus = {
  ...baseEntitlement,
  plan: { ...baseEntitlement.plan, key: "free", label: "Free" },
  usage: {
    ...baseEntitlement.usage,
    percent_used: 100,
    alert_level: "blocked",
    can_run: false,
    remaining_analysis_credits: 0,
    credits_remaining_raw: 0,
  },
  upgrade: {
    label: "업그레이드",
    href: "/pricing",
    enabled: true,
    title: "이번 주 분석 한도를 모두 사용했습니다.",
    message: "다음 충전 전까지 기존 리서치와 노트북은 계속 볼 수 있습니다.",
  },
};

const sampleQuestionTopic: QuestionTopicPage = {
  slug: "revenue-growth",
  title: "매출 성장은 어디서 나왔는가?",
  shortTitle: "매출 성장",
  description:
    "제품, 서비스, 가격, 물량, 지역 요인을 나눠 매출 성장의 근거를 확인합니다.",
  question: "매출 성장은 어디서 나왔어?",
  category: "실적 동인",
  questionChain: {
    ticker: "AAPL",
    companyName: "Apple",
    title: "Apple 매출 성장 질문 흐름",
    description:
      "제품·서비스·지역별 매출 흐름을 단계적으로 좁혀 확인합니다.",
    primaryQuestion:
      "Apple의 iPhone과 Services 매출 성장이 어디서 나왔는지 공시 기준으로 정리해줘.",
    stages: [
      {
        id: "stage-1",
        label: "매출 분해",
        nodes: [
          {
            id: "q1",
            title: "제품별 매출",
            question: "iPhone, Mac, iPad, Services 매출 변화는?",
            answerHint: "제품군별 순매출",
          },
          {
            id: "q2",
            title: "지역별 흐름",
            question: "Americas, Europe, Greater China 매출 흐름은?",
          },
        ],
      },
      {
        id: "stage-2",
        label: "마진 연결",
        nodes: [
          {
            id: "q3",
            title: "믹스 효과",
            question: "제품·서비스 믹스가 매출총이익률에 준 영향은?",
          },
        ],
      },
      {
        id: "stage-3",
        label: "리스크 확인",
        nodes: [
          {
            id: "q4",
            title: "수요 리스크",
            question: "중국 수요와 규제 리스크가 성장 논지를 흔드는가?",
          },
        ],
      },
    ],
  },
  userProblem: "실적 숫자를 읽었지만 성장의 질을 빠르게 분해하고 싶을 때",
  bestFor: ["실적 발표 직후 성장 동인 확인", "매출과 마진 연결 점검"],
  notFor: ["단기 주가 예측"],
  evidenceTargets: ["10-K", "10-Q", "MD&A"],
  promptVariants: ["제품별로 나눠줘", "지역별로 비교해줘"],
  expectedAnswerShape: ["매출 분해", "마진 연결", "리스크"],
  exampleTickers: ["AAPL", "MSFT"],
  answerBlocks: ["요약", "근거", "다음 질문"],
  relatedUseCaseSlugs: [],
  relatedQuestionSlugs: [],
  seoKeywords: ["AAPL revenue", "Apple services"],
};

const homeEvidenceCards: HomeEvidenceCard[] = [
  {
    id: "source",
    label: "SOURCE",
    value: "10-K / 10-Q",
    detail: "공시 문서에서 직접 확인할 근거를 먼저 잡습니다.",
  },
  {
    id: "node",
    label: "NODE",
    value: "Services revenue",
    detail: "사업 활동과 재무 항목을 연결합니다.",
  },
  {
    id: "path",
    label: "PATH",
    value: "Revenue -> Margin",
    detail: "답변의 주장과 원문 근거 사이의 경로를 보여줍니다.",
  },
];

const homeTraceNodes: HomeTraceNode[] = [
  {
    id: "filing",
    label: "공시",
    mobileLabel: "공시",
    eyebrow: "SOURCE",
    title: "10-K Services 매출",
    detail: "제품별 매출과 서비스 매출을 분리합니다.",
    quote: "Services net sales increased year over year.",
  },
  {
    id: "segment",
    label: "사업",
    mobileLabel: "사업",
    eyebrow: "NODE",
    title: "구독·거래형 수익",
    detail: "반복 매출과 거래 수수료를 나눠 봅니다.",
    quote: "Services includes advertising, AppleCare, cloud and payment services.",
  },
  {
    id: "driver",
    label: "답변",
    mobileLabel: "답변",
    eyebrow: "ANSWER",
    title: "마진 방어력",
    detail: "제품 수요 둔화 시에도 서비스 믹스가 마진을 보완할 수 있습니다.",
    quote: "Gross margin is affected by product and service mix.",
  },
];

const sampleShare: PublicMessageShare = {
  token: "dev-share-token",
  answer_content:
    "Apple의 매출은 iPhone 교체 수요와 Services 성장률을 나눠 봐야 합니다.\n\n- 제품 매출은 지역별 수요 편차를 확인합니다.\n- Services는 반복 매출과 규제 리스크를 같이 봅니다.",
  question_content: "Apple의 매출 성장은 어디서 나왔어?",
  question_created_at: sampleTenMinutesAgoIso,
  question_attachments: { urls: [], files: [] },
  answer_created_at: sampleNowIso,
  tickers: ["AAPL"],
  share_context: { run_kind: null, guru_lens: null },
  title: "Apple 매출 성장 리서치 답변",
  created_at: sampleNowIso,
  locale: "ko",
};

const sampleOgCopy: ShareOgCopy = {
  locale: "ko",
  title: "Apple 매출 성장 리서치 답변",
  description: "Apple의 매출 성장은 어디서 나왔어?",
  kicker: "공유 리서치 답변",
  footer: "공유 답변 · 공시 기반 리서치",
  brandName: "KRW.O",
  primaryTicker: "AAPL",
  companyName: "Apple",
  tickerLine: "AAPL · Apple",
  alt: "Apple 매출 성장 리서치 답변 | KRW.O",
};

const watchlistOverview: WatchlistOverviewResponse = {
  companies: sampleCompanies.slice(0, 2).map((company, index) => ({
    ticker: company.ticker,
    name: company.name,
    companyNameKo: company.companyNameKo,
    sector: company.sector ?? null,
    description: company.description,
    latest_period: "FY2026Q1",
    coverage: company.coverage ?? "10개 공시 인덱싱",
    document_count: 10,
    document_types: ["10-K", "10-Q"],
    notebook_preview:
      index === 0
        ? "서비스 매출 방어력과 iPhone 수요 편차를 계속 추적합니다."
        : "AI 데이터센터 수요, 공급망, 고객 집중도를 확인합니다.",
    mark: {
      user_id: "dev-user",
      ticker: company.ticker,
      is_watchlisted: true,
      is_holding: index === 0,
      priority: index,
      interest_reason: "핵심 리서치 대상",
      tags: index === 0 ? ["서비스", "마진"] : ["AI", "데이터센터"],
      last_activity_at: sampleNowIso,
      created_at: sampleNowIso,
      updated_at: sampleNowIso,
    },
    open_question_count: index + 1,
    note_count: index + 2,
    recent_chat_count: index + 1,
    latest_activity_at: sampleNowIso,
    research_status: index === 0 ? "has_open_questions" : "ready",
    research_status_label: index === 0 ? "확인할 질문 있음" : "준비됨",
    research_status_reason: index === 0 ? "open_questions" : null,
    notebook_updated_at: sampleNowIso,
    notebook_age_days: index,
  })),
  research_inbox: [
    {
      ticker: "AAPL",
      company_name: "Apple Inc.",
      status: "has_open_questions",
      status_label: "확인할 질문 있음",
      reason: "open_questions",
      title: "Services 성장률과 규제 리스크를 다시 확인하세요.",
      description: "최근 대화에서 App Store 정책 변화가 미해결 질문으로 남았습니다.",
      current_question_id: "question-1",
      current_question: "App Store 규제가 Services 마진에 어떤 영향을 주나요?",
      dismiss_question_id: "question-1",
      action_label: "질문 열기",
      action_href: "/chat/new?ticker=AAPL",
      secondary_action_label: "회사 보기",
      secondary_action_href: "/ko/companies/AAPL",
      priority: 1,
      age_days: 1,
      open_question_count: 1,
    },
  ],
  stats: {
    total: 2,
    watchlisted: 2,
    holding: 1,
    open_questions: 1,
    notes: 5,
    recent_activity: 2,
  },
};

const coverageItems: CoverageItem[] = [
  { name: "AppShell", state: "runtime", section: "앱 프레임", note: "루트 레이아웃 래퍼, 페이지에서 직접 실행 중" },
  { name: "AnalyticsBootstrap", state: "nonVisual", section: "분석", note: "비주얼 없는 이벤트 부트스트랩" },
  { name: "BillingPlanAction", state: "rendered", section: "빌링", note: "현재/변경/해지/disabled 상태" },
  { name: "ChatArtifacts", state: "rendered", section: "채팅", note: "뉴스 선택 아티팩트와 선택 상태" },
  { name: "ChatMessage", state: "rendered", section: "채팅", note: "유저/URL/파일/응답/오류/스트리밍" },
  { name: "ChatSidebar", state: "runtime", section: "채팅", note: "API 기반 기록 패널, 실제 앱에서 확인" },
  { name: "CompaniesBrowser", state: "rendered", section: "회사", note: "검색, 조건별 기업 검색 CTA, 리스트" },
  { name: "CompanyCard", state: "rendered", section: "회사", note: "ko/en, 모바일/데스크톱 반응형" },
  { name: "CompanyWatchlistActions", state: "rendered", section: "회사", note: "로그아웃/관심/보유 상태" },
  { name: "Composer", state: "rendered", section: "입력", note: "기본, URL, 파일 메뉴, 전송 샌드박스" },
  { name: "EvidenceGraphPreview", state: "rendered", section: "근거", note: "citation/tool call 기반 그래프" },
  { name: "FloatingAskBar", state: "rendered", section: "입력", note: "고정 질문 바" },
  { name: "HeroSection exports", state: "rendered", section: "랜딩", note: "헤딩, 서브텍스트, 스텝, 카드 entrance" },
  { name: "HomeInteractions exports", state: "rendered", section: "랜딩", note: "CTA, 질문 폼, evidence cards, trace explorer" },
  { name: "KrwBrand / KrwMark", state: "rendered", section: "브랜드", note: "compact/dark/mark" },
  { name: "LocaleSwitcher", state: "rendered", section: "내비게이션", note: "compact/full" },
  { name: "MarketingCtaLink", state: "rendered", section: "내비게이션", note: "tracking CTA 링크" },
  { name: "PublicRelatedLinks", state: "rendered", section: "공개 페이지", note: "관련 링크 카드" },
  { name: "PublicTopNav", state: "rendered", section: "공개 페이지", note: "공개 nav 전체" },
  { name: "QuestionChainGraph", state: "rendered", section: "공개 페이지", note: "질문 그래프" },
  { name: "QueueRemotionAnimation", state: "rendered", section: "상태", note: "compact/regular" },
  { name: "ResearchMarkdown", state: "rendered", section: "답변", note: "헤딩, 표, 인용, 링크" },
  { name: "ResearchProgress", state: "rendered", section: "상태", note: "running/queued" },
  { name: "RunStatusDock", state: "rendered", section: "상태", note: "running/queued/cancel" },
  { name: "ShareOgImage", state: "rendered", section: "공유", note: "1200x630 OG 렌더러 실제 컴포넌트" },
  { name: "SharePageEvents", state: "nonVisual", section: "공유", note: "비주얼 없는 공유 이벤트 기록" },
  { name: "ShareStartLink", state: "rendered", section: "공유", note: "상단/하단 CTA" },
  { name: "SharedAnswerPageContent", state: "rendered", section: "공유", note: "공유 답변 페이지 전체" },
  { name: "SuggestedPromptActions", state: "rendered", section: "입력", note: "active prompt cycle" },
  { name: "TopNav", state: "rendered", section: "내비게이션", note: "앱 nav, 액션 슬롯, 사이드바 트리거" },
  { name: "UsageStatus", state: "rendered", section: "빌링", note: "composer/menu/panel + ok/warning/blocked" },
  { name: "WatchlistHomeClient", state: "rendered", section: "노트북", note: "개인 리서치 홈" },
  { name: "WatchlistWorkspaceClient", state: "runtime", section: "노트북", note: "mount 시 API polling 필요, 실제 앱에서 확인" },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-base border-t border-hairline py-xl first:border-t-0 first:pt-0">
      <div className="grid gap-1">
        <p className="font-mono text-[12px] font-black uppercase tracking-[0.18em] text-primary">
          dev preview
        </p>
        <h2 className="text-[24px] font-black leading-tight text-ink">
          {title}
        </h2>
        <p className="max-w-3xl text-[14px] font-semibold leading-6 text-muted">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function PreviewCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "min-w-0 rounded-[8px] border border-hairline bg-canvas p-base",
        className,
      ].join(" ")}
    >
      <p className="mb-sm font-mono text-[11px] font-black uppercase tracking-[0.14em] text-muted">
        {title}
      </p>
      {children}
    </div>
  );
}

function CoverageBadge({ state }: { state: CoverageState }) {
  const copy = {
    rendered: "렌더됨",
    covered: "커버됨",
    runtime: "런타임",
    nonVisual: "비주얼 없음",
  } satisfies Record<CoverageState, string>;
  const className = {
    rendered: "border-emerald-200 bg-emerald-50 text-emerald-700",
    covered: "border-primary-fixed-dim bg-primary-fixed text-primary",
    runtime: "border-amber-200 bg-amber-50 text-amber-700",
    nonVisual: "border-hairline bg-surface text-muted",
  } satisfies Record<CoverageState, string>;

  return (
    <span
      className={[
        "inline-flex rounded-full border px-2 py-1 text-[11px] font-black leading-none",
        className[state],
      ].join(" ")}
    >
      {copy[state]}
    </span>
  );
}

function CoverageMatrix() {
  return (
    <div className="overflow-x-auto rounded-[8px] border border-hairline bg-canvas">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[minmax(128px,0.8fr)_104px_minmax(110px,0.7fr)_minmax(180px,1.4fr)] border-b border-hairline bg-surface-soft px-sm py-xs font-mono text-[11px] font-black uppercase tracking-[0.12em] text-muted">
          <span>Component</span>
          <span>Status</span>
          <span>Section</span>
          <span>Note</span>
        </div>
        <div className="divide-y divide-hairline">
          {coverageItems.map((item) => (
            <div
              key={item.name}
              className="grid grid-cols-[minmax(128px,0.8fr)_104px_minmax(110px,0.7fr)_minmax(180px,1.4fr)] gap-sm px-sm py-xs text-[12px] leading-5"
            >
              <span className="min-w-0 truncate font-black text-ink">
                {item.name}
              </span>
              <CoverageBadge state={item.state} />
              <span className="min-w-0 truncate font-bold text-body">
                {item.section}
              </span>
              <span className="min-w-0 text-muted">{item.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DevComponentsGallery() {
  const [composerPreview, setComposerPreview] = useState<ComposerPreview>({
    content: "애플의 이익이나 매출이 어떻게 될것같나?",
    userUrls: sampleUserUrls,
  });

  const handleComposerSend = async (
    message: string,
    options?: ComposerSendOptions,
  ): Promise<ComposerSendResult> => {
    setComposerPreview({
      content: message,
      userUrls: options?.userUrls ?? (options?.userUrl ? [options.userUrl] : []),
    });

    return { ok: true };
  };

  return (
    <main id="main-content" className="min-h-[100dvh] bg-canvas px-base py-xl">
      <div className="mx-auto grid w-full max-w-6xl gap-xl">
        <header className="grid gap-2">
          <p className="font-mono text-[12px] font-black uppercase tracking-[0.18em] text-primary">
            development only
          </p>
          <h1 className="text-[34px] font-black leading-tight text-ink sm:text-[44px]">
            Component Gallery
          </h1>
          <p className="max-w-3xl text-[16px] font-semibold leading-7 text-muted">
            `src/components`의 시각 컴포넌트와 주요 상태를 한 페이지에서 확인합니다.
            비주얼이 없거나 실제 API polling이 필요한 컴포넌트는 커버리지 표에 따로 표시합니다.
          </p>
        </header>

        <Section
          title="전체 커버리지"
          description="현재 컴포넌트 파일 기준으로 어떤 항목이 직접 렌더링됐고, 어떤 항목이 런타임/비주얼 없음으로 분류됐는지 확인합니다."
        >
          <CoverageMatrix />
        </Section>

        <Section
          title="브랜드와 내비게이션"
          description="앱 상단 네비게이션, 공개 네비게이션, 브랜드 마크, 언어 스위처, CTA 링크 상태를 확인합니다."
        >
          <div className="grid gap-base">
            <PreviewCard title="TopNav">
              <div className="overflow-hidden rounded-[8px] border border-hairline">
                <TopNav
                  hideAccountMenu
                  showSidebarTrigger
                  brandHref="/companies"
                  brandAriaLabel="회사 목록으로 이동"
                  actionSlot={
                    <div className="hidden gap-xs sm:flex">
                      <button className="inline-flex h-10 items-center gap-xs rounded-[8px] border border-primary bg-primary-fixed px-sm text-[13px] font-black text-primary">
                        <span className="material-symbols-outlined text-[18px]">
                          bookmark
                        </span>
                        관심
                      </button>
                      <button className="inline-flex h-10 items-center gap-xs rounded-[8px] border border-primary bg-primary-fixed px-sm text-[13px] font-black text-primary">
                        <span className="material-symbols-outlined text-[18px]">
                          inventory_2
                        </span>
                        보유
                      </button>
                    </div>
                  }
                />
              </div>
            </PreviewCard>

            <PreviewCard title="PublicTopNav">
              <div className="overflow-hidden rounded-[8px] border border-hairline">
                <PublicTopNav locale="ko" />
              </div>
            </PreviewCard>

            <div className="grid gap-base md:grid-cols-3">
              <PreviewCard title="KrwBrand / KrwMark">
                <div className="grid gap-sm">
                  <KrwBrand />
                  <KrwBrand compact />
                  <div className="rounded-[8px] bg-ink p-sm">
                    <KrwBrand dark href="/companies" />
                  </div>
                  <KrwMark className="h-12 w-12" />
                </div>
              </PreviewCard>

              <PreviewCard title="LocaleSwitcher">
                <div className="flex flex-wrap items-center gap-sm">
                  <LocaleSwitcher />
                  <LocaleSwitcher compact />
                </div>
              </PreviewCard>

              <PreviewCard title="Marketing / Share CTA">
                <div className="grid gap-sm">
                  <MarketingCtaLink
                    href="/discover"
                    ctaId="dev_gallery_cta"
                    ctaLabel="조건으로 기업 검색"
                    surface="dev_gallery"
                    className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ink px-4 text-[14px] font-black text-canvas"
                  >
                    조건으로 기업 검색
                  </MarketingCtaLink>
                  <ShareStartLink
                    href="/chat/new"
                    location="bottom"
                    hasQuestion
                    className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-4 text-[14px] font-black text-ink"
                  >
                    다른 질문도 분석 시작
                  </ShareStartLink>
                </div>
              </PreviewCard>
            </div>
          </div>
        </Section>

        <Section
          title="채팅 메시지"
          description="유저 말풍선의 URL/파일 첨부, 어시스턴트 완료/스트리밍/오류 상태를 함께 확인합니다."
        >
          <div className="grid gap-base">
            <PreviewCard title="User message + URL artifact">
              <ChatMessage
                role="user"
                content={composerPreview.content}
                metadata={{ user_urls: composerPreview.userUrls }}
              />
            </PreviewCard>
            <PreviewCard title="User message + file attachment">
              <ChatMessage
                role="user"
                content={[
                  "첨부한 메모 기준으로 애플 매출 질문을 만들어줘.",
                  "",
                  '<attached_file name="aapl-notes.md">',
                  "# Apple notes",
                  "- Services 매출",
                  "- Greater China 수요",
                  "</attached_file>",
                ].join("\n")}
              />
            </PreviewCard>
            <PreviewCard title="Assistant completed">
              <ChatMessage
                role="assistant"
                content={[
                  "URL 자료 기준으로 보면, 애플의 단기 매출은 제품 교체 주기와 서비스 매출의 방어력을 같이 봐야 합니다.",
                  "",
                  "- iPhone 수요는 지역별 가격·물량 기여를 나눠 확인합니다.",
                  "- Services는 구독형 매출과 App Store 거래형 수익을 분리해서 봅니다.",
                  "- 마진은 제품 믹스, R&D·SG&A 효율, 규제 리스크를 함께 비교합니다.",
                ].join("\n")}
                status="completed"
              />
            </PreviewCard>
            <div className="grid gap-base md:grid-cols-2">
              <PreviewCard title="Assistant streaming">
                <ChatMessage
                  role="assistant"
                  content="공시 원문에서 매출 변화와 서비스 매출의 연결 지점을 확인하고 있습니다."
                  isStreaming
                  activity={sampleActivityRunning}
                  toolCalls={sampleToolCalls}
                  workDurationMs={sampleWorkDurationMs}
                  runStartedAt={sampleRunStartedAt}
                />
              </PreviewCard>
              <PreviewCard title="Assistant failed / cancelled">
                <div className="grid gap-base">
                  <ChatMessage role="assistant" content="" status="failed" />
                  <ChatMessage role="assistant" content="" status="cancelled" />
                </div>
              </PreviewCard>
            </div>
          </div>
        </Section>

        <Section
          title="입력 컴포넌트"
          description="컴포저, URL 첨부 패널, 추천 프롬프트, 고정 질문 바를 확인합니다. 컴포저 전송은 실제 API를 부르지 않고 위 샘플 말풍선만 갱신합니다."
        >
          <div className="grid gap-base">
            <PreviewCard title="Composer sandbox">
              <div className="pb-lg">
                <Composer
                  onSend={handleComposerSend}
                  urlModeAvailable
                  placeholder="기업에 대해 질문하세요..."
                />
              </div>
            </PreviewCard>
            <div className="grid gap-base md:grid-cols-2">
              <PreviewCard title="SuggestedPromptActions">
                <SuggestedPromptActions
                  prompts={samplePrompts}
                  groupId="dev-wide-research-prompts"
                  onSelect={(prompt) =>
                    setComposerPreview({ content: prompt, userUrls: [] })
                  }
                />
              </PreviewCard>
              <PreviewCard title="FloatingAskBar bounded preview">
                <div
                  className="relative h-32 overflow-hidden rounded-[8px] border border-hairline bg-surface-soft"
                  style={{ transform: "translateZ(0)" }}
                >
                  <FloatingAskBar selectedTicker="AAPL" />
                </div>
              </PreviewCard>
            </div>
          </div>
        </Section>

        <Section
          title="상태와 진행 표시"
          description="대기열, 진행 중, 하단 dock, 사용량 표시 같은 상태 컴포넌트의 주요 변형입니다."
        >
          <div className="grid gap-base">
            <div className="grid gap-base md:grid-cols-2">
              <PreviewCard title="ResearchProgress running">
                <ResearchProgress
                  isStreaming
                  activity={sampleActivityRunning}
                  toolCalls={sampleToolCalls}
                  workDurationMs={sampleWorkDurationMs}
                  runStartedAt={sampleRunStartedAt}
                />
              </PreviewCard>
              <PreviewCard title="ResearchProgress queued">
                <ResearchProgress
                  isStreaming
                  activity={sampleActivityQueued}
                  toolCalls={[]}
                  runStartedAt={sampleRunStartedAt}
                />
              </PreviewCard>
            </div>
            <div className="grid gap-base md:grid-cols-2">
              <PreviewCard title="RunStatusDock running">
                <RunStatusDock
                  activity={sampleActivityRunning}
                  toolCalls={sampleToolCalls}
                  workDurationMs={sampleWorkDurationMs}
                  runStartedAt={sampleRunStartedAt}
                  onCancel={() => undefined}
                />
              </PreviewCard>
              <PreviewCard title="RunStatusDock queued">
                <RunStatusDock
                  activity={sampleActivityQueued}
                  variant="queued"
                  onCancel={() => undefined}
                />
              </PreviewCard>
            </div>
            <div className="grid gap-base md:grid-cols-3">
              <PreviewCard title="QueueRemotionAnimation">
                <div className="flex items-center gap-lg">
                  <QueueRemotionAnimation size="compact" />
                  <QueueRemotionAnimation size="regular" />
                </div>
              </PreviewCard>
              <PreviewCard title="UsageStatus menu">
                <div className="grid gap-sm">
                  <UsageStatus entitlement={baseEntitlement} variant="menu" />
                  <UsageStatus entitlement={warningEntitlement} variant="menu" />
                  <UsageStatus entitlement={blockedEntitlement} variant="menu" />
                </div>
              </PreviewCard>
              <PreviewCard title="UsageStatus composer">
                <div className="grid gap-sm">
                  <UsageStatus entitlement={baseEntitlement} />
                  <UsageStatus entitlement={blockedEntitlement} />
                </div>
              </PreviewCard>
            </div>
            <div className="grid gap-base md:grid-cols-3">
              <UsageStatus entitlement={baseEntitlement} variant="panel" />
              <UsageStatus entitlement={warningEntitlement} variant="panel" />
              <UsageStatus entitlement={blockedEntitlement} variant="panel" />
            </div>
          </div>
        </Section>

        <Section
          title="근거와 아티팩트"
          description="근거 그래프, 뉴스 선택 아티팩트, 마크다운 답변 렌더러를 확인합니다."
        >
          <div className="grid gap-base">
            <PreviewCard title="EvidenceGraphPreview">
              <EvidenceGraphPreview
                activity={sampleActivityRunning}
                citations={sampleCitations}
                toolCalls={sampleToolCalls}
              />
            </PreviewCard>
            <PreviewCard title="ChatArtifacts news selection">
              <ChatArtifacts
                artifacts={[sampleArtifact]}
                selections={sampleArtifactSelections}
                onSelectNewsEvent={() => undefined}
              />
            </PreviewCard>
            <PreviewCard title="ChatArtifacts disabled">
              <ChatArtifacts
                artifacts={[sampleArtifact]}
                selections={[]}
                disabled
                onSelectNewsEvent={() => undefined}
              />
            </PreviewCard>
            <PreviewCard title="ResearchMarkdown">
              <ResearchMarkdown content={sampleMarkdown} />
            </PreviewCard>
          </div>
        </Section>

        <Section
          title="회사와 목록"
          description="회사 검색/리스트, 개별 카드, 관심·보유 버튼 상태를 확인합니다."
        >
          <div className="grid gap-base">
            <PreviewCard title="CompaniesBrowser">
              <div className="max-h-[780px] overflow-auto rounded-[8px] border border-hairline">
                <CompaniesBrowser initialCompanies={sampleCompanies} locale="ko" />
              </div>
            </PreviewCard>
            <div className="grid gap-base lg:grid-cols-3">
              {sampleCompanies.map((company) => (
                <CompanyCard key={company.ticker} company={company} locale="ko" />
              ))}
            </div>
            <PreviewCard title="CompanyCard English locale">
              <div className="max-w-md">
                <CompanyCard company={sampleCompanies[0]} locale="en" />
              </div>
            </PreviewCard>
            <div className="grid gap-base md:grid-cols-3">
              <PreviewCard title="WatchlistActions logged out">
                <CompanyWatchlistActions
                  ticker="AAPL"
                  isAuthenticated={false}
                  loginHref="/login"
                  destinationHref="/ko/companies/AAPL"
                  labels={{
                    watchlist: "관심",
                    holding: "보유",
                    savedWatchlist: "관심 등록됨",
                    savedHolding: "보유 등록됨",
                    saving: "저장 중",
                    error: "저장하지 못했습니다.",
                  }}
                />
              </PreviewCard>
              <PreviewCard title="WatchlistActions saved watchlist">
                <CompanyWatchlistActions
                  ticker="AAPL"
                  isAuthenticated
                  loginHref="/login"
                  destinationHref="/ko/companies/AAPL"
                  initialSavedAction="watchlist"
                  labels={{
                    watchlist: "관심",
                    holding: "보유",
                    savedWatchlist: "관심 등록됨",
                    savedHolding: "보유 등록됨",
                    saving: "저장 중",
                    error: "저장하지 못했습니다.",
                  }}
                />
              </PreviewCard>
              <PreviewCard title="WatchlistActions saved holding">
                <CompanyWatchlistActions
                  ticker="AAPL"
                  isAuthenticated
                  loginHref="/login"
                  destinationHref="/ko/companies/AAPL"
                  initialSavedAction="holding"
                  labels={{
                    watchlist: "관심",
                    holding: "보유",
                    savedWatchlist: "관심 등록됨",
                    savedHolding: "보유 등록됨",
                    saving: "저장 중",
                    error: "저장하지 못했습니다.",
                  }}
                />
              </PreviewCard>
            </div>
          </div>
        </Section>

        <Section
          title="노트북"
          description="개인 리서치 노트북 홈의 리스트, 인박스, 검색 UI를 확인합니다. 회사별 workspace는 mount 시 API polling이 있어 실제 앱 런타임 항목으로 분류했습니다."
        >
          <div className="max-h-[820px] overflow-auto rounded-[8px] border border-hairline bg-canvas">
            <WatchlistHomeClient overview={watchlistOverview} />
          </div>
        </Section>

        <Section
          title="공개 페이지와 랜딩"
          description="공개 질문 그래프, 관련 링크, 홈 hero/trace interaction 조각을 확인합니다."
        >
          <div className="grid gap-base">
            <PreviewCard title="QuestionChainGraph">
              <QuestionChainGraph topic={sampleQuestionTopic} locale="ko" />
            </PreviewCard>
            <PreviewCard title="PublicRelatedLinks">
              <PublicRelatedLinks currentPath="/companies" locale="ko" />
            </PreviewCard>
            <PreviewCard title="HeroSection exports">
              <HeroEyebrow>Evidence-first company research</HeroEyebrow>
              <HeroHeading
                lines={["공시 근거로", "기업 질문을"]}
                accentLine="바로 추적하세요"
              />
              <HeroSubtext>
                숫자, 사업 활동, 리스크를 원문 근거와 함께 이어서 봅니다.
              </HeroSubtext>
              <WorkflowSteps
                steps={["질문 입력", "공시 근거 탐색", "답변과 경로 확인"]}
              />
              <TraceCardEntrance>
                <div className="mt-base rounded-[8px] border border-hairline bg-surface p-base">
                  TraceCardEntrance wrapper
                </div>
              </TraceCardEntrance>
              <EvidenceCardsStagger>
                <EvidenceCardItem>
                  <div className="py-sm text-[14px] font-bold text-ink">
                    EvidenceCardItem row
                  </div>
                </EvidenceCardItem>
              </EvidenceCardsStagger>
              <InsightBlock>
                <p className="text-[14px] font-semibold leading-6 text-body">
                  InsightBlock은 랜딩 하단의 요약 강조에 사용합니다.
                </p>
              </InsightBlock>
              <QuestionFormEntrance>
                <div className="mt-base rounded-[8px] border border-hairline bg-canvas p-sm">
                  QuestionFormEntrance wrapper
                </div>
              </QuestionFormEntrance>
            </PreviewCard>
            <div className="grid gap-base lg:grid-cols-2">
              <PreviewCard title="HomeInteractions CTAs">
                <div className="grid gap-base">
                  <HomeHeaderActions locale="ko" />
                  <HomePrimaryCtas locale="ko" />
                  <HomeQuestionForm locale="ko" />
                </div>
              </PreviewCard>
              <PreviewCard title="HomeEvidenceCards / HomeTraceExplorer">
                <HomeEvidenceCards cards={homeEvidenceCards} />
                <HomeTraceExplorer nodes={homeTraceNodes} locale="ko" />
              </PreviewCard>
            </div>
          </div>
        </Section>

        <Section
          title="빌링"
          description="플랜 액션의 current, pending, cancel, disabled 상태를 확인합니다."
        >
          <div className="grid gap-base md:grid-cols-4">
            <PreviewCard title="Free current">
              <BillingPlanAction
                planKey="free"
                currentPlanKey="free"
                monthlyPriceKrw={0}
                currentMonthlyPriceKrw={0}
                billingProviderReady={false}
                subscriptionPlanKey={null}
                pendingPlanKey={null}
                cancelAtPeriodEnd={false}
              />
            </PreviewCard>
            <PreviewCard title="Pro current">
              <BillingPlanAction
                planKey="pro"
                currentPlanKey="pro"
                monthlyPriceKrw={29_000}
                currentMonthlyPriceKrw={29_000}
                billingProviderReady
                subscriptionPlanKey="pro"
                pendingPlanKey={null}
                cancelAtPeriodEnd={false}
              />
            </PreviewCard>
            <PreviewCard title="Pending downgrade">
              <BillingPlanAction
                planKey="standard"
                currentPlanKey="pro"
                monthlyPriceKrw={14_000}
                currentMonthlyPriceKrw={29_000}
                billingProviderReady
                subscriptionPlanKey="pro"
                pendingPlanKey="standard"
                cancelAtPeriodEnd={false}
              />
            </PreviewCard>
            <PreviewCard title="Provider disabled">
              <BillingPlanAction
                planKey="pro"
                currentPlanKey="free"
                monthlyPriceKrw={29_000}
                currentMonthlyPriceKrw={0}
                billingProviderReady={false}
                subscriptionPlanKey={null}
                pendingPlanKey={null}
                cancelAtPeriodEnd={false}
              />
            </PreviewCard>
          </div>
        </Section>

        <Section
          title="공유"
          description="공유 답변 페이지와 실제 OG 이미지 렌더러를 확인합니다."
        >
          <div className="grid gap-base">
            <PreviewCard title="SharedAnswerPageContent · 공유 답변 페이지">
              <div
                className="max-h-[760px] overflow-auto rounded-[8px] border border-hairline"
                style={{ transform: "translateZ(0)" }}
              >
                <SharedAnswerPageContent share={sampleShare} locale="ko" />
              </div>
            </PreviewCard>
            <PreviewCard title="ShareOgImage · 공유 링크 썸네일">
              <div className="overflow-hidden rounded-[8px] border border-hairline bg-canvas">
                <div className="aspect-[1200/630] w-full">
                  <ShareOgImage copy={sampleOgCopy} />
                </div>
              </div>
            </PreviewCard>
          </div>
        </Section>
      </div>
    </main>
  );
}
