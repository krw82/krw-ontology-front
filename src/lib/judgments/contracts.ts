import type {
  FilingJudgmentImpact,
  FilingJudgmentNextAction,
  FilingMonitoringRuleOperator,
  FilingMonitoringRuleType,
} from "@/types/api-contracts";
import { z } from "zod";

export const filingJudgmentImpactSchema = z.enum([
  "positive",
  "neutral",
  "negative",
  "unclear",
] satisfies readonly FilingJudgmentImpact[]);

export const filingJudgmentNextActionSchema = z.enum([
  "complete",
  "update_thesis",
  "create_question",
  "review_later",
] satisfies readonly FilingJudgmentNextAction[]);

const filingRuleTypeSchema = z.enum([
  "filing_form",
  "filing_item",
  "keyword",
  "scheduled_review",
] satisfies readonly FilingMonitoringRuleType[]);

const filingRuleOperatorSchema = z.enum([
  "matches",
  "contains",
  "on_or_after",
] satisfies readonly FilingMonitoringRuleOperator[]);

export const judgmentThesisLinkInputSchema = z.object({
  thesis_id: z.uuid(),
  impact: filingJudgmentImpactSchema.optional(),
});

export const monitoringRuleInputSchema = z
  .object({
    rule_type: filingRuleTypeSchema,
    operator: filingRuleOperatorSchema,
    value: z.string().trim().min(1).max(500).nullable().optional(),
    next_review_at: z.iso.datetime().nullable().optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.rule_type === "scheduled_review") {
      if (rule.operator !== "on_or_after" || rule.value || !rule.next_review_at) {
        ctx.addIssue({
          code: "custom",
          message: "scheduled_review는 on_or_after와 next_review_at이 필요합니다.",
        });
      }
      return;
    }
    if (rule.operator === "on_or_after" || !rule.value || rule.next_review_at) {
      ctx.addIssue({
        code: "custom",
        message: "공시·키워드 규칙은 matches/contains와 value가 필요합니다.",
      });
    }
  });

export const saveFilingJudgmentSchema = z.object({
  client_mutation_id: z.string().trim().min(8).max(200),
  context_ticker: z.string().trim().min(1).max(16).transform((value) => value.toUpperCase()),
  impact: filingJudgmentImpactSchema,
  next_action: filingJudgmentNextActionSchema,
  summary: z.string().trim().min(1).max(1200),
  rationale: z.string().trim().max(8000).default(""),
  thesis_links: z.array(judgmentThesisLinkInputSchema).max(20).default([]),
  monitoring_rules: z.array(monitoringRuleInputSchema).max(20).default([]),
  expected_revision_number: z.number().int().min(0).optional(),
});

export type SaveFilingJudgmentInput = z.infer<typeof saveFilingJudgmentSchema>;
