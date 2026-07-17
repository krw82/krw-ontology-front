import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  removeNSPrefix: true,
});

export type Form4Owner = {
  reporting_owner_index: number;
  owner_cik: string | null;
  owner_name: string;
  is_director: boolean;
  is_officer: boolean;
  is_ten_percent_owner: boolean;
  is_other: boolean;
  officer_title: string | null;
};

export type Form4Transaction = {
  reporting_owner_index: number;
  transaction_index: number;
  security_kind: "non_derivative" | "derivative";
  security_title: string;
  transaction_date: string | null;
  transaction_code: string | null;
  equity_swap_involved: boolean | null;
  transaction_shares: number | null;
  transaction_price_per_share: number | null;
  acquired_disposed_code: "A" | "D" | null;
  shares_owned_following: number | null;
  direct_indirect_code: "D" | "I" | null;
  nature_of_ownership: string | null;
  footnotes: string[];
};

export type Form4ParseResult = {
  owners: Form4Owner[];
  transactions: Form4Transaction[];
  summary: {
    reporting_owner_count: number;
    transaction_count: number;
    reported_purchase_count: number;
    reported_sale_count: number;
    reported_purchase_shares: number | null;
    reported_sale_shares: number | null;
    reported_purchase_value: number | null;
    reported_sale_value: number | null;
    net_reported_shares: number | null;
    tenb5_one_status: "yes" | "no" | "unknown";
    has_reported_open_market_trade: boolean;
    source_xml_version: string | null;
  };
};

/**
 * Parses only structured ownership XML; no document summarization or LLM call
 * is involved. Form 4 transaction rows are not associated with a particular
 * joint filer in the SEC XML, so a multi-owner filing is attached to its first
 * reported owner and retains the complete owner list for context.
 */
export function parseSecForm4(xml: string): Form4ParseResult {
  const parsed = parser.parse(xml) as unknown;
  const document = recordAt(parsed, "ownershipDocument");
  if (!document) throw new Error("SEC Form 4 ownershipDocument is missing");
  const owners = asArray(document.reportingOwner)
    .map(parseOwner)
    .filter((owner): owner is Omit<Form4Owner, "reporting_owner_index"> => owner !== null)
    .map((owner, reporting_owner_index) => ({ ...owner, reporting_owner_index }));

  // An ownership table without an owner is malformed. Keeping zero rows is
  // safer than inventing an issuer or reporter identity.
  const primaryOwnerIndex = owners[0]?.reporting_owner_index;
  const transactions = primaryOwnerIndex === undefined ? [] : [
    ...parseTransactions(recordAt(document, "nonDerivativeTable"), "non_derivative", primaryOwnerIndex),
    ...parseTransactions(recordAt(document, "derivativeTable"), "derivative", primaryOwnerIndex),
  ];
  const reported = transactions.filter((transaction) =>
    (transaction.transaction_code === "P" || transaction.transaction_code === "S")
    && transaction.transaction_shares !== null
    && transaction.transaction_price_per_share !== null
    && transaction.transaction_shares >= 0
    && transaction.transaction_price_per_share >= 0,
  );
  const purchases = reported.filter((transaction) => transaction.transaction_code === "P");
  const sales = reported.filter((transaction) => transaction.transaction_code === "S");
  const purchaseShares = sum(purchases.map((transaction) => transaction.transaction_shares));
  const saleShares = sum(sales.map((transaction) => transaction.transaction_shares));
  const purchaseValue = sum(purchases.map((transaction) => transaction.transaction_shares! * transaction.transaction_price_per_share!));
  const saleValue = sum(sales.map((transaction) => transaction.transaction_shares! * transaction.transaction_price_per_share!));
  const aff10b5One = collectTextValues(document, "aff10b5One");
  const tenb5_one_status = aff10b5One.some(isTruthy) ? "yes"
    : aff10b5One.some(isFalsy) ? "no"
    : "unknown";

  return {
    owners,
    transactions,
    summary: {
      reporting_owner_count: owners.length,
      transaction_count: transactions.length,
      reported_purchase_count: purchases.length,
      reported_sale_count: sales.length,
      reported_purchase_shares: purchaseShares,
      reported_sale_shares: saleShares,
      reported_purchase_value: purchaseValue,
      reported_sale_value: saleValue,
      net_reported_shares: purchaseShares === null && saleShares === null
        ? null
        : (purchaseShares ?? 0) - (saleShares ?? 0),
      tenb5_one_status,
      has_reported_open_market_trade: reported.length > 0,
      source_xml_version: textOf(document.schemaVersion),
    },
  };
}

function parseOwner(value: unknown): Omit<Form4Owner, "reporting_owner_index"> | null {
  if (!isRecord(value)) return null;
  const identity = recordAt(value, "reportingOwnerId");
  const relationship = recordAt(value, "reportingOwnerRelationship");
  const owner_name = textOf(identity?.rptOwnerName);
  if (!owner_name) return null;
  return {
    owner_cik: validCik(textOf(identity?.rptOwnerCik)),
    owner_name,
    is_director: asBoolean(relationship?.isDirector),
    is_officer: asBoolean(relationship?.isOfficer),
    is_ten_percent_owner: asBoolean(relationship?.isTenPercentOwner),
    is_other: asBoolean(relationship?.isOther),
    officer_title: textOf(relationship?.officerTitle),
  };
}

function parseTransactions(
  table: Record<string, unknown> | null,
  security_kind: Form4Transaction["security_kind"],
  reporting_owner_index: number,
): Form4Transaction[] {
  if (!table) return [];
  const key = security_kind === "non_derivative" ? "nonDerivativeTransaction" : "derivativeTransaction";
  return asArray(table[key])
    .map((raw, transaction_index) => parseTransaction(raw, security_kind, reporting_owner_index, transaction_index))
    .filter((transaction): transaction is Form4Transaction => transaction !== null);
}

function parseTransaction(
  value: unknown,
  security_kind: Form4Transaction["security_kind"],
  reporting_owner_index: number,
  transaction_index: number,
): Form4Transaction | null {
  if (!isRecord(value)) return null;
  const security_title = textOf(value.securityTitle);
  if (!security_title) return null;
  const coding = recordAt(value, "transactionCoding");
  const amounts = recordAt(value, "transactionAmounts");
  const postAmounts = recordAt(value, "postTransactionAmounts");
  const ownership = recordAt(value, "ownershipNature");
  const acquiredDisposed = textOf(amounts?.transactionAcquiredDisposedCode);
  const directIndirect = textOf(ownership?.directOrIndirectOwnership);
  return {
    reporting_owner_index,
    transaction_index,
    security_kind,
    security_title,
    transaction_date: isoDate(textOf(value.transactionDate)),
    transaction_code: transactionCode(textOf(coding?.transactionCode)),
    equity_swap_involved: nullableBoolean(coding?.equitySwapInvolved),
    transaction_shares: numberOf(amounts?.transactionShares),
    transaction_price_per_share: numberOf(amounts?.transactionPricePerShare),
    acquired_disposed_code: acquiredDisposed === "A" || acquiredDisposed === "D" ? acquiredDisposed : null,
    shares_owned_following: numberOf(postAmounts?.sharesOwnedFollowingTransaction),
    direct_indirect_code: directIndirect === "D" || directIndirect === "I" ? directIndirect : null,
    nature_of_ownership: textOf(ownership?.natureOfOwnership),
    footnotes: footnoteIds(value),
  };
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null;
  if (isRecord(value)) return textOf(value.value ?? value["#text"]);
  return null;
}

function numberOf(value: unknown): number | null {
  const text = textOf(value);
  if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function asBoolean(value: unknown): boolean {
  return isTruthy(textOf(value));
}

function nullableBoolean(value: unknown): boolean | null {
  const text = textOf(value);
  return text === null ? null : isTruthy(text);
}

function isTruthy(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function isFalsy(value: string | null): boolean {
  return value === "0" || value?.toLowerCase() === "false" || value?.toLowerCase() === "no";
}

function validCik(value: string | null): string | null {
  return value && /^\d{1,10}$/.test(value) ? value : null;
}

function transactionCode(value: string | null): string | null {
  return value && /^[A-Z][A-Z0-9]{0,7}$/.test(value) ? value : null;
}

function isoDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function footnoteIds(value: unknown): string[] {
  const values: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isRecord(node)) return;
    if (typeof node["@_id"] === "string" && /^F\d+$/i.test(node["@_id"])) values.push(node["@_id"]);
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return [...new Set(values)].slice(0, 100);
}

function collectTextValues(value: unknown, key: string): string[] {
  const output: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isRecord(node)) return;
    if (key in node) output.push(...asArray(node[key]).map(textOf).filter((item): item is string => Boolean(item)));
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return output;
}

function sum(values: Array<number | null>): number | null {
  const concrete = values.filter((value): value is number => value !== null);
  return concrete.length ? concrete.reduce((total, value) => total + value, 0) : null;
}
