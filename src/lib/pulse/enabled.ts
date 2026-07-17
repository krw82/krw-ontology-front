/**
 * An optional, source-specific safety switch. It never hides the feed route or
 * navigation; the remaining sources continue to render if one source degrades.
 */
export function isPulseSourceEnabled(source: "resurface" | "learning"): boolean {
  const value = process.env[`PULSE_${source.toUpperCase()}_ENABLED`];
  return value === undefined || value === "1" || value === "true";
}
