import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalNewsVault, parseVaultKey } from "@/lib/local-news/vault";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("LocalNewsVault", () => {
  it("stores source-only metadata encrypted outside Supabase", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-news-vault-"));
    directories.push(directory);
    const path = join(directory, "vault.enc");
    const key = "a".repeat(64);
    const vault = new LocalNewsVault({ path, key });
    const article = {
      ticker: "AAPL",
      articleId: "private-article-id",
      headline: "Company reports results",
      summary: "Revenue was $100 million.",
      url: "https://private.example/article",
      publishedAt: "2024-01-01T00:00:00.000Z",
      contentHash: "private-source-hash",
    };

    const reservation = await vault.reserve(article);
    await vault.markPublished({
      contentHash: article.contentHash,
      evidence: [{ claimKo: "매출이 발표됐다", sourceQuote: "Revenue was $100 million." }],
    });

    const encrypted = await readFile(path, "utf8");
    expect(encrypted).not.toContain(article.url);
    expect(encrypted).not.toContain(article.articleId);
    expect(reservation.publicEventKey).toMatch(/^local-news-/);

    const reloaded = new LocalNewsVault({ path, key });
    const nextReservation = await reloaded.reserve(article);
    expect(nextReservation.status).toBe("published");
    expect(nextReservation.curationVersion).toBe("zai-v2");
    expect(nextReservation.sourceUrl).toBe(article.url);
    expect(nextReservation.sourceHeadline).toBe(article.headline);
    expect(nextReservation.sourceSummary).toBe(article.summary);
  });

  it("rejects a vault key that is not AES-256 length", () => {
    expect(() => parseVaultKey("too-short")).toThrow("local_news_vault_key_invalid");
  });
});
