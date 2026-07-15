export interface PulseLearningEntry {
  slug: string;
  kind: "explainer" | "checklist" | "four_panel";
  title: string;
  body: string;
  action_label: string;
  action_href: string;
  source_label: string;
  source_href: string;
  active_from: string;
  active_until: string;
  panels?: [string, string, string, string];
}

/** Curated, versioned content. Serving these entries never calls a model. */
export const PULSE_LEARNING_ENTRIES: PulseLearningEntry[] = [
  {
    slug: "why-8k-matters",
    kind: "explainer",
    title: "8-K는 왜 빨리 봐야 할까요?",
    body: "실적 발표뿐 아니라 경영진 교체, 주요 계약, 자금조달처럼 투자 판단을 바꿀 수 있는 사건이 먼저 드러나는 문서입니다.",
    action_label: "SEC 설명 보기",
    action_href: "https://www.investor.gov/introduction-investing/investing-basics/glossary/form-8-k",
    source_label: "Investor.gov · Form 8-K",
    source_href: "https://www.investor.gov/introduction-investing/investing-basics/glossary/form-8-k",
    active_from: "2026-01-01T00:00:00.000Z",
    active_until: "2027-01-01T00:00:00.000Z",
  },
  {
    slug: "filing-three-checks",
    kind: "checklist",
    title: "공시를 열면 먼저 볼 세 가지",
    body: "① 무슨 사건인지 ② 언제 효력이 생기는지 ③ 현금흐름·지분·경영진에 어떤 변화가 있는지 순서대로 확인해보세요.",
    action_label: "내 공시함 열기",
    action_href: "/filings",
    source_label: "KRW.O 편집 체크리스트",
    source_href: "/filings",
    active_from: "2026-01-01T00:00:00.000Z",
    active_until: "2027-01-01T00:00:00.000Z",
  },
  {
    slug: "four-panel-8k-alert",
    kind: "four_panel",
    title: "공시 알림이 오면 생기는 네 장면",
    body: "알림 자체가 결론은 아닙니다. 사건 유형을 확인하고, 원문을 열고, 내 투자 관점이 달라지는지만 기록하면 됩니다.",
    action_label: "새 공시 보기",
    action_href: "/filings",
    source_label: "KRW.O 편집 4컷",
    source_href: "/filings",
    active_from: "2026-01-01T00:00:00.000Z",
    active_until: "2027-01-01T00:00:00.000Z",
    panels: [
      "① 알림 도착\n‘8-K가 뭐지?’",
      "② 사건 확인\n‘경영진 교체구나’",
      "③ 원문 열기\n‘효력은 다음 달’",
      "④ 한 줄 기록\n‘관점은 아직 유지’",
    ],
  },
];
