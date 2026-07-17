import type { SecFilingFormType } from "@/types/database";

export type FilingClassificationSource = "sec_items" | "metadata" | "unclassified";

export type FilingClassification = {
  eventTags: string[];
  primaryEventTag: string | null;
  source: FilingClassificationSource;
  metadataRulePhrases: string[];
};

const ITEM_TAGS: Record<string, string> = {
  "1.01": "important_contract",
  "1.02": "contract_termination",
  "1.03": "bankruptcy_or_receivership",
  "1.05": "cybersecurity_incident",
  "2.01": "acquisition_or_disposition",
  "2.02": "earnings_or_financial_results",
  "2.03": "debt_or_obligation",
  "2.05": "costs_associated_with_exit_or_disposal",
  "2.06": "material_impairment",
  "3.01": "listing_or_delisting",
  "3.02": "unregistered_securities_sale",
  "4.01": "auditor_change",
  "4.02": "financial_statement_nonreliance",
  "5.01": "change_in_control",
  "5.02": "leadership_or_board_change",
  "5.07": "shareholder_vote",
  "7.01": "other_material_event",
  "8.01": "other_material_event",
  "9.01": "other_material_event",
};

const TAG_PRIORITY = [
  "cybersecurity_incident",
  "bankruptcy_or_receivership",
  "listing_or_delisting",
  "financial_statement_nonreliance",
  "material_impairment",
  "auditor_change",
  "change_in_control",
  "earnings_or_financial_results",
  "leadership_or_board_change",
  "acquisition_or_disposition",
  "debt_or_obligation",
  "important_contract",
  "contract_termination",
  "unregistered_securities_sale",
  "costs_associated_with_exit_or_disposal",
  "shareholder_vote",
  "other_material_event",
] as const;

// 6-K has no 8-K-style Item taxonomy. These are intentionally narrow,
// metadata-only phrases from the submissions JSON; any miss stays a generic
// foreign-issuer report instead of pretending to understand the document.
const SIX_K_METADATA_RULES: Array<{ tag: string; phrases: string[] }> = [
  { tag: "cybersecurity_incident", phrases: ["cybersecurity", "cyber security"] },
  { tag: "financial_statement_nonreliance", phrases: ["non-reliance", "non reliance", "restatement"] },
  { tag: "bankruptcy_or_receivership", phrases: ["bankruptcy", "receivership"] },
  { tag: "listing_or_delisting", phrases: ["delisting", "listing deficiency"] },
  { tag: "acquisition_or_disposition", phrases: ["acquisition", "disposition", "business combination"] },
  { tag: "earnings_or_financial_results", phrases: ["earnings", "financial results", "results of operations", "guidance", "outlook", "forecast"] },
  { tag: "leadership_or_board_change", phrases: ["chief executive officer", "chief financial officer", "director", "officer appointment"] },
  { tag: "auditor_change", phrases: ["auditor", "independent registered public accounting"] },
  { tag: "important_contract", phrases: ["agreement", "material contract"] },
  { tag: "debt_or_obligation", phrases: ["credit facility", "debt", "financing"] },
];

const TAG_LABELS: Record<string, string> = {
  important_contract: "중요 계약",
  contract_termination: "계약 종료",
  bankruptcy_or_receivership: "파산·회생",
  cybersecurity_incident: "사이버보안 사고",
  acquisition_or_disposition: "인수·자산 처분",
  earnings_or_financial_results: "실적·재무",
  debt_or_obligation: "채무·의무",
  costs_associated_with_exit_or_disposal: "구조조정·처분 비용",
  material_impairment: "손상차손",
  listing_or_delisting: "상장 유지 문제",
  unregistered_securities_sale: "증권 발행",
  auditor_change: "감사인 변경",
  financial_statement_nonreliance: "재무제표 신뢰 철회",
  change_in_control: "지배권 변경",
  leadership_or_board_change: "경영진·이사회 변경",
  shareholder_vote: "주주 의결",
  other_material_event: "기타 중요 사건",
  foreign_issuer_report: "해외발행인 수시공시",
  insider_trade: "내부자 거래",
};

export function normalizeSecItems(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/[;,|\s]+/)
        .map((item) => item.trim().toUpperCase())
        .filter((item) => /^\d\.\d{2}$/.test(item)),
    ),
  );
}

export function classifyFiling(params: {
  formType: SecFilingFormType;
  secItems: string[];
  primaryDocDescription?: string | null;
}): FilingClassification {
  if (params.formType.startsWith("4")) {
    // The worker subsequently normalizes ownership XML. Header metadata must
    // not be used to infer a trade value or investment conclusion.
    return {
      eventTags: ["insider_trade"],
      primaryEventTag: "insider_trade",
      source: "metadata",
      metadataRulePhrases: [],
    };
  }
  if (params.formType.startsWith("8-K")) {
    const eventTags = Array.from(
      new Set(params.secItems.map((item) => ITEM_TAGS[item]).filter((tag): tag is string => Boolean(tag))),
    );
    const primaryEventTag = TAG_PRIORITY.find((tag) => eventTags.includes(tag)) ?? null;
    return {
      eventTags,
      primaryEventTag,
      source: eventTags.length ? "sec_items" : "unclassified",
      metadataRulePhrases: [],
    };
  }

  const description = params.primaryDocDescription?.trim();
  const normalizedDescription = description?.toLowerCase() ?? "";
  const matchingRules = description ? SIX_K_METADATA_RULES
    .map((rule) => ({ ...rule, matchedPhrases: rule.phrases.filter((phrase) => normalizedDescription.includes(phrase)) }))
    .filter((rule) => rule.matchedPhrases.length) : [];
  const metadataTags = matchingRules.map((rule) => rule.tag);
  const primaryEventTag = TAG_PRIORITY.find((tag) => metadataTags.includes(tag)) ?? "foreign_issuer_report";
  return {
    eventTags: metadataTags.length ? metadataTags : ["foreign_issuer_report"],
    primaryEventTag,
    source: description ? "metadata" : "unclassified",
    metadataRulePhrases: matchingRules.flatMap((rule) => rule.matchedPhrases),
  };
}

export function filingEventTagLabel(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return TAG_LABELS[tag] ?? null;
}

export function filingClassificationReason(params: {
  formType: SecFilingFormType;
  secItems: string[];
  primaryEventTag: string | null;
  primaryDocDescription?: string | null;
  metadataRulePhrases?: string[];
}): string {
  if (params.formType.startsWith("8-K") && params.secItems.length) {
    return `SEC Item ${params.secItems.join(", ")} 감지`;
  }
  if (params.formType.startsWith("6-K") && params.metadataRulePhrases?.length) {
    return `SEC 제출 설명 규칙: ${params.metadataRulePhrases.slice(0, 3).map((phrase) => `“${phrase}”`).join(", ")}`;
  }
  if (params.formType.startsWith("6-K") && params.primaryDocDescription?.trim()) {
    return `SEC 제출 설명: ${params.primaryDocDescription.trim().slice(0, 120)}`;
  }
  return params.primaryEventTag ? "SEC 제출 메타데이터 기반" : "SEC 제출 정보";
}

export function filingAlertPriority(
  primaryEventTag: string | null | undefined,
  secItems: readonly string[] = [],
): "urgent" | "normal" | "digest" {
  if (primaryEventTag && [
    "cybersecurity_incident",
    "bankruptcy_or_receivership",
    "listing_or_delisting",
    "financial_statement_nonreliance",
  ].includes(primaryEventTag)) {
    return "urgent";
  }
  if (primaryEventTag && [
    "earnings_or_financial_results",
    "leadership_or_board_change",
    "acquisition_or_disposition",
    "debt_or_obligation",
    "important_contract",
    "contract_termination",
    "unregistered_securities_sale",
    "material_impairment",
    "costs_associated_with_exit_or_disposal",
    "auditor_change",
    "change_in_control",
  ].includes(primaryEventTag)) {
    return "normal";
  }
  // Item 8.01 is explicitly a catch-all for material events. Without a
  // document-level investment judgement, route it as a normal alert rather
  // than silently demoting every such filing into the digest.
  if (primaryEventTag === "other_material_event" && secItems.includes("8.01")) return "normal";
  return "digest";
}
