export const ACTIVE_CREDIT_POLICY_VERSION = "credit-v1";
export const CREDIT_DISPLAY_SCALE = 1_000;
export const INPUT_TOKEN_CREDIT_WEIGHT = 1;
export const OUTPUT_TOKEN_CREDIT_WEIGHT = 2;

export type CreditEnforcementMode = "shadow" | "soft_warning" | "enforced";

const CREDIT_ENFORCEMENT_MODES = new Set<CreditEnforcementMode>([
  "shadow",
  "soft_warning",
  "enforced",
]);

export interface CreditUsageInput {
  inputTokens: number;
  outputTokens: number;
}

function safeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function calculateRawAnalysisCredits({
  inputTokens,
  outputTokens,
}: CreditUsageInput): number {
  return (
    safeInteger(inputTokens) * INPUT_TOKEN_CREDIT_WEIGHT +
    safeInteger(outputTokens) * OUTPUT_TOKEN_CREDIT_WEIGHT
  );
}

export function getCreditEnforcementMode(
  env: { [key: string]: string | undefined } = process.env,
): CreditEnforcementMode {
  const value = env.ANALYSIS_CREDIT_ENFORCEMENT_MODE?.trim().toLowerCase();
  if (
    value &&
    CREDIT_ENFORCEMENT_MODES.has(value as CreditEnforcementMode)
  ) {
    return value as CreditEnforcementMode;
  }
  return "enforced";
}

export function shouldBlockAnalysisCreditReservation(
  result: { ok: boolean; allowed?: boolean },
  mode: CreditEnforcementMode = getCreditEnforcementMode(),
): boolean {
  return mode === "enforced" && (!result.ok || result.allowed === false);
}

export function rawCreditsToDisplayCredits(rawCredits: number): number {
  if (!Number.isFinite(rawCredits)) return 0;
  return Math.max(0, rawCredits) / CREDIT_DISPLAY_SCALE;
}

export function formatDisplayCredits(rawCredits: number): string {
  const displayCredits = rawCreditsToDisplayCredits(rawCredits);
  if (displayCredits >= 100) {
    return Math.floor(displayCredits).toLocaleString();
  }
  return displayCredits.toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: displayCredits > 0 && displayCredits < 1 ? 1 : 0,
  });
}
