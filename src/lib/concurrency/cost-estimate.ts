import { readFloatEnv } from "@/lib/env";

const INPUT_COST_PER_1M = readFloatEnv("INPUT_COST_PER_MILLION", 3.0, {
  min: 0,
});
const OUTPUT_COST_PER_1M = readFloatEnv("OUTPUT_COST_PER_MILLION", 15.0, {
  min: 0,
});

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_1M +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M
  );
}
