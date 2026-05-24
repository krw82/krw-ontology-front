import {
  APPLE_RESEARCH_PROFILE,
  type CompanyResearchProfile,
} from "@/lib/companies/research-profiles";

export type SuggestedPromptSet = readonly string[];

export interface CompanyLandingUiCopy {
  // [공통 하드코딩 스키마]
  // - description: 회사 비즈니스/영역 한 줄 요약(한국어)
  // - sector: 업종 라벨(한국어)
  // - core_strength: "핵심 성장 동력: 항목1, 항목2, 항목3"
  // - critical_risk: "주요 리스크 요인: 항목1, 항목2, 항목3"
  // - suggested_prompts: 회사 상세/채팅 빈 화면에 노출되는 한국어 추천 질문
  // 핵심 성장동력/리스크 항목은 공통적으로 3개씩 쓰되, 최소 2개 이상이어야 제안 질문이 안전하게 생성됨.
  description?: string;
  sector?: string | null;
  core_strength?: string;
  critical_risk?: string;
  suggested_prompts?: SuggestedPromptSet;
}

function companyResearchProfileToLandingCopy(
  profile: CompanyResearchProfile,
): CompanyLandingUiCopy {
  return {
    sector: profile.sectorKo,
    core_strength: `리서치 초점: ${profile.researchFocus.join(", ")}`,
    critical_risk: `리스크 변수: ${profile.riskVariables.join(", ")}`,
    description: profile.description,
    suggested_prompts: profile.suggestedPrompts,
  };
}

const COMPANY_LANDING_UI_COPY: Record<string, CompanyLandingUiCopy> = {
  "AAPL": companyResearchProfileToLandingCopy(APPLE_RESEARCH_PROFILE),
  "ABBV": {
    sector: "제약",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 부채 관리, 인수 및 라이선스",
    critical_risk: "주요 리스크 요인: 소송 결과, 환율 변동, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 부채 관리, 인수 및 라이선스입니다.",
  },
  "ABT": {
    sector: "헬스케어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 사업 인수, 운영비",
    critical_risk: "주요 리스크 요인: 세제·로열티 정책, 환율 변동, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 사업 인수, 운영비입니다.",
  },
  "ADBE": {
    sector: "소프트웨어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, AI 솔루션 개발",
    critical_risk: "주요 리스크 요인: 세제·로열티 정책, 규제 승인, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, AI 솔루션 개발입니다.",
  },
  "AMD": {
    sector: "반도체",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 반도체 수출",
    critical_risk: "주요 리스크 요인: 최종수요, 공급망 교란, 규제 승인",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 반도체 수출입니다.",
  },
  "AMGN": {
    sector: "바이오·제약",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 제품 상용화",
    critical_risk: "주요 리스크 요인: 규제 승인, 소송 결과, 사이버보안 위협",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 제품 상용화입니다.",
  },
  "AMZN": {
    sector: "기술·이커머스",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 부채 관리",
    critical_risk: "주요 리스크 요인: 세제·로열티 정책, 환율 변동, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 부채 관리입니다.",
  },
  "AVGO": {
    sector: "반도체",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 반도체 제조",
    critical_risk: "주요 리스크 요인: 최종수요, 공급망 교란, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 반도체 제조입니다.",
  },
  "AXP": {
    sector: "금융 서비스",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 카드 발급 및 가맹망 확보",
    critical_risk: "주요 리스크 요인: 신용위험, 금리 변동, 환율 변동",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 카드 발급 및 가맹망 확보입니다.",
  },
  "BAC": {
    sector: "은행",
    core_strength: "핵심 성장 동력: 상업 대출, 소비자 대출, 주택담보대출",
    critical_risk: "주요 리스크 요인: 신용위험, 금리 변동, 거시경제 환경",
    description: "기업 리포트: 핵심 사업활동은 상업 대출, 소비자 대출, 주택담보대출입니다.",
  },
  "BKNG": {
    sector: "온라인 여행",
    core_strength: "핵심 성장 동력: 운영비, 제품 및 서비스 매출, 성과형 마케팅",
    critical_risk: "주요 리스크 요인: 환율 변동, 지정학적 이슈, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 운영비, 제품 및 서비스 매출, 성과형 마케팅입니다.",
  },
  "BLK": {
    sector: "자산운용",
    core_strength: "핵심 성장 동력: 투자자산 운용, 자산 관리, 인수",
    critical_risk: "주요 리스크 요인: 환율 변동, 규제 승인, 지정학적 이슈",
    description: "기업 리포트: 핵심 사업활동은 투자자산 운용, 자산 관리, 인수입니다.",
  },
  "C": {
    sector: "금융 서비스",
    core_strength: "핵심 성장 동력: 자본 관리, 자금거래 솔루션, 수수료 기반 서비스",
    critical_risk: "주요 리스크 요인: 금리 변동, 신용위험, 환율 변동",
    description: "기업 리포트: 핵심 사업활동은 자본 관리, 자금거래 솔루션, 수수료 기반 서비스입니다.",
  },
  "CAT": {
    sector: "산업 기계",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 자본 프로젝트",
    critical_risk: "주요 리스크 요인: 신용위험, 최종수요, 관세 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 자본 프로젝트입니다.",
  },
  "COST": {
    sector: "유통",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 물류창고 확대",
    critical_risk: "주요 리스크 요인: 소송 결과, 환율 변동, 지정학적 이슈",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 물류창고 확대입니다.",
  },
  "CSCO": {
    sector: "네트워크 장비",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 부품 조달",
    critical_risk: "주요 리스크 요인: 최종수요, 공급망 교란, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 부품 조달입니다.",
  },
  "DE": {
    sector: "산업 장비",
    core_strength: "핵심 성장 동력: 장비 판매, 농업 장비 판매, 연구 및 개발",
    critical_risk: "주요 리스크 요인: 금리 변동, 지정학적 이슈, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 장비 판매, 농업 장비 판매, 연구 및 개발입니다.",
  },
  "DHR": {
    sector: "헬스케어·바이오",
    core_strength: "핵심 성장 동력: 인수합병, 사업 인수, 부채 관리",
    critical_risk: "주요 리스크 요인: 환율 변동, 세제·로열티 정책, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 인수합병, 사업 인수, 부채 관리입니다.",
  },
  "DIS": {
    sector: "미디어·엔터테인먼트",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 테마파크 운영",
    critical_risk: "주요 리스크 요인: 소송 결과, 환율 변동, 금리 변동",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 테마파크 운영입니다.",
  },
  "GILD": {
    sector: "바이오·제약",
    core_strength: "핵심 성장 동력: 임상 개발, 사업화, 제품 유통",
    critical_risk: "주요 리스크 요인: 규제 승인, 환율 변동, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 임상 개발, 사업화, 제품 유통입니다.",
  },
  "GOOGL": {
    sector: "기술",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 헤지 운영",
    critical_risk: "주요 리스크 요인: 소송 결과, 환율 변동, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 헤지 운영입니다.",
  },
  "GS": {
    sector: "금융 서비스",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 대출, 파생상품 거래",
    critical_risk: "주요 리스크 요인: 신용위험, 소송 결과, 금리 변동",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 대출, 파생상품 거래입니다.",
  },
  "HON": {
    sector: "산업재",
    core_strength: "핵심 성장 동력: 항공우주 완제품 및 애프터마켓, 공급망 관리, 구조조정",
    critical_risk: "주요 리스크 요인: 환율 변동, 지정학적 이슈, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 항공우주 완제품 및 애프터마켓, 공급망 관리, 구조조정입니다.",
  },
  "IBM": {
    sector: "기술",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 파생상품 헤지",
    critical_risk: "주요 리스크 요인: 환율 변동, 자금시장 접근성, 신용위험",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 파생상품 헤지입니다.",
  },
  "INTU": {
    sector: "소프트웨어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 부채 관리",
    critical_risk: "주요 리스크 요인: 자금시장 접근성, 사이버보안 위협, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 부채 관리입니다.",
  },
  "ISRG": {
    sector: "의료기기",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 시스템 임대, 운영비",
    critical_risk: "주요 리스크 요인: 규제 승인, 최종수요, 관세 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 시스템 임대, 운영비입니다.",
  },
  "JNJ": {
    sector: "헬스케어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 의약품 매출, 운영비",
    critical_risk: "주요 리스크 요인: 소송 결과, 환율 변동, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 의약품 매출, 운영비입니다.",
  },
  "JPM": {
    sector: "은행",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 도매 대출, 소비자 대출",
    critical_risk: "주요 리스크 요인: 신용위험, 금리 변동, 거시경제 환경",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 도매 대출, 소비자 대출입니다.",
  },
  "KO": {
    sector: "음료",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 음료 판매, 운영비",
    critical_risk: "주요 리스크 요인: 환율 변동, 소송 결과, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 음료 판매, 운영비입니다.",
  },
  "LIN": {
    sector: "산업 가스",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 액화 프로젝트 개발, 자본 프로젝트",
    critical_risk: "주요 리스크 요인: 환율 변동, 최종수요, 인플레이션",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 액화 프로젝트 개발, 자본 프로젝트입니다.",
  },
  "LLY": {
    sector: "제약",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 의약품 매출, 사업 결합",
    critical_risk: "주요 리스크 요인: 소송 결과, 규제 승인, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 의약품 매출, 사업 결합입니다.",
  },
  "MA": {
    sector: "결제 서비스",
    core_strength: "핵심 성장 동력: 운영비, 제품 및 서비스 매출, 결제 네트워크",
    critical_risk: "주요 리스크 요인: 소송 결과, 환율 변동, 금리 변동",
    description: "기업 리포트: 핵심 사업활동은 운영비, 제품 및 서비스 매출, 결제 네트워크입니다.",
  },
  "MCD": {
    sector: "외식·레스토랑",
    core_strength: "핵심 성장 동력: 가맹점 운영, 제품 및 서비스 매출, 운영비",
    critical_risk: "주요 리스크 요인: 환율 변동, 인플레이션, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 가맹점 운영, 제품 및 서비스 매출, 운영비입니다.",
  },
  "META": {
    sector: "소셜미디어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 광고",
    critical_risk: "주요 리스크 요인: 소송 결과, 규제 승인, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 광고입니다.",
  },
  "MRK": {
    sector: "제약",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 구조조정, 운영비",
    critical_risk: "주요 리스크 요인: 규제 승인, 소송 결과, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 구조조정, 운영비입니다.",
  },
  "MS": {
    sector: "금융 서비스",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 규제 준수, 자산관리",
    critical_risk: "주요 리스크 요인: 신용위험, 금리 변동, 거시경제 환경",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 규제 준수, 자산관리입니다.",
  },
  "MSFT": {
    sector: "기술",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 클라우드 서비스",
    critical_risk: "주요 리스크 요인: 소송 결과, 최종수요, 사이버보안 위협",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 클라우드 서비스입니다.",
  },
  "NEE": {
    sector: "에너지·유틸리티",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 파생상품 헤지, 파생상품 거래",
    critical_risk: "주요 리스크 요인: 금리 변동, 신용위험, 규제 승인",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 파생상품 헤지, 파생상품 거래입니다.",
  },
  "NFLX": {
    sector: "스트리밍 미디어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 주식기반 보상, 자사주 매입",
    critical_risk: "주요 리스크 요인: 환율 변동, 지정학적 이슈, 자사주 매입 집행",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 주식기반 보상, 자사주 매입입니다.",
  },
  "NOW": {
    sector: "기업용 소프트웨어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 인수, 운영비",
    critical_risk: "주요 리스크 요인: 세제·로열티 정책, 환율 변동, 금리 변동",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 인수, 운영비입니다.",
  },
  "NVDA": {
    sector: "반도체",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 투자 포트폴리오 관리",
    critical_risk: "주요 리스크 요인: 지정학적 이슈, 규제 승인, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 투자 포트폴리오 관리입니다.",
  },
  "ORCL": {
    sector: "기업용 소프트웨어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 클라우드 인프라",
    critical_risk: "주요 리스크 요인: 자금시장 접근성, 환율 변동, 지정학적 이슈",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 클라우드 인프라입니다.",
  },
  "PEP": {
    sector: "생활필수재",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 인수, 구조조정",
    critical_risk: "주요 리스크 요인: 환율 변동, 최종수요, 금리 변동",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 인수, 구조조정입니다.",
  },
  "PFE": {
    sector: "제약",
    core_strength: "핵심 성장 동력: 임상 개발, 사업 구조조정, 사업 개발",
    critical_risk: "주요 리스크 요인: 규제 승인, 환율 변동, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 임상 개발, 사업 구조조정, 사업 개발입니다.",
  },
  "PG": {
    sector: "생필품",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 구조조정, 운영비",
    critical_risk: "주요 리스크 요인: 환율 변동, 최종수요, 관세 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 구조조정, 운영비입니다.",
  },
  "PGR": {
    sector: "보험",
    core_strength: "핵심 성장 동력: 투자 포트폴리오 관리, 보험 인수심사, 고정수익 포트폴리오 관리",
    critical_risk: "주요 리스크 요인: 금리 변동, 신용위험, 극한기상",
    description: "기업 리포트: 핵심 사업활동은 투자 포트폴리오 관리, 보험 인수심사, 고정수익 포트폴리오 관리입니다.",
  },
  "PLTR": {
    sector: "기술",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 기업 지배구조",
    critical_risk: "주요 리스크 요인: 규제 승인, 지정학적 이슈, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 기업 지배구조입니다.",
  },
  "PM": {
    sector: "담배",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, SFP 상용화",
    critical_risk: "주요 리스크 요인: 규제 승인, 소송 결과, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, SFP 상용화입니다.",
  },
  "QCOM": {
    sector: "반도체",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 특허 라이선스, 반도체 제조",
    critical_risk: "주요 리스크 요인: 소송 결과, 최종수요, 공급망 교란",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 특허 라이선스, 반도체 제조입니다.",
  },
  "RTX": {
    sector: "항공우주·방위산업",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 국방 사업",
    critical_risk: "주요 리스크 요인: 소송 결과, 최종수요, 관세 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 국방 사업입니다.",
  },
  "SCHW": {
    sector: "금융 서비스",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 자본 관리",
    critical_risk: "주요 리스크 요인: 금리 변동, 신용위험, 규제 승인",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 자본 관리입니다.",
  },
  "SPGI": {
    sector: "금융 데이터·분석",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 파생상품 헤지",
    critical_risk: "주요 리스크 요인: 환율 변동, 세제·로열티 정책, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 파생상품 헤지입니다.",
  },
  "SYK": {
    sector: "의료기기",
    core_strength: "핵심 성장 동력: 제조 운영, 인수 통합, 인수",
    critical_risk: "주요 리스크 요인: 환율 변동, 규제 승인, 최종수요",
    description: "기업 리포트: 핵심 사업활동은 제조 운영, 인수 통합, 인수입니다.",
  },
  "T": {
    sector: "통신",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 부채 관리, 운영비",
    critical_risk: "주요 리스크 요인: 환율 변동, 금리 변동, 신용위험",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 부채 관리, 운영비입니다.",
  },
  "TMO": {
    sector: "생명과학 도구",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 인수, 부채 조달",
    critical_risk: "주요 리스크 요인: 자금시장 접근성, 환율 변동, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 인수, 부채 조달입니다.",
  },
  "TSLA": {
    sector: "자동차",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 자본 프로젝트",
    critical_risk: "주요 리스크 요인: 소송 결과, 관세 정책, 자금시장 접근성",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 자본 프로젝트입니다.",
  },
  "TXN": {
    sector: "반도체",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 반도체 제조, 운영비",
    critical_risk: "주요 리스크 요인: 최종수요, 규제 승인, 금리 변동",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 반도체 제조, 운영비입니다.",
  },
  "UBER": {
    sector: "모빌리티 기술",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 플랫폼 운영",
    critical_risk: "주요 리스크 요인: 규제 승인, 소송 결과, 세제·로열티 정책",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 플랫폼 운영입니다.",
  },
  "UNH": {
    sector: "헬스케어",
    core_strength: "핵심 성장 동력: 제품 및 서비스 매출, 운영비, 포트폴리오 매각",
    critical_risk: "주요 리스크 요인: 금리 변동, 규제 승인, 소송 결과",
    description: "기업 리포트: 핵심 사업활동은 제품 및 서비스 매출, 운영비, 포트폴리오 매각입니다.",
  },
  "UNP": {
    sector: "철도·운송",
    core_strength: "핵심 성장 동력: 철도 운영, 화물 운송, 주식 보상",
    critical_risk: "주요 리스크 요인: 최종수요, 소송 결과, 규제 승인",
    description: "기업 리포트: 핵심 사업활동은 철도 운영, 화물 운송, 주식 보상입니다.",
  },
  "V": {
    sector: "결제 서비스",
    core_strength: "핵심 성장 동력: 운영비, 제품 및 서비스 매출, 결제 처리",
    critical_risk: "주요 리스크 요인: 소송 결과, 최종수요, 환율 변동",
    description: "기업 리포트: 핵심 사업활동은 운영비, 제품 및 서비스 매출, 결제 처리입니다.",
  },
  "VRTX": {
    sector: "바이오·제약",
    core_strength: "핵심 성장 동력: 임상 개발, 연구 및 개발, 임상시험",
    critical_risk: "주요 리스크 요인: 규제 승인, 세제·로열티 정책, 환율 변동",
    description: "기업 리포트: 핵심 사업활동은 임상 개발, 연구 및 개발, 임상시험입니다.",
  },
  "WFC": {
    sector: "은행",
    core_strength: "핵심 성장 동력: 상업 대출, 모기지 서비스, 투자증권 관리",
    critical_risk: "주요 리스크 요인: 신용위험, 금리 변동, 규제 승인",
    description: "기업 리포트: 핵심 사업활동은 상업 대출, 모기지 서비스, 투자증권 관리입니다.",
  },
};

function normalizeTickerForCopy(ticker: string): string | null {
  const normalized = ticker.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function getCompanyLandingCopyForTicker(
  ticker: string,
): CompanyLandingUiCopy {
  const normalized = normalizeTickerForCopy(ticker);
  if (!normalized) return {};
  return COMPANY_LANDING_UI_COPY[normalized] ?? {};
}

// UI guardrail: each Korean prompt must be concise to avoid compact layout overflow.
export const DEFAULT_SUGGESTED_PROMPTS: SuggestedPromptSet = [
  "핵심성장 동력이 뭔가요?",
  "핵심성장 동력은 지금 어떻게 되나요?",
  "주요리스크 요인은 어떤가요?",
];

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function parseListField(value?: string): string[] {
  if (!value) return [];
  // 하드코딩 텍스트 포맷 공통 규격:
  //   핵심 성장 동력: x, y, z
  //   주요 리스크 요인: a, b, c
  // 추천 질문은 위 형식에서 항목명을 추출해서 자동 생성한다.
  const normalized = value
    .replace(/^핵심 성장 동력:\s*/, "")
    .replace(/^핵심 성장 동력\s*:\s*/, "")
    .replace(/^주요 리스크 요인:\s*/, "")
    .replace(/^주요 리스크 요인\s*:\s*/, "")
    .replace(/^리서치 초점:\s*/, "")
    .replace(/^리서치 초점\s*:\s*/, "")
    .replace(/^리스크 변수:\s*/, "")
    .replace(/^리스크 변수\s*:\s*/, "");

  if (normalized.includes("\n") || normalized.includes(";")) {
    return normalized
      .split(/[\n;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return normalized
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function simplifyTerm(value: string): string {
  const cleaned = value
    .replace(/\(.*?\)/g, "")
    .replace(/\b및\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) {
    return "주요 사업 활동";
  }

  return cleaned;
}

function curatedPromptsForCopy(
  copy: CompanyLandingUiCopy,
): SuggestedPromptSet | null {
  const prompts = copy.suggested_prompts
    ?.map((prompt) => prompt.trim())
    .filter(Boolean);

  return prompts && prompts.length > 0 ? prompts : null;
}

function buildPromptsForTicker(ticker: string): SuggestedPromptSet {
  const copy = getCompanyLandingCopyForTicker(ticker);
  const curatedPrompts = curatedPromptsForCopy(copy);
  if (curatedPrompts) return curatedPrompts;

  const coreTerms = parseListField(copy.core_strength).map(simplifyTerm);
  const riskTerms = parseListField(copy.critical_risk).map(simplifyTerm);

  const coreA = coreTerms[0] ?? "핵심성장 동력";
  const coreB = coreTerms[1] ?? coreTerms[0] ?? "운영 효율";
  const riskA = riskTerms[0] ?? "주요리스크 요인";

  return [
    `핵심성장 동력인 '${coreA}'은(는) 어떤가요?`,
    `핵심성장 동력인 '${coreB}'은(는) 어떻게 되나요?`,
    `주요리스크 요인인 '${riskA}'은(는) 어떤가요?`,
  ];
}

export function getSuggestedPromptsForTickers(
  tickers: readonly string[],
): SuggestedPromptSet {
  const normalizedTickers = Array.from(
    new Set(tickers.map(normalizeTicker).filter(Boolean)),
  );

  if (normalizedTickers.length === 1) {
    return buildPromptsForTicker(normalizedTickers[0]);
  }

  if (normalizedTickers.length > 1) {
    return [
      "성장 동인을 비교해줘",
      "마진 흐름을 비교해줘",
      "핵심 리스크를 비교해줘",
    ];
  }

  return DEFAULT_SUGGESTED_PROMPTS;
}
