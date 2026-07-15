import type { PulseCursorPayload } from "@/lib/pulse/contract";

export function encodePulseCursor(payload: PulseCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePulseCursor(value: string | null | undefined): PulseCursorPayload | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<PulseCursorPayload>;

    if (
      parsed.version !== 1 ||
      !Number.isInteger(parsed.offset) ||
      (parsed.offset ?? -1) < 0 ||
      typeof parsed.filter !== "string" ||
      typeof parsed.generated_at !== "string" ||
      Number.isNaN(Date.parse(parsed.generated_at))
    ) {
      return null;
    }

    return parsed as PulseCursorPayload;
  } catch {
    return null;
  }
}
