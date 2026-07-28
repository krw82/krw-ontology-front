#!/usr/bin/env node

/**
 * Publish the image carousel prepared for one company into production.
 *
 * Each ticker owns one immutable "business-model" series/episode.  The
 * deterministic IDs make the command safe to rerun after an interrupted
 * upload: an existing published episode is reported instead of duplicated.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const bucket = "pulse-editorial";
const defaultImagesRoot = "~/Desktop/mmmmm/reports/images";
const supportedMimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);
const maxImageBytes = 8 * 1024 * 1024;
const maxSlides = 8;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

const target = readProductionTarget();
const envFile = resolvePath(options.envFile || ".env.mac-worker.production");
loadEnvFile(envFile, { override: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(`Production Supabase credentials are missing from ${envFile}.`);
}
assertProductionSupabaseTarget(supabaseUrl, target.supabaseProjectRef);

const imagesRoot = resolvePath(options.imagesRoot || defaultImagesRoot);
const reportsRoot = resolvePath(options.reportsRoot || path.dirname(imagesRoot));
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await assertEditorialBucket(supabase);

const tickers = options.all
  ? await listTickers(imagesRoot)
  : [normalizeTicker(options.ticker)];
const createdBy = options.dryRun ? null : await resolveCreatedBy(supabase, options.createdBy);

let imported = 0;
let skipped = 0;
let failed = 0;
for (const ticker of tickers) {
  try {
    const result = await publishTicker({
      ticker,
      supabase,
      imagesRoot,
      reportsRoot,
      createdBy,
      dryRun: options.dryRun,
      distributeToPulse: !options.noPulse,
    });
    if (result === "imported") imported += 1;
    if (result === "skipped") skipped += 1;
  } catch (error) {
    failed += 1;
    console.error(`[editorial] ${ticker} failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!options.all) process.exitCode = 1;
  }
}

console.log([
  "Editorial publish complete.",
  `target=${target.supabaseProjectRef}`,
  `imported=${imported}`,
  `skipped=${skipped}`,
  `failed=${failed}`,
  `pulse=${options.noPulse ? "off" : "early"}`,
  `mode=${options.dryRun ? "dry-run" : "apply"}`,
].join(" "));
if (failed > 0) process.exitCode = 1;

function printUsage() {
  console.log(`Usage:
  npm run editorial:publish -- AAPL
  npm run editorial:publish -- AAPL --dry-run
  npm run editorial:publish -- --all

Options:
  --all                    Publish every non-empty ticker directory.
  --dry-run                Validate files and production target without writing.
  --no-pulse               Publish only on the company page, not Pulse.
  --images-root PATH       Defaults to ${defaultImagesRoot}
  --reports-root PATH      Defaults to the parent of --images-root.
  --env-file PATH          Defaults to .env.mac-worker.production.
  --created-by UUID        Use a specific existing editorial author.
`);
}

function parseArgs(args) {
  const parsed = {
    ticker: "",
    all: false,
    dryRun: false,
    noPulse: false,
    imagesRoot: "",
    reportsRoot: "",
    envFile: "",
    createdBy: "",
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--all") {
      parsed.all = true;
    } else if (argument === "--dry-run") {
      parsed.dryRun = true;
    } else if (argument === "--no-pulse") {
      parsed.noPulse = true;
    } else if (argument === "--images-root") {
      parsed.imagesRoot = args[++index] || "";
    } else if (argument === "--reports-root") {
      parsed.reportsRoot = args[++index] || "";
    } else if (argument === "--env-file") {
      parsed.envFile = args[++index] || "";
    } else if (argument === "--created-by") {
      parsed.createdBy = args[++index] || "";
    } else if (argument === "--help" || argument === "-h") {
      parsed.help = true;
    } else if (!argument.startsWith("-") && !parsed.ticker) {
      parsed.ticker = argument;
    } else {
      throw new Error(`Unknown or duplicate argument: ${argument}`);
    }
  }
  if (!parsed.help && parsed.all === Boolean(parsed.ticker)) {
    throw new Error("Supply one ticker or --all.");
  }
  return parsed;
}

function resolvePath(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function normalizeTicker(value) {
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) throw new Error(`Invalid ticker: ${value}`);
  return ticker;
}

function readProductionTarget() {
  const file = path.join(repoRoot, "ops/production-target.json");
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (!/^[a-z0-9]{20}$/i.test(value?.supabaseProjectRef ?? "")) {
    throw new Error(`Invalid Supabase production target in ${file}.`);
  }
  return value;
}

function loadEnvFile(file, { override = false } = {}) {
  if (!existsSync(file)) throw new Error(`Missing env file: ${file}`);
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equals = line.indexOf("=");
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (override || !process.env[key]) process.env[key] = value;
  }
}

function assertProductionSupabaseTarget(value, expectedProjectRef) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL.");
  }
  const expectedHost = `${expectedProjectRef}.supabase.co`;
  if (parsed.hostname !== expectedHost) {
    throw new Error(`Refusing non-production Supabase target: ${parsed.hostname}`);
  }
}

async function assertEditorialBucket(client) {
  const { data, error } = await client.storage.listBuckets();
  if (error) throw new Error(`Unable to inspect Storage buckets: ${error.message}`);
  if (!data?.some((item) => item.id === bucket)) {
    throw new Error(`Production Storage bucket is missing: ${bucket}`);
  }
}

async function listTickers(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeTicker(entry.name));
  const tickers = [];
  for (const ticker of candidates) {
    const children = await readdir(path.join(root, ticker), { withFileTypes: true });
    const hasImage = children.some((child) => child.isFile()
      && supportedMimeTypes.has(path.extname(child.name).toLowerCase()));
    if (hasImage) tickers.push(ticker);
    else console.log(`[editorial] ${ticker} skipped: no supported image files.`);
  }
  return tickers.sort((left, right) => left.localeCompare(right));
}

async function resolveCreatedBy(client, explicitValue) {
  if (explicitValue) {
    assertUuid(explicitValue, "--created-by");
    return explicitValue;
  }
  const { data, error } = await client
    .from("pulse_editorial_series")
    .select("created_by")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Unable to resolve editorial author: ${error.message}`);
  const author = data?.[0]?.created_by;
  if (!author) {
    throw new Error("No existing editorial author found. Pass --created-by UUID once.");
  }
  assertUuid(author, "existing editorial author");
  return author;
}

async function publishTicker({
  ticker,
  supabase: client,
  imagesRoot,
  reportsRoot,
  createdBy,
  dryRun,
  distributeToPulse,
}) {
  const assets = await prepareAssets(ticker, imagesRoot);
  const copy = await readStoryCopy(ticker, reportsRoot);
  const seriesId = stableUuid(`krw-editorial:series:${ticker}:business-model:v1`);
  const entryId = stableUuid(`krw-editorial:entry:${ticker}:business-model:1:v1`);
  const distributionId = stableUuid(`krw-editorial:distribution:${ticker}:business-model:1:pulse:v1`);

  const { data: existingEntry, error: existingEntryError } = await client
    .from("pulse_editorial_entries")
    .select("id, status, company_visible, pulse_editorial_assets(id)")
    .eq("id", entryId)
    .maybeSingle();
  if (existingEntryError) throw new Error(`Unable to inspect existing entry: ${existingEntryError.message}`);
  if (existingEntry) {
    console.log(`[editorial] ${ticker} skipped: existing entry=${entryId} assets=${existingEntry.pulse_editorial_assets?.length ?? 0}`);
    return "skipped";
  }

  const { data: existingSeries, error: existingSeriesError } = await client
    .from("pulse_editorial_series")
    .select("id, status")
    .eq("id", seriesId)
    .maybeSingle();
  if (existingSeriesError) throw new Error(`Unable to inspect existing series: ${existingSeriesError.message}`);
  if (existingSeries?.status === "archived") throw new Error("The deterministic business-model series is archived.");

  if (dryRun) {
    console.log(`[editorial] ${ticker} ready: slides=${assets.length} series=${existingSeries ? "existing" : "new"} pulse=${distributeToPulse ? "early" : "off"}`);
    return "imported";
  }

  const uploadedPaths = [];
  let insertedSeries = false;
  let insertedEntry = false;
  try {
    for (const asset of assets) {
      const outcome = await ensureStorageAsset(client, asset);
      if (outcome === "uploaded") uploadedPaths.push(asset.storagePath);
    }

    if (!existingSeries) {
      const { error } = await client.from("pulse_editorial_series").insert({
        id: seriesId,
        ticker,
        slug: "business-model",
        status: "published",
        title: "돈 버는 구조",
        summary: copy.summary,
        created_by: createdBy,
      });
      if (error) throw new Error(`Unable to create series: ${error.message}`);
      insertedSeries = true;
    } else if (existingSeries.status === "draft") {
      const { error } = await client.from("pulse_editorial_series").update({ status: "published" }).eq("id", seriesId);
      if (error) throw new Error(`Unable to publish existing series: ${error.message}`);
    }

    const now = new Date().toISOString();
    const { error: entryError } = await client.from("pulse_editorial_entries").insert({
      id: entryId,
      series_id: seriesId,
      episode_number: 1,
      company_visible: true,
      slug: entrySlugFor(ticker),
      status: "published",
      format: "carousel",
      title: copy.title,
      body: "",
      ticker,
      action_label: null,
      action_href: null,
      publish_at: now,
      expires_at: null,
      created_by: createdBy,
    });
    if (entryError) throw new Error(`Unable to create entry: ${entryError.message}`);
    insertedEntry = true;

    const { error: assetsError } = await client.from("pulse_editorial_assets").insert(assets.map((asset) => ({
      id: asset.id,
      entry_id: entryId,
      position: asset.position,
      storage_path: asset.storagePath,
      alt_text: `${ticker} 돈 버는 구조 슬라이드 ${asset.position + 1}`,
      mime_type: asset.mimeType,
      byte_size: asset.byteSize,
      width: asset.width,
      height: asset.height,
    })));
    if (assetsError) throw new Error(`Unable to register assets: ${assetsError.message}`);

    if (distributeToPulse) {
      const { error: distributionError } = await client.from("pulse_editorial_distributions").insert({
        id: distributionId,
        entry_id: entryId,
        channel: "pulse",
        status: "active",
        placement: "early",
        priority: 0,
        starts_at: now,
        ends_at: null,
        created_by: createdBy,
      });
      if (distributionError) throw new Error(`Unable to activate Pulse distribution: ${distributionError.message}`);
    }
  } catch (error) {
    if (insertedEntry) await client.from("pulse_editorial_entries").delete().eq("id", entryId).catch(() => undefined);
    if (insertedSeries) await client.from("pulse_editorial_series").delete().eq("id", seriesId).catch(() => undefined);
    if (uploadedPaths.length > 0) await client.storage.from(bucket).remove(uploadedPaths).catch(() => undefined);
    throw error;
  }

  const { count, error: verifyError } = await client
    .from("pulse_editorial_assets")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);
  if (verifyError || count !== assets.length) {
    throw new Error(`Post-publish verification failed: expected ${assets.length} assets, found ${count ?? 0}.`);
  }
  console.log(`[editorial] ${ticker} published: slides=${assets.length} entry=${entryId} pulse=${distributeToPulse ? "early" : "off"}`);
  return "imported";
}

async function prepareAssets(ticker, imagesRoot) {
  const directory = path.join(imagesRoot, ticker);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    throw new Error(`Image directory is missing: ${directory}`);
  });
  const names = entries
    .filter((entry) => entry.isFile() && supportedMimeTypes.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort(compareSlideNames);
  if (names.length < 2 || names.length > maxSlides) {
    throw new Error(`Expected 2-${maxSlides} PNG/JPG/WebP slides, found ${names.length}.`);
  }
  return Promise.all(names.map(async (name, position) => {
    const localPath = path.join(directory, name);
    const file = await stat(localPath);
    if (!file.isFile() || file.size <= 0 || file.size > maxImageBytes) {
      throw new Error(`Image must be non-empty and at most 8MB: ${localPath}`);
    }
    const mimeType = supportedMimeTypes.get(path.extname(name).toLowerCase());
    if (!mimeType) throw new Error(`Unsupported image type: ${localPath}`);
    const metadata = await sharp(localPath, { animated: false }).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Unable to determine image dimensions: ${localPath}`);
    const content = await readFile(localPath);
    const contentHash = createHash("sha256").update(content).digest("hex");
    const id = stableUuid(`krw-editorial:asset:${ticker}:business-model:1:${position}:${contentHash}`);
    return {
      id,
      position,
      localPath,
      mimeType,
      byteSize: file.size,
      width: metadata.width,
      height: metadata.height,
      contentHash,
      storagePath: `series/${stableUuid(`krw-editorial:series:${ticker}:business-model:v1`)}/episodes/${stableUuid(`krw-editorial:entry:${ticker}:business-model:1:v1`)}/slides/${String(position).padStart(2, "0")}-${id}${path.extname(name).toLowerCase()}`,
    };
  }));
}

function compareSlideNames(left, right) {
  const leftNumber = Number.parseInt(left, 10);
  const rightNumber = Number.parseInt(right, 10);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, { numeric: true });
}

async function readStoryCopy(ticker, reportsRoot) {
  const fallback = { title: `${ticker} 돈 버는 구조`, summary: "" };
  const report = await readFile(path.join(reportsRoot, `${ticker}.md`), "utf8").catch(() => "");
  if (!report) return fallback;
  const heading = report.match(/^#\s+[^—\n]+(?:—\s*)?(.+)$/m)?.[1]?.trim() ?? "";
  const title = truncate(heading.replace(/\s*\([^)]*\)\s*/g, "").trim() || fallback.title, 160);
  const summary = report.match(/^>\s*한 줄 요약:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { title, summary: truncate(summary, 2000) };
}

async function ensureStorageAsset(client, asset) {
  const contents = await readFile(asset.localPath);
  const { error } = await client.storage.from(bucket).upload(asset.storagePath, contents, {
    contentType: asset.mimeType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (!error) return "uploaded";

  const { data: existing, error: downloadError } = await client.storage.from(bucket).download(asset.storagePath);
  if (downloadError || !existing) {
    throw new Error(`Unable to upload ${asset.storagePath}: ${error.message}`);
  }
  const existingHash = createHash("sha256").update(Buffer.from(await existing.arrayBuffer())).digest("hex");
  if (existingHash !== asset.contentHash) {
    throw new Error(`Immutable Storage object differs from source: ${asset.storagePath}`);
  }
  return "existing";
}

function stableUuid(seed) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function entrySlugFor(ticker) {
  return `${ticker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-business-model`;
}

function assertUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(0, maxLength).trimEnd();
}
