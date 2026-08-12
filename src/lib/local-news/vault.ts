import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LocalNewsArticle } from "@/lib/local-news/finnhub";

export const LOCAL_NEWS_CURATION_VERSION = "zai-v2";

type VaultState = {
  version: 3;
  entries: LocalNewsVaultEntry[];
  coverageCursor?: string;
};

export type LocalNewsVaultEntry = {
  contentHash: string;
  publicEventKey: string;
  provider: "finnhub";
  ticker: string;
  sourceArticleId: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  sourceHeadline?: string;
  sourceSummary?: string;
  seenAt: string;
  status: "pending" | "reviewed" | "published" | "rejected";
  curationVersion?: "zai-v1" | typeof LOCAL_NEWS_CURATION_VERSION;
  rejectionReason?: string;
  evidence?: Array<{ claimKo: string; sourceQuote: string }>;
};

type EncryptedVaultPayload = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export class LocalNewsVault {
  readonly #path: string;
  readonly #key: Buffer;
  #state: VaultState | null = null;

  constructor(input: { path: string; key: string }) {
    this.#path = input.path;
    this.#key = parseVaultKey(input.key);
  }

  async reserve(article: LocalNewsArticle): Promise<LocalNewsVaultEntry> {
    const state = await this.#load();
    const existing = state.entries.find((entry) => entry.contentHash === article.contentHash);
    if (existing) {
      return structuredClone(existing);
    }
    const entry: LocalNewsVaultEntry = {
      contentHash: article.contentHash,
      publicEventKey: "local-news-" + randomUUID(),
      provider: "finnhub",
      ticker: article.ticker,
      sourceArticleId: article.articleId,
      sourceUrl: article.url,
      sourcePublishedAt: article.publishedAt,
      sourceHeadline: article.headline,
      sourceSummary: article.summary,
      seenAt: new Date().toISOString(),
      status: "pending",
    };
    state.entries.push(entry);
    await this.#persist();
    return structuredClone(entry);
  }

  /**
   * Selects one stable slice of the active catalog. The cursor advances only
   * after the caller finishes attempting the slice, so an interrupted run
   * safely retries the same companies on the next start.
   */
  async selectCoverageBatch<T extends { ticker: string }>(
    coverage: readonly T[],
    batchSize: number,
  ): Promise<T[]> {
    const state = await this.#load();
    if (coverage.length === 0 || batchSize <= 0) return [];
    const normalizedSize = Math.min(coverage.length, Math.floor(batchSize));
    const cursorIndex = state.coverageCursor
      ? coverage.findIndex((item) => item.ticker === state.coverageCursor)
      : -1;
    const start = cursorIndex >= 0 ? (cursorIndex + 1) % coverage.length : 0;
    return Array.from({ length: normalizedSize }, (_, index) => coverage[(start + index) % coverage.length]);
  }

  async advanceCoverageCursor(ticker: string): Promise<void> {
    const state = await this.#load();
    state.coverageCursor = ticker.trim().toUpperCase() || undefined;
    await this.#persist();
  }

  /**
   * Replays pre-current-curation entries from the encrypted Mac-local vault.
   * This lets a rules upgrade re-check older articles even after Finnhub's
   * normal lookback window no longer returns them.
   */
  async articlesNeedingCuration(): Promise<LocalNewsArticle[]> {
    const state = await this.#load();
    const articles: LocalNewsArticle[] = [];
    for (const entry of state.entries) {
      if (entry.curationVersion === LOCAL_NEWS_CURATION_VERSION) continue;
      const headline = normalizeSourceText(entry.sourceHeadline, 500);
      const summary = normalizeSourceText(entry.sourceSummary, 2_000);
      if (!headline || !summary) continue;
      articles.push({
        ticker: entry.ticker,
        articleId: entry.sourceArticleId,
        headline,
        summary,
        url: entry.sourceUrl,
        publishedAt: entry.sourcePublishedAt,
        contentHash: entry.contentHash,
      });
    }
    return articles;
  }

  async markReviewed(input: {
    contentHash: string;
    evidence: Array<{ claimKo: string; sourceQuote: string }>;
  }): Promise<void> {
    await this.#update(input.contentHash, (entry) => ({
      ...entry,
      status: "reviewed",
      curationVersion: LOCAL_NEWS_CURATION_VERSION,
      rejectionReason: undefined,
      evidence: input.evidence.slice(0, 5),
    }));
  }

  async markPublished(input: {
    contentHash: string;
    evidence: Array<{ claimKo: string; sourceQuote: string }>;
  }): Promise<void> {
    await this.#update(input.contentHash, (entry) => ({
      ...entry,
      status: "published",
      curationVersion: LOCAL_NEWS_CURATION_VERSION,
      rejectionReason: undefined,
      evidence: input.evidence.slice(0, 5),
    }));
  }

  async markRejected(contentHash: string, rejectionReason: string): Promise<void> {
    await this.#update(contentHash, (entry) => ({
      ...entry,
      status: "rejected",
      curationVersion: LOCAL_NEWS_CURATION_VERSION,
      rejectionReason: rejectionReason.slice(0, 120),
    }));
  }

  async #update(
    contentHash: string,
    update: (entry: LocalNewsVaultEntry) => LocalNewsVaultEntry,
  ): Promise<void> {
    const state = await this.#load();
    const index = state.entries.findIndex((entry) => entry.contentHash === contentHash);
    if (index < 0) throw new Error("local_news_vault_entry_missing");
    state.entries[index] = update(state.entries[index]);
    await this.#persist();
  }

  async #load(): Promise<VaultState> {
    if (this.#state) return this.#state;
    try {
      const encrypted = JSON.parse(await readFile(this.#path, "utf8")) as unknown;
      this.#state = decryptVaultState(encrypted, this.#key);
    } catch (error) {
      if (isMissingFile(error)) {
        this.#state = { version: 3, entries: [] };
      } else {
        throw new Error("local_news_vault_unreadable");
      }
    }
    return this.#state;
  }

  async #persist(): Promise<void> {
    const state = await this.#load();
    const serialized = JSON.stringify(encryptVaultState(state, this.#key));
    const directory = dirname(this.#path);
    const temporaryPath = this.#path + "." + process.pid + ".tmp";
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, serialized, { mode: 0o600 });
    await rename(temporaryPath, this.#path);
    await chmod(this.#path, 0o600);
  }
}

export function parseVaultKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error("local_news_vault_key_invalid");
  return key;
}

export function encryptVaultState(state: VaultState, key: Buffer): EncryptedVaultPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptVaultState(value: unknown, key: Buffer): VaultState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("local_news_vault_payload_invalid");
  }
  const payload = value as Partial<EncryptedVaultPayload>;
  if (payload.version !== 1 || !payload.iv || !payload.tag || !payload.ciphertext) {
    throw new Error("local_news_vault_payload_invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("local_news_vault_state_invalid");
  }
  const state = parsed as { version?: unknown; entries?: unknown };
  if ((state.version !== 1 && state.version !== 2 && state.version !== 3) || !Array.isArray(state.entries)) {
    throw new Error("local_news_vault_state_invalid");
  }
  const coverageCursor = typeof (state as { coverageCursor?: unknown }).coverageCursor === "string"
    ? (state as { coverageCursor: string }).coverageCursor.trim().toUpperCase() || undefined
    : undefined;
  return { version: 3, entries: state.entries.filter(isVaultEntry), coverageCursor };
}

function isVaultEntry(value: unknown): value is LocalNewsVaultEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<LocalNewsVaultEntry>;
  return typeof entry.contentHash === "string"
    && typeof entry.publicEventKey === "string"
    && entry.provider === "finnhub"
    && typeof entry.ticker === "string"
    && typeof entry.sourceArticleId === "string"
    && typeof entry.sourceUrl === "string"
    && typeof entry.sourcePublishedAt === "string"
    && typeof entry.seenAt === "string"
    && (entry.status === "pending" || entry.status === "reviewed" || entry.status === "published" || entry.status === "rejected")
    && (entry.curationVersion === undefined || entry.curationVersion === "zai-v1" || entry.curationVersion === LOCAL_NEWS_CURATION_VERSION);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}

function normalizeSourceText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}
