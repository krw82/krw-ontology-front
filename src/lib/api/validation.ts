const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isOptionalStringArray(
  value: unknown,
): value is string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

export function normalizeStringList(values: string[] | undefined): string[] {
  if (!values) return [];
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function parsePositiveIntParam(
  value: string | null,
  fallback: number,
  options: { max?: number } = {},
): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(options.max ?? parsed, parsed);
}

export function parseNonNegativeIntParam(
  value: string | null,
  fallback: number,
  options: { max?: number } = {},
): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
  return Math.min(options.max ?? parsed, parsed);
}
