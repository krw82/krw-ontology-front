import type { UserCompanyCoverageLevel } from "@/types/api-contracts";
import { z } from "zod";

export const companyCoverageLevelSchema = z.enum([
  "interest",
] satisfies readonly UserCompanyCoverageLevel[]).nullable();

export const setCompanyCoverageSchema = z.object({
  coverage_level: companyCoverageLevelSchema,
  idempotency_key: z.string().trim().min(8).max(200).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  interest_reason: z.string().trim().max(1200).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export type SetCompanyCoverageInput = z.infer<typeof setCompanyCoverageSchema>;

export function isActiveCoverageLevel(level: UserCompanyCoverageLevel | null) {
  return level !== null;
}
