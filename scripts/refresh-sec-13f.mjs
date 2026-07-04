#!/usr/bin/env node

import process from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const { Pool } = pg;

const DEFAULT_TOP_MAPPING_LIMIT = 30;
const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";
const OPENFIGI_ID_TYPE_CUSIP = "ID_CUSIP";
const OPENFIGI_BATCH_WITH_KEY = 100;
const OPENFIGI_BATCH_WITHOUT_KEY = 10;
const OPENFIGI_DELAY_WITHOUT_KEY_MS = 2500;
const CUSIP_TICKER_OVERRIDES = new Map([
  [
    "30231G102",
    {
      ticker: "XOM",
      name: "EXXON MOBIL CORP",
      exchCode: "US",
      marketSector: "Equity",
      securityType: "Common Stock",
      securityType2: "Common Stock",
      securityDescription: "XOM",
    },
  ],
]);

const KNOWN_MANAGERS = [
  {
    cik: "0001608046",
    name: "National Pension Service",
    displayName: "국민연금공단 / National Pension Service",
    countryCode: "KR",
    notes: "Korea National Pension Service 13F filer on SEC EDGAR.",
  },
  {
    cik: "0002012383",
    name: "BlackRock, Inc.",
    displayName: "블랙록 / BlackRock, Inc.",
    countryCode: "US",
    notes: "BlackRock 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001067983",
    name: "Berkshire Hathaway Inc",
    displayName: "버크셔 해서웨이 / Berkshire Hathaway",
    countryCode: "US",
    notes: "Berkshire Hathaway 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001697748",
    name: "ARK Investment Management LLC",
    displayName: "캐시 우드 ARK / ARK Investment Management",
    countryCode: "US",
    notes: "Cathie Wood's ARK Investment Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001536411",
    name: "Duquesne Family Office LLC",
    displayName: "드러켄밀러 / Duquesne Family Office",
    countryCode: "US",
    notes: "Stanley Druckenmiller's Duquesne Family Office 13F filer on SEC EDGAR.",
  },
  {
    cik: "0000850529",
    name: "Fisher Asset Management, LLC",
    displayName: "켄 피셔 / Fisher Asset Management",
    countryCode: "US",
    notes: "Ken Fisher's Fisher Asset Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001336528",
    name: "Pershing Square Capital Management, L.P.",
    displayName: "빌 애크먼 / Pershing Square",
    countryCode: "US",
    notes: "Bill Ackman's Pershing Square Capital Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001656456",
    name: "Appaloosa LP",
    displayName: "데이비드 테퍼 / Appaloosa",
    countryCode: "US",
    notes: "David Tepper's Appaloosa 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001061768",
    name: "Baupost Group LLC/MA",
    displayName: "세스 클라먼 / Baupost Group",
    countryCode: "US",
    notes: "Seth Klarman's Baupost Group 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001040273",
    name: "Third Point LLC",
    displayName: "댄 로브 / Third Point",
    countryCode: "US",
    notes: "Dan Loeb's Third Point 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001029160",
    name: "Soros Fund Management LLC",
    displayName: "조지 소로스 / Soros Fund Management",
    countryCode: "US",
    notes: "George Soros's Soros Fund Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001135730",
    name: "Coatue Management LLC",
    displayName: "필립 라퐁 / Coatue",
    countryCode: "US",
    notes: "Philippe Laffont's Coatue Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001167483",
    name: "Tiger Global Management LLC",
    displayName: "체이스 콜먼 / Tiger Global",
    countryCode: "US",
    notes: "Chase Coleman's Tiger Global Management 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001103804",
    name: "Viking Global Investors LP",
    displayName: "안드레아스 할보르센 / Viking Global",
    countryCode: "US",
    notes: "Andreas Halvorsen's Viking Global Investors 13F filer on SEC EDGAR.",
  },
  {
    cik: "0001061165",
    name: "Lone Pine Capital LLC",
    displayName: "스티브 맨델 / Lone Pine Capital",
    countryCode: "US",
    notes: "Steve Mandel's Lone Pine Capital 13F filer on SEC EDGAR.",
  },
];

const INFO_TABLE_PATTERN =
  /<(?:(?:\w+):)?infoTable\b[^>]*>([\s\S]*?)<\/(?:(?:\w+):)?infoTable>/gi;

function parseArgs(argv) {
  const options = {
    ciks: [],
    limit: 3,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--limit") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1 || value > 8) {
        throw new Error("--limit must be an integer between 1 and 8");
      }
      options.limit = value;
      index += 1;
      continue;
    }
    if (arg === "--cik") {
      const value = argv[index + 1] ?? "";
      options.ciks.push(
        ...value
          .split(",")
          .map(normalizeCik)
          .filter(Boolean),
      );
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.ciks.length === 0) {
    options.ciks = KNOWN_MANAGERS.map((manager) => manager.cik);
  }

  options.ciks = Array.from(new Set(options.ciks));
  return options;
}

function usage() {
  console.log(`Usage: npm run 13f -- [options]

Options:
  --dry-run          Fetch and parse SEC filings without writing to the DB.
  --limit N          Save the latest N distinct report periods per manager. Default: 3. Range: 1-8.
  --cik LIST         Comma-separated CIK list. Default: known managers.
  -h, --help         Show this help.

Examples:
  npm run 13f:dry
  npm run 13f
  npm run 13f -- --limit 1 --cik 0001608046
`);
}

function normalizeCik(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.padStart(10, "0").slice(-10) : "";
}

function normalizeCusip(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  return /^[A-Z0-9]{9}$/.test(normalized) ? normalized : null;
}

function normalizeTicker(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(normalized) ? normalized : null;
}

function ontologyEnv() {
  const value = process.env.KRW_ONTOLOGY_ENV?.trim().toLowerCase();
  return value === "dev" || value === "staging" || value === "prod"
    ? value
    : "prod";
}

function topMappingLimit() {
  const value = Number.parseInt(process.env.SEC_13F_TOP_MAPPING_LIMIT ?? "", 10);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    return DEFAULT_TOP_MAPPING_LIMIT;
  }
  return value;
}

function secUserAgent() {
  return (
    process.env.SEC_USER_AGENT?.trim() ||
    "KRW Ontology 13F Ingestion ops@krwontology.local"
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": secUserAgent(),
    },
  });
  if (!response.ok) {
    throw new Error(`SEC request failed ${response.status}: ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml,text/plain,*/*",
      "User-Agent": secUserAgent(),
    },
  });
  if (!response.ok) {
    throw new Error(`SEC request failed ${response.status}: ${url}`);
  }
  return response.text();
}

async function fetchOpenFigiMappings(cusips) {
  const normalizedCusips = Array.from(
    new Set(cusips.map(normalizeCusip).filter(Boolean)),
  );
  const apiKey = process.env.OPENFIGI_API_KEY?.trim() || "";
  const batchSize = apiKey ? OPENFIGI_BATCH_WITH_KEY : OPENFIGI_BATCH_WITHOUT_KEY;
  const mappings = [];

  for (let offset = 0; offset < normalizedCusips.length; offset += batchSize) {
    const batch = normalizedCusips.slice(offset, offset + batchSize);
    const response = await fetch(OPENFIGI_MAPPING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-OPENFIGI-APIKEY": apiKey } : {}),
      },
      body: JSON.stringify(
        batch.map((cusip) => ({
          idType: OPENFIGI_ID_TYPE_CUSIP,
          idValue: cusip,
          exchCode: "US",
        })),
      ),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `OpenFIGI mapping failed ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("OpenFIGI mapping returned a non-array response.");
    }

    payload.forEach((jobResult, index) => {
      const cusip = batch[index];
      if (!cusip) return;
      mappings.push(mapOpenFigiJobResult(cusip, jobResult));
    });

    if (!apiKey && offset + batchSize < normalizedCusips.length) {
      await sleep(OPENFIGI_DELAY_WITHOUT_KEY_MS);
    }
  }

  return mappings;
}

function mapOpenFigiJobResult(cusip, jobResult) {
  const data = Array.isArray(jobResult?.data) ? jobResult.data : [];
  const security =
    data.find((item) => stringValue(item?.exchCode) === "US" && item?.ticker) ??
    data.find((item) => item?.ticker) ??
    data[0] ??
    null;

  if (!security) {
    return {
      cusip,
      ticker: null,
      name: null,
      exchCode: null,
      figi: null,
      compositeFigi: null,
      shareClassFigi: null,
      marketSector: null,
      securityType: null,
      securityType2: null,
      securityDescription: null,
      providerStatus: jobResult?.error ? "error" : "not_found",
      rawResponse: jobResult,
    };
  }

  return {
    cusip,
    ticker: normalizeTicker(security.ticker),
    name: stringValue(security.name),
    exchCode: stringValue(security.exchCode),
    figi: stringValue(security.figi),
    compositeFigi: stringValue(security.compositeFIGI),
    shareClassFigi: stringValue(security.shareClassFIGI),
    marketSector: stringValue(security.marketSector),
    securityType: stringValue(security.securityType),
    securityType2: stringValue(security.securityType2),
    securityDescription: stringValue(security.securityDescription),
    providerStatus: "mapped",
    rawResponse: jobResult,
  };
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCharCode(parseInt(code, 16)),
    );
}

function tagValue(block, tagName) {
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

function numericValue(block, tagName) {
  const raw = tagValue(block, tagName);
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function parseInformationTableXml(xml) {
  const holdings = [];
  for (const match of xml.matchAll(INFO_TABLE_PATTERN)) {
    const block = match[1];
    const issuerName = tagValue(block, "nameOfIssuer") ?? "";
    const titleOfClass = tagValue(block, "titleOfClass") ?? "";
    const cusip = (tagValue(block, "cusip") ?? "").toUpperCase();
    if (!issuerName || !cusip) continue;

    holdings.push({
      issuerName,
      titleOfClass,
      cusip,
      valueUsd: numericValue(block, "value") ?? 0,
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

function positionKey(holding) {
  return [
    holding.cusip.trim().toUpperCase(),
    holding.putCall?.trim().toUpperCase() ?? "",
  ].join("|");
}

function addNullableNumbers(left, right) {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function firstText(left, right) {
  return left && left.trim() ? left : right;
}

function aggregateHoldingsByPositionKey(holdings) {
  const byKey = new Map();
  for (const holding of holdings) {
    const key = positionKey(holding);
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
    existing.issuerName = firstText(existing.issuerName, holding.issuerName);
    existing.titleOfClass = firstText(existing.titleOfClass, holding.titleOfClass);
    existing.shareType = firstText(existing.shareType, holding.shareType);
    existing.investmentDiscretion = firstText(
      existing.investmentDiscretion,
      holding.investmentDiscretion,
    );
    existing.otherManager = firstText(existing.otherManager, holding.otherManager);
  }
  return Array.from(byKey.values()).sort((a, b) => b.valueUsd - a.valueUsd);
}

function accessionDirectory(cik, accessionNumber) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g, "")}`;
}

function fileUrl(baseUrl, fileName) {
  return `${baseUrl}/${fileName.split("/").map(encodeURIComponent).join("/")}`;
}

function selectInformationTableXml(indexJson) {
  const xmlFiles = indexJson.directory.item
    .map((item) => item.name)
    .filter((name) => name.toLowerCase().endsWith(".xml"));
  return (
    xmlFiles.find((name) => !name.toLowerCase().includes("primary_doc")) ??
    xmlFiles.find((name) => !name.toLowerCase().includes("primary")) ??
    null
  );
}

function selectFilingDetailDocument(indexJson, accessionNumber) {
  const lowerAccession = accessionNumber.toLowerCase();
  return (
    indexJson.directory.item
      .map((item) => item.name)
      .find((name) => {
        const lowerName = name.toLowerCase();
        return (
          lowerName.startsWith(lowerAccession) &&
          (lowerName.endsWith("-index.html") || lowerName.endsWith("-index.htm"))
        );
      }) ?? `${accessionNumber}-index.html`
  );
}

function latestDistinct13fFilings(submissions, limit) {
  const recent = submissions.filings.recent;
  const byReportPeriod = new Map();

  recent.form.forEach((form, index) => {
    if (form !== "13F-HR" && form !== "13F-HR/A") return;
    const accessionNumber = recent.accessionNumber[index];
    const filingDate = recent.filingDate[index];
    const reportPeriod = recent.reportDate[index];
    if (!accessionNumber || !filingDate || !reportPeriod) return;

    const candidate = {
      accessionNumber,
      form,
      filingDate,
      reportPeriod,
      acceptedAt:
        recent.acceptanceDateTime?.[index] ?? recent.acceptedDate?.[index] ?? null,
      primaryDocument: recent.primaryDocument[index] || null,
    };
    const existing = byReportPeriod.get(reportPeriod);
    if (
      !existing ||
      candidate.filingDate.localeCompare(existing.filingDate) > 0 ||
      candidate.acceptedAt?.localeCompare(existing.acceptedAt ?? "") > 0
    ) {
      byReportPeriod.set(reportPeriod, candidate);
    }
  });

  return Array.from(byReportPeriod.values())
    .sort((a, b) => {
      const reportCompare = b.reportPeriod.localeCompare(a.reportPeriod);
      if (reportCompare !== 0) return reportCompare;
      return b.filingDate.localeCompare(a.filingDate);
    })
    .slice(0, limit);
}

async function fetchFilingPackage(cik, managerMeta, filing) {
  const baseUrl = accessionDirectory(cik, filing.accessionNumber);
  const indexJson = await fetchJson(`${baseUrl}/index.json`);
  const informationTableName = selectInformationTableXml(indexJson);
  if (!informationTableName) {
    throw new Error(`No information table XML for ${filing.accessionNumber}`);
  }

  const informationTableUrl = fileUrl(baseUrl, informationTableName);
  const filingDetailUrl = fileUrl(
    baseUrl,
    selectFilingDetailDocument(indexJson, filing.accessionNumber),
  );
  const xml = await fetchText(informationTableUrl);
  const holdings = parseInformationTableXml(xml);
  if (holdings.length === 0) {
    throw new Error(`No holdings parsed for ${filing.accessionNumber}`);
  }

  return {
    cik,
    managerName: managerMeta.name,
    displayName: managerMeta.displayName,
    countryCode: managerMeta.countryCode,
    notes: managerMeta.notes,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    reportPeriod: filing.reportPeriod,
    acceptedAt: filing.acceptedAt,
    filingDetailUrl,
    primaryDocumentUrl: filing.primaryDocument
      ? fileUrl(baseUrl, filing.primaryDocument)
      : null,
    informationTableUrl,
    holdings,
  };
}

function totalValueUsd(holdings) {
  return holdings.reduce((sum, holding) => sum + holding.valueUsd, 0);
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim());
}

function deriveSupabaseDatabaseUrl(supabaseUrl, password, portOverride) {
  if (!supabaseUrl) return null;
  let parsed;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    return null;
  }

  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    return `postgresql://postgres:${encodeURIComponent(
      password || "postgres",
    )}@${parsed.hostname}:${portOverride || "54322"}/postgres`;
  }

  const match = parsed.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (!match || !password) return null;
  return `postgresql://postgres:${encodeURIComponent(
    password,
  )}@db.${match[1]}.supabase.co:5432/postgres?sslmode=require`;
}

function getDatabaseUrl() {
  return (
    firstNonEmpty(
      process.env.SEC_13F_DATABASE_URL,
      process.env.SUPABASE_DB_URL,
      process.env.DATABASE_URL,
      process.env.POSTGRES_URL,
      process.env.AGENT_QUEUE_LISTEN_DATABASE_URL,
      process.env.AGENT_RUN_EVENT_LISTEN_DATABASE_URL,
      process.env.AGENT_RUN_CANCEL_LISTEN_DATABASE_URL,
    ) ??
    deriveSupabaseDatabaseUrl(
      firstNonEmpty(process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL),
      process.env.SUPABASE_DB_PASSWORD,
      process.env.SUPABASE_DB_PORT,
    )
  );
}

function getSupabaseApiConfig() {
  const supabaseUrl = firstNonEmpty(
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return supabaseUrl && serviceRoleKey
    ? {
        supabaseUrl,
        serviceRoleKey,
      }
    : null;
}

function shouldUseSsl(connectionString) {
  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.get("sslmode") === "disable") return false;
    return parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
  } catch {
    return true;
  }
}

async function upsertManager(client, pkg) {
  await client.query(
    `
      insert into public.institutional_managers (
        cik,
        name,
        display_name,
        country_code,
        notes,
        latest_refresh_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, now(), now())
      on conflict (cik) do update set
        name = excluded.name,
        display_name = excluded.display_name,
        country_code = excluded.country_code,
        notes = excluded.notes,
        latest_refresh_at = excluded.latest_refresh_at,
        updated_at = now()
    `,
    [pkg.cik, pkg.managerName, pkg.displayName, pkg.countryCode, pkg.notes],
  );
}

async function upsertFiling(client, pkg) {
  const result = await client.query(
    `
      insert into public.sec_13f_filings (
        cik,
        accession_number,
        form,
        report_period,
        filing_date,
        accepted_at,
        filing_detail_url,
        primary_document_url,
        information_table_url,
        entry_count,
        total_value_usd,
        source,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'sec_edgar', now())
      on conflict (accession_number) do update set
        cik = excluded.cik,
        form = excluded.form,
        report_period = excluded.report_period,
        filing_date = excluded.filing_date,
        accepted_at = excluded.accepted_at,
        filing_detail_url = excluded.filing_detail_url,
        primary_document_url = excluded.primary_document_url,
        information_table_url = excluded.information_table_url,
        entry_count = excluded.entry_count,
        total_value_usd = excluded.total_value_usd,
        source = excluded.source,
        updated_at = now()
      returning id
    `,
    [
      pkg.cik,
      pkg.accessionNumber,
      pkg.form,
      pkg.reportPeriod,
      pkg.filingDate,
      pkg.acceptedAt,
      pkg.filingDetailUrl,
      pkg.primaryDocumentUrl,
      pkg.informationTableUrl,
      pkg.holdings.length,
      totalValueUsd(pkg.holdings),
    ],
  );
  return result.rows[0].id;
}

async function replaceHoldings(client, filingId, pkg) {
  await client.query("delete from public.sec_13f_holdings where filing_id = $1", [
    filingId,
  ]);

  const columns = [
    "filing_id",
    "cik",
    "report_period",
    "position_key",
    "issuer_name",
    "title_of_class",
    "cusip",
    "ticker",
    "value_usd",
    "shares",
    "share_type",
    "put_call",
    "investment_discretion",
    "other_manager",
    "voting_authority_sole",
    "voting_authority_shared",
    "voting_authority_none",
  ];

  for (let offset = 0; offset < pkg.holdings.length; offset += 500) {
    const chunk = pkg.holdings.slice(offset, offset + 500);
    const values = [];
    const placeholders = chunk.map((holding, rowIndex) => {
      const rowValues = [
        filingId,
        pkg.cik,
        pkg.reportPeriod,
        positionKey(holding),
        holding.issuerName,
        holding.titleOfClass,
        holding.cusip,
        null,
        holding.valueUsd,
        holding.shares,
        holding.shareType,
        holding.putCall,
        holding.investmentDiscretion,
        holding.otherManager,
        holding.votingAuthoritySole,
        holding.votingAuthorityShared,
        holding.votingAuthorityNone,
      ];
      values.push(...rowValues);
      const start = rowIndex * columns.length;
      return `(${columns.map((_column, columnIndex) => `$${start + columnIndex + 1}`).join(", ")})`;
    });

    await client.query(
      `
        insert into public.sec_13f_holdings (${columns.join(", ")})
        values ${placeholders.join(", ")}
        on conflict (filing_id, position_key) do update set
          issuer_name = excluded.issuer_name,
          title_of_class = excluded.title_of_class,
          cusip = excluded.cusip,
          ticker = excluded.ticker,
          value_usd = excluded.value_usd,
          shares = excluded.shares,
          share_type = excluded.share_type,
          put_call = excluded.put_call,
          investment_discretion = excluded.investment_discretion,
          other_manager = excluded.other_manager,
          voting_authority_sole = excluded.voting_authority_sole,
          voting_authority_shared = excluded.voting_authority_shared,
          voting_authority_none = excluded.voting_authority_none
      `,
      values,
    );
  }
}

async function mapTopHoldingsWithPostgres(client, savedFilings) {
  const filingIds = savedFilings.map((item) => item.filingId);
  if (filingIds.length === 0) return { total: 0, mapped: 0, skipped: 0 };

  const topResult = await client.query(
    `
      with ranked as (
        select
          filing_id,
          cusip,
          row_number() over (partition by filing_id order by value_usd desc) as row_number
        from public.sec_13f_holdings
        where filing_id = any($1::uuid[])
      )
      select distinct cusip
      from ranked
      where row_number <= $2
        and cusip is not null
      order by cusip
    `,
    [filingIds, topMappingLimit()],
  );
  const targetCusips = topResult.rows
    .map((row) => normalizeCusip(row.cusip))
    .filter(Boolean);
  if (targetCusips.length === 0) return { total: 0, mapped: 0, skipped: 0 };

  const ontologyTickers = await fetchOntologyTickersWithPostgres(client);
  if (ontologyTickers.size === 0) {
    console.warn(
      `[mapping:pg] no active ontology tickers found for env=${ontologyEnv()}; skipping CUSIP mapping`,
    );
    return { total: targetCusips.length, mapped: 0, skipped: targetCusips.length };
  }

  const existingResult = await client.query(
    `
      select cusip, ticker, provider_status
      from public.sec_13f_cusip_mappings
      where cusip = any($1::text[])
    `,
    [targetCusips],
  );
  const existingByCusip = new Map(
    existingResult.rows.map((row) => [row.cusip, row]),
  );
  const missingCusips = targetCusips.filter((cusip) => !existingByCusip.has(cusip));
  let newMappings = [];
  if (missingCusips.length > 0) {
    const openFigiMappings = await fetchOpenFigiMappings(missingCusips);
    newMappings = openFigiMappings.map((mapping) =>
      constrainMappingToOntology(mapping, ontologyTickers),
    );
  }
  const overrideMappings = manualCusipMappings(targetCusips, ontologyTickers);
  await upsertCusipMappingsWithPostgres(
    client,
    dedupeMappingsByCusip([...newMappings, ...overrideMappings]),
  );

  const mappedRows = dedupeMappingsByCusip([
    ...existingResult.rows
      .map((row) => ({
        cusip: row.cusip,
        ticker: normalizeTicker(row.ticker),
        providerStatus: row.provider_status,
      }))
      .filter((row) => row.providerStatus === "mapped" && row.ticker),
    ...newMappings,
    ...overrideMappings,
  ]).filter((row) => row.providerStatus === "mapped" && row.ticker);
  await updateTickersForCusipsWithPostgres(client, filingIds, mappedRows);

  return {
    total: targetCusips.length,
    mapped: new Set(mappedRows.map((row) => row.cusip)).size,
    skipped:
      targetCusips.length - new Set(mappedRows.map((row) => row.cusip)).size,
  };
}

async function fetchOntologyTickersWithPostgres(client) {
  const result = await client.query(
    `
      select distinct company.ticker
      from public.ontology_companies company
      join public.ontology_catalog_releases release
        on release.env = company.env
        and release.release_id = company.release_id
        and release.active = true
      where company.env = $1
    `,
    [ontologyEnv()],
  );
  return new Set(result.rows.map((row) => normalizeTicker(row.ticker)).filter(Boolean));
}

function constrainMappingToOntology(mapping, ontologyTickers) {
  const ticker = normalizeTicker(mapping.ticker);
  const mapped = ticker && ontologyTickers.has(ticker);
  return {
    ...mapping,
    ticker: mapped ? ticker : null,
    providerStatus: mapped ? "mapped" : mapping.providerStatus === "error" ? "error" : "not_found",
  };
}

function manualCusipMapping(cusip) {
  const normalizedCusip = normalizeCusip(cusip);
  if (!normalizedCusip) return null;
  const override = CUSIP_TICKER_OVERRIDES.get(normalizedCusip);
  if (!override) return null;

  return {
    cusip: normalizedCusip,
    ticker: override.ticker,
    name: override.name,
    exchCode: override.exchCode,
    figi: null,
    compositeFigi: null,
    shareClassFigi: null,
    marketSector: override.marketSector,
    securityType: override.securityType,
    securityType2: override.securityType2,
    securityDescription: override.securityDescription,
    providerStatus: "mapped",
    rawResponse: {
      source: "krw_manual_cusip_override",
      reason: "OpenFIGI can miss active issuer ticker mapping for 13F CUSIP.",
    },
  };
}

function manualCusipMappings(cusips, ontologyTickers) {
  return cusips
    .map(manualCusipMapping)
    .filter(Boolean)
    .map((mapping) => constrainMappingToOntology(mapping, ontologyTickers));
}

function dedupeMappingsByCusip(mappings) {
  const byCusip = new Map();
  for (const mapping of mappings) {
    if (mapping?.cusip) byCusip.set(mapping.cusip, mapping);
  }
  return Array.from(byCusip.values());
}

async function upsertCusipMappingsWithPostgres(client, mappings) {
  if (mappings.length === 0) return;

  const columns = [
    "cusip",
    "ticker",
    "name",
    "exch_code",
    "figi",
    "composite_figi",
    "share_class_figi",
    "market_sector",
    "security_type",
    "security_type_2",
    "security_description",
    "provider",
    "provider_status",
    "raw_response",
    "mapped_at",
  ];

  for (let offset = 0; offset < mappings.length; offset += 500) {
    const chunk = mappings.slice(offset, offset + 500);
    const values = [];
    const placeholders = chunk.map((mapping, rowIndex) => {
      const rowValues = [
        mapping.cusip,
        mapping.ticker,
        mapping.name,
        mapping.exchCode,
        mapping.figi,
        mapping.compositeFigi,
        mapping.shareClassFigi,
        mapping.marketSector,
        mapping.securityType,
        mapping.securityType2,
        mapping.securityDescription,
        "openfigi",
        mapping.providerStatus,
        JSON.stringify(mapping.rawResponse ?? null),
        new Date().toISOString(),
      ];
      values.push(...rowValues);
      const start = rowIndex * columns.length;
      return `(${columns.map((_column, columnIndex) => `$${start + columnIndex + 1}`).join(", ")})`;
    });

    await client.query(
      `
        insert into public.sec_13f_cusip_mappings (${columns.join(", ")})
        values ${placeholders.join(", ")}
        on conflict (cusip) do update set
          ticker = excluded.ticker,
          name = excluded.name,
          exch_code = excluded.exch_code,
          figi = excluded.figi,
          composite_figi = excluded.composite_figi,
          share_class_figi = excluded.share_class_figi,
          market_sector = excluded.market_sector,
          security_type = excluded.security_type,
          security_type_2 = excluded.security_type_2,
          security_description = excluded.security_description,
          provider = excluded.provider,
          provider_status = excluded.provider_status,
          raw_response = excluded.raw_response,
          mapped_at = excluded.mapped_at,
          updated_at = now()
      `,
      values,
    );
  }
}

async function updateTickersForCusipsWithPostgres(client, filingIds, mappedRows) {
  const rows = mappedRows.filter((row) => row.cusip && row.ticker);
  if (rows.length === 0) return;

  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const values = [];
    const placeholders = chunk.map((row, index) => {
      values.push(row.cusip, row.ticker);
      const start = index * 2;
      return `($${start + 1}, $${start + 2})`;
    });
    values.push(filingIds);
    const filingIdsParam = values.length;

    await client.query(
      `
        with mapped(cusip, ticker) as (
          values ${placeholders.join(", ")}
        )
        update public.sec_13f_holdings holding
        set ticker = mapped.ticker
        from mapped
        where holding.cusip = mapped.cusip
          and holding.filing_id = any($${filingIdsParam}::uuid[])
      `,
      values,
    );

    await client.query(
      `
        with mapped(cusip, ticker) as (
          values ${placeholders.join(", ")}
        )
        update public.sec_13f_position_changes changes
        set ticker = mapped.ticker,
            updated_at = now()
        from mapped
        where changes.cusip = mapped.cusip
          and changes.filing_id = any($${filingIdsParam}::uuid[])
      `,
      values,
    );
  }
}

async function refreshPositionChangesForFiling(client, filingId) {
  await client.query("delete from public.sec_13f_position_changes where filing_id = $1", [
    filingId,
  ]);

  const result = await client.query(
    `
      with current_filing as (
        select id, cik, report_period, filing_date, total_value_usd
        from public.sec_13f_filings
        where id = $1
      ),
      previous_filing as (
        select
          previous.id,
          previous.report_period,
          previous.total_value_usd
        from public.sec_13f_filings previous
        join current_filing current on current.cik = previous.cik
        where previous.report_period < current.report_period
        order by previous.report_period desc, previous.filing_date desc
        limit 1
      ),
      current_rows as (
        select
          holding.*,
          case
            when current.total_value_usd > 0
              then holding.value_usd / current.total_value_usd
            else null
          end as current_weight
        from public.sec_13f_holdings holding
        join current_filing current on current.id = holding.filing_id
      ),
      previous_rows as (
        select
          holding.*,
          case
            when previous.total_value_usd > 0
              then holding.value_usd / previous.total_value_usd
            else null
          end as previous_weight
        from public.sec_13f_holdings holding
        join previous_filing previous on previous.id = holding.filing_id
      ),
      position_keys as (
        select position_key from current_rows
        union
        select position_key from previous_rows
      )
      insert into public.sec_13f_position_changes (
        filing_id,
        previous_filing_id,
        cik,
        report_period,
        previous_report_period,
        position_key,
        issuer_name,
        title_of_class,
        cusip,
        ticker,
        change_type,
        current_value_usd,
        previous_value_usd,
        value_change_usd,
        value_change_pct,
        current_weight,
        previous_weight,
        weight_change,
        current_shares,
        previous_shares,
        shares_change,
        shares_change_pct
      )
      select
        current.id as filing_id,
        previous.id as previous_filing_id,
        current.cik,
        current.report_period,
        previous.report_period as previous_report_period,
        keys.position_key,
        coalesce(current_position.issuer_name, previous_position.issuer_name) as issuer_name,
        coalesce(current_position.title_of_class, previous_position.title_of_class) as title_of_class,
        coalesce(current_position.cusip, previous_position.cusip) as cusip,
        coalesce(current_position.ticker, previous_position.ticker, mapping.ticker) as ticker,
        case
          when current_position.position_key is null then 'sold'
          when previous_position.position_key is null then 'new'
          when current_position.shares is not null
            and previous_position.shares is not null
            and current_position.shares > previous_position.shares then 'increased'
          when current_position.shares is not null
            and previous_position.shares is not null
            and current_position.shares < previous_position.shares then 'decreased'
          when current_position.value_usd > previous_position.value_usd then 'increased'
          when current_position.value_usd < previous_position.value_usd then 'decreased'
          else 'unchanged'
        end as change_type,
        coalesce(current_position.value_usd, 0) as current_value_usd,
        previous_position.value_usd as previous_value_usd,
        coalesce(current_position.value_usd, 0) - coalesce(previous_position.value_usd, 0) as value_change_usd,
        case
          when previous_position.value_usd > 0
            then (coalesce(current_position.value_usd, 0) - previous_position.value_usd) / previous_position.value_usd
          else null
        end as value_change_pct,
        coalesce(current_position.current_weight, 0) as current_weight,
        previous_position.previous_weight as previous_weight,
        coalesce(current_position.current_weight, 0) - coalesce(previous_position.previous_weight, 0) as weight_change,
        current_position.shares as current_shares,
        previous_position.shares as previous_shares,
        case
          when current_position.shares is null and previous_position.shares is null then null
          else coalesce(current_position.shares, 0) - coalesce(previous_position.shares, 0)
        end as shares_change,
        case
          when previous_position.shares > 0
            then (coalesce(current_position.shares, 0) - previous_position.shares) / previous_position.shares
          else null
        end as shares_change_pct
      from position_keys keys
      cross join current_filing current
      left join previous_filing previous on true
      left join current_rows current_position
        on current_position.position_key = keys.position_key
      left join previous_rows previous_position
        on previous_position.position_key = keys.position_key
      left join public.sec_13f_cusip_mappings mapping
        on mapping.cusip = coalesce(current_position.cusip, previous_position.cusip)
        and mapping.provider_status = 'mapped'
      order by coalesce(current_position.value_usd, 0) desc
      returning change_type
    `,
    [filingId],
  );

  return result.rows.reduce(
    (counts, row) => {
      counts.total += 1;
      counts[row.change_type] = (counts[row.change_type] ?? 0) + 1;
      return counts;
    },
    { total: 0 },
  );
}

function holdingRows(filingId, pkg) {
  return pkg.holdings.map((holding) => ({
    filing_id: filingId,
    cik: pkg.cik,
    report_period: pkg.reportPeriod,
    position_key: positionKey(holding),
    issuer_name: holding.issuerName,
    title_of_class: holding.titleOfClass,
    cusip: holding.cusip,
    ticker: null,
    value_usd: holding.valueUsd,
    shares: holding.shares,
    share_type: holding.shareType,
    put_call: holding.putCall,
    investment_discretion: holding.investmentDiscretion,
    other_manager: holding.otherManager,
    voting_authority_sole: holding.votingAuthoritySole,
    voting_authority_shared: holding.votingAuthorityShared,
    voting_authority_none: holding.votingAuthorityNone,
  }));
}

async function savePackagesWithPostgres(connectionString, packages) {
  const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const savedFilings = [];
    for (const pkg of packages) {
      await upsertManager(client, pkg);
      const filingId = await upsertFiling(client, pkg);
      await replaceHoldings(client, filingId, pkg);
      savedFilings.push({ filingId, pkg });
      console.log(
        `[saved:pg] ${pkg.displayName} | ${pkg.reportPeriod} | ${pkg.holdings.length.toLocaleString()} holdings`,
      );
    }
    const mappingCounts = await mapTopHoldingsWithPostgres(client, savedFilings);
    console.log(
      [
        "[mapping:pg]",
        `${mappingCounts.total.toLocaleString()} top CUSIPs`,
        `${mappingCounts.mapped.toLocaleString()} mapped to ontology tickers`,
        `${mappingCounts.skipped.toLocaleString()} skipped`,
      ].join(" | "),
    );
    for (const { filingId, pkg } of savedFilings) {
      const counts = await refreshPositionChangesForFiling(client, filingId);
      console.log(
        [
          "[changes:pg]",
          pkg.displayName,
          pkg.reportPeriod,
          `${counts.total.toLocaleString()} positions`,
          `new ${counts.new ?? 0}`,
          `up ${counts.increased ?? 0}`,
          `down ${counts.decreased ?? 0}`,
          `sold ${counts.sold ?? 0}`,
        ].join(" | "),
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (isMissingRelationError(error)) {
      throw migrationError(error);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function savePackagesWithSupabase(config, packages) {
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const savedFilings = [];
  for (const pkg of packages) {
    const { error: managerError } = await supabase
      .from("institutional_managers")
      .upsert(
        {
          cik: pkg.cik,
          name: pkg.managerName,
          display_name: pkg.displayName,
          country_code: pkg.countryCode,
          notes: pkg.notes,
          latest_refresh_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "cik" },
      );
    if (managerError) throw supabaseError(managerError);

    const { data: filing, error: filingError } = await supabase
      .from("sec_13f_filings")
      .upsert(
        {
          cik: pkg.cik,
          accession_number: pkg.accessionNumber,
          form: pkg.form,
          report_period: pkg.reportPeriod,
          filing_date: pkg.filingDate,
          accepted_at: pkg.acceptedAt,
          filing_detail_url: pkg.filingDetailUrl,
          primary_document_url: pkg.primaryDocumentUrl,
          information_table_url: pkg.informationTableUrl,
          entry_count: pkg.holdings.length,
          total_value_usd: totalValueUsd(pkg.holdings),
          source: "sec_edgar",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "accession_number" },
      )
      .select("id")
      .single();
    if (filingError || !filing) {
      throw supabaseError(filingError ?? new Error("empty filing upsert result"));
    }

    const { error: deleteError } = await supabase
      .from("sec_13f_holdings")
      .delete()
      .eq("filing_id", filing.id);
    if (deleteError) throw supabaseError(deleteError);

    const rows = holdingRows(filing.id, pkg);
    for (let offset = 0; offset < rows.length; offset += 500) {
      const chunk = rows.slice(offset, offset + 500);
      const { error: insertError } = await supabase
        .from("sec_13f_holdings")
        .insert(chunk);
      if (insertError) throw supabaseError(insertError);
    }

    savedFilings.push({ filingId: filing.id, pkg });
    console.log(
      `[saved:supabase] ${pkg.displayName} | ${pkg.reportPeriod} | ${pkg.holdings.length.toLocaleString()} holdings`,
    );
  }

  const mappingCounts = await mapTopHoldingsWithSupabase(supabase, savedFilings);
  console.log(
    [
      "[mapping:supabase]",
      `${mappingCounts.total.toLocaleString()} top CUSIPs`,
      `${mappingCounts.mapped.toLocaleString()} mapped to ontology tickers`,
      `${mappingCounts.skipped.toLocaleString()} skipped`,
    ].join(" | "),
  );

  for (const { filingId, pkg } of savedFilings) {
    const counts = await refreshPositionChangesWithSupabase(supabase, filingId);
    console.log(
      [
        "[changes:supabase]",
        pkg.displayName,
        pkg.reportPeriod,
        `${counts.total.toLocaleString()} positions`,
        `new ${counts.new ?? 0}`,
        `up ${counts.increased ?? 0}`,
        `down ${counts.decreased ?? 0}`,
        `sold ${counts.sold ?? 0}`,
      ].join(" | "),
    );
  }
}

async function mapTopHoldingsWithSupabase(supabase, savedFilings) {
  const filingIds = savedFilings.map((item) => item.filingId);
  if (filingIds.length === 0) return { total: 0, mapped: 0, skipped: 0 };

  const targetCusips = new Set();
  for (const filingId of filingIds) {
    const { data, error } = await supabase
      .from("sec_13f_holdings")
      .select("cusip")
      .eq("filing_id", filingId)
      .order("value_usd", { ascending: false })
      .limit(topMappingLimit());
    if (error) throw supabaseError(error);
    for (const row of data ?? []) {
      const cusip = normalizeCusip(row.cusip);
      if (cusip) targetCusips.add(cusip);
    }
  }

  const cusips = Array.from(targetCusips);
  if (cusips.length === 0) return { total: 0, mapped: 0, skipped: 0 };

  const ontologyTickers = await fetchOntologyTickersWithSupabase(supabase);
  if (ontologyTickers.size === 0) {
    console.warn(
      `[mapping:supabase] no active ontology tickers found for env=${ontologyEnv()}; skipping CUSIP mapping`,
    );
    return { total: cusips.length, mapped: 0, skipped: cusips.length };
  }

  const existingRows = [];
  for (let offset = 0; offset < cusips.length; offset += 100) {
    const chunk = cusips.slice(offset, offset + 100);
    const { data, error } = await supabase
      .from("sec_13f_cusip_mappings")
      .select("cusip, ticker, provider_status")
      .in("cusip", chunk);
    if (error) throw supabaseError(error);
    existingRows.push(...(data ?? []));
  }

  const existingByCusip = new Map(existingRows.map((row) => [row.cusip, row]));
  const missingCusips = cusips.filter((cusip) => !existingByCusip.has(cusip));
  let newMappings = [];
  if (missingCusips.length > 0) {
    const openFigiMappings = await fetchOpenFigiMappings(missingCusips);
    newMappings = openFigiMappings.map((mapping) =>
      constrainMappingToOntology(mapping, ontologyTickers),
    );
  }
  const overrideMappings = manualCusipMappings(cusips, ontologyTickers);
  await upsertCusipMappingsWithSupabase(
    supabase,
    dedupeMappingsByCusip([...newMappings, ...overrideMappings]),
  );

  const mappedRows = dedupeMappingsByCusip([
    ...existingRows
      .map((row) => ({
        cusip: row.cusip,
        ticker: normalizeTicker(row.ticker),
        providerStatus: row.provider_status,
      }))
      .filter((row) => row.providerStatus === "mapped" && row.ticker),
    ...newMappings,
    ...overrideMappings,
  ]).filter((row) => row.providerStatus === "mapped" && row.ticker);
  await updateTickersForCusipsWithSupabase(supabase, filingIds, mappedRows);

  return {
    total: cusips.length,
    mapped: new Set(mappedRows.map((row) => row.cusip)).size,
    skipped: cusips.length - new Set(mappedRows.map((row) => row.cusip)).size,
  };
}

async function fetchOntologyTickersWithSupabase(supabase) {
  const { data: releases, error: releaseError } = await supabase
    .from("ontology_catalog_releases")
    .select("release_id")
    .eq("env", ontologyEnv())
    .eq("active", true)
    .limit(1);
  if (releaseError) throw supabaseError(releaseError);
  const releaseId = releases?.[0]?.release_id ?? null;
  if (!releaseId) return new Set();

  const rows = await fetchAllSupabaseRows(
    supabase,
    "ontology_companies",
    "ticker",
    (query) => query.eq("env", ontologyEnv()).eq("release_id", releaseId),
  );
  return new Set(rows.map((row) => normalizeTicker(row.ticker)).filter(Boolean));
}

async function upsertCusipMappingsWithSupabase(supabase, mappings) {
  const rows = mappings.map((mapping) => ({
    cusip: mapping.cusip,
    ticker: mapping.ticker,
    name: mapping.name,
    exch_code: mapping.exchCode,
    figi: mapping.figi,
    composite_figi: mapping.compositeFigi,
    share_class_figi: mapping.shareClassFigi,
    market_sector: mapping.marketSector,
    security_type: mapping.securityType,
    security_type_2: mapping.securityType2,
    security_description: mapping.securityDescription,
    provider: "openfigi",
    provider_status: mapping.providerStatus,
    raw_response: mapping.rawResponse,
    mapped_at: new Date().toISOString(),
  }));

  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const { error } = await supabase
      .from("sec_13f_cusip_mappings")
      .upsert(chunk, { onConflict: "cusip" });
    if (error) throw supabaseError(error);
  }
}

async function updateTickersForCusipsWithSupabase(supabase, filingIds, mappedRows) {
  const rows = mappedRows.filter((row) => row.cusip && row.ticker);
  for (const row of rows) {
    const { error: holdingError } = await supabase
      .from("sec_13f_holdings")
      .update({ ticker: row.ticker })
      .eq("cusip", row.cusip)
      .in("filing_id", filingIds);
    if (holdingError) throw supabaseError(holdingError);

    const { error: changeError } = await supabase
      .from("sec_13f_position_changes")
      .update({ ticker: row.ticker, updated_at: new Date().toISOString() })
      .eq("cusip", row.cusip)
      .in("filing_id", filingIds);
    if (changeError) throw supabaseError(changeError);
  }
}

async function refreshPositionChangesWithSupabase(supabase, filingId) {
  const { data: currentFiling, error: currentError } = await supabase
    .from("sec_13f_filings")
    .select("id, cik, report_period, filing_date, total_value_usd")
    .eq("id", filingId)
    .single();
  if (currentError || !currentFiling) {
    throw supabaseError(currentError ?? new Error("empty current filing result"));
  }

  const { data: previousFilings, error: previousError } = await supabase
    .from("sec_13f_filings")
    .select("id, report_period, total_value_usd")
    .eq("cik", currentFiling.cik)
    .lt("report_period", currentFiling.report_period)
    .order("report_period", { ascending: false })
    .order("filing_date", { ascending: false })
    .limit(1);
  if (previousError) throw supabaseError(previousError);
  const previousFiling = previousFilings?.[0] ?? null;

  const { error: deleteError } = await supabase
    .from("sec_13f_position_changes")
    .delete()
    .eq("filing_id", filingId);
  if (deleteError) throw supabaseError(deleteError);

  const currentHoldings = await fetchAllSupabaseRows(
    supabase,
    "sec_13f_holdings",
    "filing_id, cik, report_period, position_key, issuer_name, title_of_class, cusip, ticker, value_usd, shares",
    (query) => query.eq("filing_id", filingId).order("value_usd", { ascending: false }),
  );
  const previousHoldings = previousFiling
    ? await fetchAllSupabaseRows(
        supabase,
        "sec_13f_holdings",
        "filing_id, cik, report_period, position_key, issuer_name, title_of_class, cusip, ticker, value_usd, shares",
        (query) =>
          query
            .eq("filing_id", previousFiling.id)
            .order("value_usd", { ascending: false }),
      )
    : [];
  const mappingsByCusip = await fetchCusipMappings(
    supabase,
    new Set(
      [...currentHoldings, ...previousHoldings]
        .map((holding) => holding.cusip)
        .filter(Boolean),
    ),
  );

  const currentByKey = new Map(
    currentHoldings.map((holding) => [holding.position_key, holding]),
  );
  const previousByKey = new Map(
    previousHoldings.map((holding) => [holding.position_key, holding]),
  );
  const keys = Array.from(new Set([...currentByKey.keys(), ...previousByKey.keys()]));
  const currentTotal = Number(currentFiling.total_value_usd ?? 0);
  const previousTotal = Number(previousFiling?.total_value_usd ?? 0);
  const rows = keys.map((key) => {
    const current = currentByKey.get(key) ?? null;
    const previous = previousByKey.get(key) ?? null;
    const cusip = current?.cusip ?? previous?.cusip;
    const mapping = cusip ? mappingsByCusip.get(cusip) : null;
    const currentValue = current ? Number(current.value_usd ?? 0) : 0;
    const previousValue =
      previous && previous.value_usd !== null ? Number(previous.value_usd) : null;
    const currentShares =
      current && current.shares !== null ? Number(current.shares) : null;
    const previousShares =
      previous && previous.shares !== null ? Number(previous.shares) : null;
    const currentWeight = current
      ? currentTotal > 0
        ? currentValue / currentTotal
        : null
      : 0;
    const previousWeight = previous
      ? previousTotal > 0
        ? Number(previous.value_usd ?? 0) / previousTotal
        : null
      : null;

    return {
      filing_id: currentFiling.id,
      previous_filing_id: previousFiling?.id ?? null,
      cik: currentFiling.cik,
      report_period: currentFiling.report_period,
      previous_report_period: previousFiling?.report_period ?? null,
      position_key: key,
      issuer_name: current?.issuer_name ?? previous?.issuer_name,
      title_of_class: current?.title_of_class ?? previous?.title_of_class ?? null,
      cusip,
      ticker: normalizeTickerForPersistence(
        current?.ticker ?? previous?.ticker ?? mapping?.ticker ?? null,
      ),
      change_type: positionChangeType(current, previous),
      current_value_usd: currentValue,
      previous_value_usd: previousValue,
      value_change_usd: currentValue - (previousValue ?? 0),
      value_change_pct:
        previousValue && previousValue > 0
          ? (currentValue - previousValue) / previousValue
          : null,
      current_weight: currentWeight,
      previous_weight: previousWeight,
      weight_change: (currentWeight ?? 0) - (previousWeight ?? 0),
      current_shares: currentShares,
      previous_shares: previousShares,
      shares_change:
        currentShares === null && previousShares === null
          ? null
          : (currentShares ?? 0) - (previousShares ?? 0),
      shares_change_pct:
        previousShares && previousShares > 0
          ? ((currentShares ?? 0) - previousShares) / previousShares
          : null,
    };
  });

  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const { error } = await supabase.from("sec_13f_position_changes").insert(chunk);
    if (error) throw supabaseError(error);
  }

  return rows.reduce(
    (counts, row) => {
      counts.total += 1;
      counts[row.change_type] = (counts[row.change_type] ?? 0) + 1;
      return counts;
    },
    { total: 0 },
  );
}

async function fetchAllSupabaseRows(supabase, table, select, configureQuery) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from(table)
      .select(select)
      .range(offset, offset + pageSize - 1);
    query = configureQuery(query);
    const { data, error } = await query;
    if (error) throw supabaseError(error);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchCusipMappings(supabase, cusips) {
  const mappings = new Map();
  const values = Array.from(cusips);
  for (let offset = 0; offset < values.length; offset += 100) {
    const chunk = values.slice(offset, offset + 100);
    const { data, error } = await supabase
      .from("sec_13f_cusip_mappings")
      .select("cusip, ticker")
      .eq("provider_status", "mapped")
      .in("cusip", chunk);
    if (error) throw supabaseError(error);
    for (const mapping of data ?? []) {
      mappings.set(mapping.cusip, mapping);
    }
  }
  return mappings;
}

function normalizeTickerForPersistence(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function positionChangeType(current, previous) {
  if (!current) return "sold";
  if (!previous) return "new";

  const currentShares =
    current.shares === null || current.shares === undefined ? null : Number(current.shares);
  const previousShares =
    previous.shares === null || previous.shares === undefined
      ? null
      : Number(previous.shares);
  if (currentShares !== null && previousShares !== null) {
    if (currentShares > previousShares) return "increased";
    if (currentShares < previousShares) return "decreased";
  }

  const currentValue = Number(current.value_usd ?? 0);
  const previousValue = Number(previous.value_usd ?? 0);
  if (currentValue > previousValue) return "increased";
  if (currentValue < previousValue) return "decreased";
  return "unchanged";
}

function isMissingRelationError(error) {
  const message = errorMessage(error);
  return (
    /relation .* does not exist/i.test(message) ||
    /Could not find the table/i.test(message)
  );
}

function migrationError(error) {
  return new Error(
    `${errorMessage(error)}. Apply the SEC 13F migrations before running npm run 13f.`,
  );
}

function supabaseError(error) {
  if (isMissingRelationError(error)) return migrationError(error);
  return error instanceof Error ? error : new Error(errorMessage(error));
}

function isDirectDatabaseUnavailableError(error) {
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|ECONNRESET/i.test(
    errorMessage(error),
  );
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message || error.stack || error.name;
  }
  if (error && typeof error === "object") {
    const parts = [
      "message" in error ? error.message : null,
      "details" in error ? error.details : null,
      "hint" in error ? error.hint : null,
      "code" in error ? `code=${error.code}` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  return String(error);
}

async function fetchManagerPackages(manager, limit) {
  const submissions = await fetchJson(
    `https://data.sec.gov/submissions/CIK${manager.cik}.json`,
  );
  const filings = latestDistinct13fFilings(submissions, limit);
  if (filings.length === 0) {
    throw new Error(`No 13F-HR filings found for ${manager.cik}`);
  }

  const secManagerName = submissions.name || manager.name;
  const packages = [];
  for (const filing of filings) {
    const pkg = await fetchFilingPackage(
      manager.cik,
      { ...manager, name: secManagerName },
      filing,
    );
    packages.push(pkg);
  }
  return packages;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const managers = options.ciks.map((cik) => {
    const known = KNOWN_MANAGERS.find((manager) => manager.cik === cik);
    return (
      known ?? {
        cik,
        name: `CIK ${cik}`,
        displayName: `CIK ${cik}`,
        countryCode: null,
        notes: "SEC EDGAR 13F filer.",
      }
    );
  });

  console.log(
    `SEC 13F refresh: ${managers.length} manager(s), latest ${options.limit} report period(s)`,
  );

  const packages = [];
  for (const manager of managers) {
    const managerPackages = await fetchManagerPackages(manager, options.limit);
    packages.push(...managerPackages);
    for (const pkg of managerPackages) {
      console.log(
        [
          options.dryRun ? "[dry-run]" : "[fetched]",
          pkg.displayName,
          pkg.reportPeriod,
          pkg.form,
          pkg.accessionNumber,
          `${pkg.holdings.length.toLocaleString()} holdings`,
          formatUsd(totalValueUsd(pkg.holdings)),
        ].join(" | "),
      );
    }
  }

  if (options.dryRun) {
    console.log("Dry run complete. No database writes performed.");
    return;
  }

  const connectionString = getDatabaseUrl();
  if (connectionString) {
    try {
      await savePackagesWithPostgres(connectionString, packages);
    } catch (error) {
      const supabaseConfig = getSupabaseApiConfig();
      if (!supabaseConfig || !isDirectDatabaseUnavailableError(error)) {
        throw error;
      }
      console.warn(
        "Direct Postgres connection is unavailable; retrying with Supabase service role API.",
      );
      await savePackagesWithSupabase(supabaseConfig, packages);
    }
  } else {
    const supabaseConfig = getSupabaseApiConfig();
    if (!supabaseConfig) {
      throw new Error(
        "Missing database connection. Set SEC_13F_DATABASE_URL, SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD, or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
      );
    }
    await savePackagesWithSupabase(supabaseConfig, packages);
  }

  console.log(`SEC 13F refresh complete. Saved ${packages.length} filing(s).`);
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 1 : 0,
  }).format(value);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
