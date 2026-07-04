import type { Parsed13FHolding } from "@/lib/sec-13f/types";

const INFO_TABLE_PATTERN =
  /<(?:(?:\w+):)?infoTable\b[^>]*>([\s\S]*?)<\/(?:(?:\w+):)?infoTable>/gi;

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    );
}

function tagValue(block: string, tagName: string): string | null {
  const pattern = new RegExp(
    `<(?:(?:\\w+):)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${tagName}>`,
    "i",
  );
  const match = block.match(pattern);
  if (!match) return null;
  const text = match[1]
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? decodeXmlText(text) : null;
}

function requiredText(block: string, tagName: string): string {
  return tagValue(block, tagName) ?? "";
}

function numericValue(block: string, tagName: string): number | null {
  const raw = tagValue(block, tagName);
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function parseInformationTableXml(xml: string): Parsed13FHolding[] {
  const holdings: Parsed13FHolding[] = [];

  for (const match of xml.matchAll(INFO_TABLE_PATTERN)) {
    const block = match[1];
    const issuerName = requiredText(block, "nameOfIssuer");
    const titleOfClass = requiredText(block, "titleOfClass");
    const cusip = requiredText(block, "cusip").toUpperCase();
    const valueUsd = numericValue(block, "value") ?? 0;

    if (!issuerName || !cusip) continue;

    holdings.push({
      issuerName,
      titleOfClass,
      cusip,
      valueUsd,
      shares: numericValue(block, "sshPrnamt"),
      shareType: tagValue(block, "sshPrnamtType"),
      putCall: tagValue(block, "putCall"),
      investmentDiscretion: tagValue(block, "investmentDiscretion"),
      otherManager: tagValue(block, "otherManager"),
      votingAuthoritySole: numericValue(block, "Sole"),
      votingAuthorityShared: numericValue(block, "Shared"),
      votingAuthorityNone: numericValue(block, "None"),
    });
  }

  return aggregateHoldingsByPositionKey(holdings);
}

export function positionKey(input: {
  cusip: string;
  titleOfClass: string;
  putCall: string | null;
}): string {
  return [
    input.cusip.trim().toUpperCase(),
    input.putCall?.trim().toUpperCase() ?? "",
  ].join("|");
}

function addNullableNumbers(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function firstText(left: string | null, right: string | null): string | null {
  return left && left.trim() ? left : right;
}

export function aggregateHoldingsByPositionKey(
  holdings: Parsed13FHolding[],
): Parsed13FHolding[] {
  const byKey = new Map<string, Parsed13FHolding>();

  for (const holding of holdings) {
    const key = positionKey({
      cusip: holding.cusip,
      titleOfClass: holding.titleOfClass,
      putCall: holding.putCall,
    });
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...holding });
      continue;
    }

    existing.valueUsd += holding.valueUsd;
    existing.shares = addNullableNumbers(existing.shares, holding.shares);
    existing.votingAuthoritySole = addNullableNumbers(
      existing.votingAuthoritySole,
      holding.votingAuthoritySole,
    );
    existing.votingAuthorityShared = addNullableNumbers(
      existing.votingAuthorityShared,
      holding.votingAuthorityShared,
    );
    existing.votingAuthorityNone = addNullableNumbers(
      existing.votingAuthorityNone,
      holding.votingAuthorityNone,
    );
    existing.issuerName = firstText(existing.issuerName, holding.issuerName) ?? "";
    existing.titleOfClass =
      firstText(existing.titleOfClass, holding.titleOfClass) ?? "";
    existing.shareType = firstText(existing.shareType, holding.shareType);
    existing.investmentDiscretion = firstText(
      existing.investmentDiscretion,
      holding.investmentDiscretion,
    );
    existing.otherManager = firstText(existing.otherManager, holding.otherManager);
  }

  return Array.from(byKey.values()).sort((a, b) => b.valueUsd - a.valueUsd);
}

export function normalizeCik(rawCik: string): string {
  const digits = rawCik.replace(/\D/g, "");
  return digits ? digits.padStart(10, "0").slice(-10) : "";
}
