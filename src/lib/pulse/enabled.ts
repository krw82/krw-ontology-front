export function isPulseFeedEnabled(): boolean {
  const explicit = process.env.PULSE_FEED_ENABLED ?? process.env.NEXT_PUBLIC_PULSE_FEED_ENABLED;
  if (explicit !== undefined) return explicit === "1" || explicit === "true";
  return process.env.NODE_ENV !== "production";
}

/**
 * P0 v2 rolls out independently from the route-level kill switch. Production
 * stays opt-in until the internal/10% cohorts have passed their checks.
 */
export function isPulseP0V2Enabled(): boolean {
  const explicit = process.env.PULSE_P0_V2_ENABLED ?? process.env.NEXT_PUBLIC_PULSE_P0_V2_ENABLED;
  if (explicit !== undefined) return explicit === "1" || explicit === "true";
  return process.env.NODE_ENV !== "production";
}

export function isPulseSourceEnabled(source: "resurface" | "learning"): boolean {
  const value = process.env[`PULSE_${source.toUpperCase()}_ENABLED`];
  return value === undefined || value === "1" || value === "true";
}
