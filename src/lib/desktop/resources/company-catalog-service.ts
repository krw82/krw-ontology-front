import "server-only";

import { createHash } from "node:crypto";
import {
  getActiveOntologyCatalogRelease,
  getIndexedCompany,
  listIndexedCompanies,
} from "@/lib/ontology/catalog";
import {
  DESKTOP_COMPANY_CATALOG_CONTRACT,
  DESKTOP_COMPANY_DETAIL_CONTRACT,
  toDesktopCompanyDetail,
  toDesktopCompanySummary,
} from "@/lib/desktop/dto/company-catalog-dto";
import { DesktopContractError } from "@/lib/desktop/ontology-contracts";
import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";
import { DEFAULT_LOCALE } from "@/i18n/config";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const CACHE_MAX_AGE_SECONDS = 21_600;

interface CatalogCursor {
  release_id: string;
  last_ticker: string;
  query_hash: string;
}

export async function listDesktopCompanies(input: {
  query?: string | null;
  cursor?: string | null;
  limit?: number;
}) {
  const release = await getActiveOntologyCatalogRelease();
  const query = normalizeQuery(input.query);
  const queryHash = hashValue(query.toLocaleLowerCase());
  const cursor = decodeCursor(input.cursor);

  if (!release) {
    return {
      payload: {
        ok: true as const,
        contract_version: DESKTOP_COMPANY_CATALOG_CONTRACT,
        data: { companies: [] },
        meta: {
          catalog_release_id: null,
          generated_at: null,
          query,
          total_count: 0,
          returned_count: 0,
          next_cursor: null,
          has_more: false,
          max_age_seconds: CACHE_MAX_AGE_SECONDS,
        },
      },
      etag: createCatalogEtag("none", queryHash, null),
    };
  }

  if (
    cursor &&
    (cursor.release_id !== release.release_id ||
      cursor.query_hash !== queryHash)
  ) {
    throw new DesktopContractError("Catalog cursor is no longer valid", {
      code: "validation_error",
      publicMessage: "회사 목록이 갱신되었습니다. 처음부터 다시 불러와주세요.",
      status: 409,
    });
  }

  const limit = clampLimit(input.limit);
  const matchingCompanies = (await listIndexedCompanies())
    .filter((company) => matchesQuery(company, query))
    .sort((left, right) => left.ticker.localeCompare(right.ticker));
  const totalCount = matchingCompanies.length;
  const companies = matchingCompanies.filter((company) =>
    cursor ? company.ticker > cursor.last_ticker : true,
  );
  const page = companies.slice(0, limit);
  const hasMore = companies.length > page.length;
  const lastTicker = page.at(-1)?.ticker ?? null;
  const nextCursor =
    hasMore && lastTicker
      ? encodeCursor({
          release_id: release.release_id,
          last_ticker: lastTicker,
          query_hash: queryHash,
        })
      : null;

  return {
    payload: {
      ok: true as const,
      contract_version: DESKTOP_COMPANY_CATALOG_CONTRACT,
      data: {
        companies: page.map(toDesktopCompanySummary),
      },
      meta: {
        catalog_release_id: release.release_id,
        generated_at: release.generated_at,
        query,
        total_count: totalCount,
        returned_count: page.length,
        next_cursor: nextCursor,
        has_more: hasMore,
        max_age_seconds: CACHE_MAX_AGE_SECONDS,
      },
    },
    etag: createCatalogEtag(release.release_id, queryHash, lastTicker),
  };
}

export async function getDesktopCompany(rawTicker: string) {
  const company = await getIndexedCompany(rawTicker);
  if (!company) return null;
  const release = await getActiveOntologyCatalogRelease();

  return {
    ok: true as const,
    contract_version: DESKTOP_COMPANY_DETAIL_CONTRACT,
    data: {
      company: toDesktopCompanyDetail(company),
    },
    meta: {
      catalog_release_id: release?.release_id ?? null,
      generated_at: release?.generated_at ?? null,
      max_age_seconds: CACHE_MAX_AGE_SECONDS,
    },
  };
}

function normalizeQuery(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function matchesQuery(
  company: Awaited<ReturnType<typeof listIndexedCompanies>>[number],
  query: string,
) {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  const copy = getCompanyDisplayCopyForTicker(DEFAULT_LOCALE, company.ticker);
  return [
    company.ticker,
    company.name,
    copy.name,
    copy.companyNameKo,
    company.sector,
    copy.sector,
    company.description,
    copy.description,
    company.core_strength,
    copy.core_strength,
    company.critical_risk,
    copy.critical_risk,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(needle);
}

function clampLimit(value: number | undefined) {
  if (!Number.isSafeInteger(value) || !value || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(value, MAX_PAGE_SIZE);
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

function createCatalogEtag(
  releaseId: string,
  queryHash: string,
  lastTicker: string | null,
) {
  const value = hashValue(
    `${DESKTOP_COMPANY_CATALOG_CONTRACT}:${releaseId}:${queryHash}:${lastTicker ?? ""}`,
  );
  return `"catalog-${value}"`;
}

function encodeCursor(cursor: CatalogCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string | null | undefined): CatalogCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CatalogCursor>;
    if (
      typeof parsed.release_id !== "string" ||
      typeof parsed.last_ticker !== "string" ||
      typeof parsed.query_hash !== "string"
    ) {
      throw new Error("Invalid cursor shape");
    }
    return parsed as CatalogCursor;
  } catch {
    throw new DesktopContractError("Invalid catalog cursor", {
      code: "validation_error",
      publicMessage: "회사 목록 페이지 정보가 올바르지 않습니다.",
      status: 400,
    });
  }
}
