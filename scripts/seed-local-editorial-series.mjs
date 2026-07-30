#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Client } = pg;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const supportedMimeTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}
if (!options.manifestPath || !options.assetsDirectory) {
  printUsage();
  process.exit(1);
}

loadEnvFile(path.join(repoRoot, ".env"));
loadEnvFile(path.join(repoRoot, ".env.local"), { override: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Local SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}
assertLoopbackUrl(supabaseUrl, "SUPABASE_URL");

const databaseUrl = options.databaseUrl
  || process.env.SUPABASE_LOCAL_DB_URL
  || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
assertLoopbackUrl(databaseUrl, "local database URL");

const manifestPath = resolvePath(options.manifestPath);
const assetsDirectory = resolvePath(options.assetsDirectory);
const manifestModule = await import(pathToFileURL(manifestPath).href);
const manifest = manifestModule.default ?? manifestModule.manifest;
validateManifest(manifest);

const assets = await prepareAssets(manifest, assetsDirectory);
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const database = new Client({ connectionString: databaseUrl });

try {
  await database.connect();
  await assertSeedUser(database, manifest.createdBy);

  const storageSummary = await ensureStorageObjects({
    database,
    supabase,
    manifest,
    assets,
    dryRun: options.dryRun,
  });

  if (options.dryRun) {
    console.log([
      "Editorial seed dry run passed.",
      `series=${manifest.series.ticker}/${manifest.series.slug}`,
      `existing=${storageSummary.existing}`,
      `missing=${storageSummary.missing}`,
      "database=unchanged",
    ].join(" "));
    process.exit(0);
  }

  await upsertEditorialMetadata(database, manifest, assets);
  const verification = await verifyEditorialSeed(database, manifest, assets);
  console.log([
    "Editorial seed complete.",
    `ticker=${manifest.series.ticker}`,
    `storage=${storageSummary.existing + storageSummary.uploaded}/${assets.length}`,
    `series=${verification.series}`,
    `entry=${verification.entry}`,
    `assets=${verification.assets}`,
    `pulse_distribution=${verification.distribution}`,
  ].join(" "));
} finally {
  await database.end().catch(() => undefined);
}

function printUsage() {
  console.log(`Usage:
  npm run editorial:seed:local -- \\
    --manifest scripts/editorial/manifests/aapl-services-ecosystem.mjs \\
    --assets-dir /absolute/path/to/slides [--dry-run] [--db-url postgresql://...]`);
}

function parseArgs(args) {
  const parsed = {
    manifestPath: "",
    assetsDirectory: "",
    databaseUrl: "",
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--manifest":
        parsed.manifestPath = args[++index] || "";
        break;
      case "--assets-dir":
        parsed.assetsDirectory = args[++index] || "";
        break;
      case "--db-url":
        parsed.databaseUrl = args[++index] || "";
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function resolvePath(input) {
  return path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
}

function loadEnvFile(filePath, { override = false } = {}) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (override || !process.env[key]) process.env[key] = value;
  }
}

function assertLoopbackUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (!loopbackHosts.has(parsed.hostname)) {
    throw new Error(`${label} must point to local Supabase. Refusing host: ${parsed.hostname}`);
  }
}

function validateManifest(value) {
  if (!value || typeof value !== "object") throw new Error("Manifest must export an object.");
  const { bucket, createdBy, series, entry, assets } = value;
  if (bucket !== "pulse-editorial") throw new Error("Only the pulse-editorial bucket is supported.");
  assertUuid(createdBy, "createdBy");
  assertUuid(series?.id, "series.id");
  assertUuid(entry?.id, "entry.id");
  if (!/^[A-Z0-9.]{1,12}$/.test(series?.ticker ?? "")) throw new Error("series.ticker must be uppercase.");
  if (!isSlug(series?.slug) || !isSlug(entry?.slug)) throw new Error("Series and entry slugs must be URL-safe.");
  if (!series?.title || !entry?.title || !entry?.format) throw new Error("Series and entry titles/formats are required.");
  if (!Number.isInteger(entry?.episodeNumber) || entry.episodeNumber < 1) throw new Error("entry.episodeNumber must be positive.");
  if (!Array.isArray(assets) || assets.length === 0 || assets.length > 32) throw new Error("assets must contain 1–32 slides.");
  const seenIds = new Set();
  const seenPositions = new Set();
  for (const asset of assets) {
    assertUuid(asset?.id, "asset.id");
    if (seenIds.has(asset.id)) throw new Error(`Duplicate asset id: ${asset.id}`);
    if (!Number.isInteger(asset.position) || asset.position < 0 || asset.position > 31) throw new Error(`Invalid position for ${asset.id}`);
    if (seenPositions.has(asset.position)) throw new Error(`Duplicate asset position: ${asset.position}`);
    if (!asset.sourceFile || !asset.altText || !supportedMimeTypes.has(asset.mimeType)) throw new Error(`Incomplete asset manifest for ${asset.id}`);
    seenIds.add(asset.id);
    seenPositions.add(asset.position);
  }
  const expectedPositions = [...seenPositions].sort((left, right) => left - right);
  if (expectedPositions.some((position, index) => position !== index)) {
    throw new Error("Asset positions must start at 0 and have no gaps.");
  }
  if (value.distribution) {
    assertUuid(value.distribution.id, "distribution.id");
    if (!Number.isInteger(value.distribution.priority) || value.distribution.priority < -100 || value.distribution.priority > 100) {
      throw new Error("distribution.priority must be between -100 and 100.");
    }
    if (!Number.isInteger(value.distribution.durationDays) || value.distribution.durationDays < 1 || value.distribution.durationDays > 366) {
      throw new Error("distribution.durationDays must be between 1 and 366.");
    }
  }
}

function assertUuid(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
}

function isSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

async function prepareAssets(manifest, assetsDirectory) {
  const resolvedDirectory = path.resolve(assetsDirectory);
  return Promise.all(manifest.assets.map(async (asset) => {
    const localPath = path.resolve(resolvedDirectory, asset.sourceFile);
    const relativePath = path.relative(resolvedDirectory, localPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(`Asset path escapes --assets-dir: ${asset.sourceFile}`);
    }
    const file = await stat(localPath);
    if (!file.isFile()) throw new Error(`Asset is not a file: ${localPath}`);
    if (file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error(`Asset size is invalid: ${localPath}`);
    const extension = supportedMimeTypes.get(asset.mimeType);
    return {
      ...asset,
      localPath,
      byteSize: file.size,
      storagePath: `series/${manifest.series.id}/episodes/${manifest.entry.id}/slides/${String(asset.position).padStart(2, "0")}-${asset.id}.${extension}`,
    };
  }));
}

async function assertSeedUser(database, userId) {
  const result = await database.query("select 1 from auth.users where id = $1", [userId]);
  if (result.rowCount !== 1) throw new Error(`Local seed user is missing: ${userId}`);
}

async function ensureStorageObjects({ database, supabase, manifest, assets, dryRun }) {
  const existingByPath = await readStorageObjects(database, manifest.bucket, assets.map((asset) => asset.storagePath));
  let existing = 0;
  let uploaded = 0;
  let missing = 0;

  for (const asset of assets) {
    const stored = existingByPath.get(asset.storagePath);
    if (stored) {
      assertStoredAssetMatches(stored, asset);
      existing += 1;
      console.log(`[editorial:storage] existing ${asset.storagePath}`);
      continue;
    }
    missing += 1;
    if (dryRun) {
      console.log(`[editorial:storage] missing ${asset.storagePath}`);
      continue;
    }
    await uploadAssetWithRecovery({ database, supabase, bucket: manifest.bucket, asset });
    uploaded += 1;
  }

  if (!dryRun) {
    const verified = await readStorageObjects(database, manifest.bucket, assets.map((asset) => asset.storagePath));
    for (const asset of assets) {
      const stored = verified.get(asset.storagePath);
      if (!stored) throw new Error(`Storage verification failed: ${asset.storagePath}`);
      assertStoredAssetMatches(stored, asset);
    }
  }
  return { existing, uploaded, missing };
}

async function readStorageObjects(database, bucket, paths) {
  const result = await database.query(
    `select name,
            nullif(metadata->>'size', '')::bigint as byte_size,
            metadata->>'mimetype' as mime_type
       from storage.objects
      where bucket_id = $1
        and name = any($2::text[])`,
    [bucket, paths],
  );
  return new Map(result.rows.map((row) => [row.name, row]));
}

function assertStoredAssetMatches(stored, asset) {
  if (Number(stored.byte_size) !== asset.byteSize) {
    throw new Error(`Immutable asset differs from source: ${asset.storagePath}`);
  }
  if (stored.mime_type && stored.mime_type !== asset.mimeType) {
    throw new Error(`Immutable asset mime type differs from source: ${asset.storagePath}`);
  }
}

async function uploadAssetWithRecovery({ database, supabase, bucket, asset }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const contents = await readFile(asset.localPath);
    const { error } = await supabase.storage
      .from(bucket)
      .upload(asset.storagePath, contents, {
        contentType: asset.mimeType,
        cacheControl: "31536000",
        upsert: false,
      });
    if (!error) {
      console.log(`[editorial:storage] uploaded ${asset.storagePath}`);
      return;
    }

    const afterFailure = await readStorageObjects(database, bucket, [asset.storagePath]);
    const stored = afterFailure.get(asset.storagePath);
    if (stored) {
      assertStoredAssetMatches(stored, asset);
      console.log(`[editorial:storage] recovered existing ${asset.storagePath}`);
      return;
    }
    lastError = error;
    if (!isRetryableStorageError(error) || attempt === 3) break;
    await sleep(attempt * 1_000);
  }
  throw new Error(`Unable to upload ${asset.storagePath}: ${lastError?.message ?? "unknown Storage error"}`);
}

function isRetryableStorageError(error) {
  const text = `${error?.message ?? ""} ${error?.error ?? ""}`.toLowerCase();
  return text.includes("timeout") || text.includes("upstream") || text.includes("fetch failed") || text.includes("lock");
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function upsertEditorialMetadata(database, manifest, assets) {
  await database.query("begin");
  try {
    const previous = await database.query(
      `select entry.publish_at, distribution.starts_at, distribution.ends_at
         from public.pulse_editorial_entries as entry
         left join public.pulse_editorial_distributions as distribution
           on distribution.id = $2
        where entry.id = $1`,
      [manifest.entry.id, manifest.distribution?.id ?? null],
    );
    const current = previous.rows[0] ?? {};
    const publishAt = current.publish_at ?? new Date();
    const startsAt = current.starts_at ?? publishAt;
    const endsAt = manifest.distribution
      ? current.ends_at ?? new Date(new Date(startsAt).getTime() + manifest.distribution.durationDays * 86_400_000)
      : null;

    await database.query(
      `insert into public.pulse_editorial_series
        (id, ticker, slug, status, title, summary, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         ticker = excluded.ticker,
         slug = excluded.slug,
         status = excluded.status,
         title = excluded.title,
         summary = excluded.summary`,
      [
        manifest.series.id,
        manifest.series.ticker,
        manifest.series.slug,
        manifest.series.status,
        manifest.series.title,
        manifest.series.summary ?? "",
        manifest.createdBy,
      ],
    );

    await database.query(
      `insert into public.pulse_editorial_entries
        (id, series_id, episode_number, company_visible, slug, status, format,
         title, body, ticker, action_label, action_href, publish_at, expires_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, null, $14)
       on conflict (id) do update set
         series_id = excluded.series_id,
         episode_number = excluded.episode_number,
         company_visible = excluded.company_visible,
         slug = excluded.slug,
         status = excluded.status,
         format = excluded.format,
         title = excluded.title,
         body = excluded.body,
         ticker = excluded.ticker,
         action_label = excluded.action_label,
         action_href = excluded.action_href,
         publish_at = excluded.publish_at,
         expires_at = excluded.expires_at`,
      [
        manifest.entry.id,
        manifest.series.id,
        manifest.entry.episodeNumber,
        manifest.entry.companyVisible,
        manifest.entry.slug,
        manifest.entry.status,
        manifest.entry.format,
        manifest.entry.title,
        manifest.entry.body ?? "",
        manifest.series.ticker,
        manifest.entry.actionLabel ?? null,
        manifest.entry.actionHref ?? null,
        publishAt,
        manifest.createdBy,
      ],
    );

    for (const asset of assets) {
      await database.query(
        `insert into public.pulse_editorial_assets
          (id, entry_id, position, storage_path, alt_text, mime_type, byte_size, width, height)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           entry_id = excluded.entry_id,
           position = excluded.position,
           storage_path = excluded.storage_path,
           alt_text = excluded.alt_text,
           mime_type = excluded.mime_type,
           byte_size = excluded.byte_size,
           width = excluded.width,
           height = excluded.height`,
        [
          asset.id,
          manifest.entry.id,
          asset.position,
          asset.storagePath,
          asset.altText,
          asset.mimeType,
          asset.byteSize,
          asset.width ?? null,
          asset.height ?? null,
        ],
      );
    }

    if (manifest.distribution) {
      await database.query(
        `insert into public.pulse_editorial_distributions
          (id, entry_id, channel, status, placement, priority, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           entry_id = excluded.entry_id,
           channel = excluded.channel,
           status = excluded.status,
           placement = excluded.placement,
           priority = excluded.priority,
           starts_at = excluded.starts_at,
           ends_at = excluded.ends_at`,
        [
          manifest.distribution.id,
          manifest.entry.id,
          manifest.distribution.channel,
          manifest.distribution.status,
          manifest.distribution.placement,
          manifest.distribution.priority,
          startsAt,
          endsAt,
          manifest.createdBy,
        ],
      );
    }
    await database.query("commit");
  } catch (error) {
    await database.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function verifyEditorialSeed(database, manifest, assets) {
  const result = await database.query(
    `select
       (select count(*) from public.pulse_editorial_series where id = $1) as series,
       (select count(*) from public.pulse_editorial_entries where id = $2 and company_visible) as entry,
       (select count(*) from public.pulse_editorial_assets where entry_id = $2) as assets,
       (select count(*) from public.pulse_editorial_distributions where id = $3 and status = 'active') as distribution`,
    [manifest.series.id, manifest.entry.id, manifest.distribution?.id ?? null],
  );
  const verification = result.rows[0];
  const expectedDistribution = manifest.distribution ? 1 : 0;
  if (
    Number(verification.series) !== 1
    || Number(verification.entry) !== 1
    || Number(verification.assets) !== assets.length
    || Number(verification.distribution) !== expectedDistribution
  ) {
    throw new Error(`Editorial verification failed: ${JSON.stringify(verification)}`);
  }
  return verification;
}
