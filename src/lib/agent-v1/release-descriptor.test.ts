import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalHash,
  canonicalJson,
  hashBytes,
  type JsonValue,
} from "./canonical-json";
import { loadPinnedReleaseDescriptor } from "./release-descriptor";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("canonicalJson", () => {
  it("matches JCS key ordering and JSON number primitives", () => {
    expect(canonicalJson({ z: -0, a: [3, 2, 1], middle: "한글" })).toBe(
      '{"a":[3,2,1],"middle":"한글","z":0}',
    );
    expect(canonicalHash({ b: 2, a: 1 })).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });

  it("rejects non-JSON values instead of silently rewriting them", () => {
    expect(() => canonicalJson([Number.NaN] as unknown as JsonValue)).toThrow(
      "non-finite",
    );
    const sparse = Array(1) as unknown as JsonValue;
    expect(() => canonicalJson(sparse)).toThrow("sparse");
  });
});

describe("loadPinnedReleaseDescriptor", () => {
  it("loads one canonical, hash-pinned, secret-free daemon artifact", async () => {
    const value = {
      schema_version: 2,
      release_set_hash: HASH_A,
      runtime_version: "krw-agentd-1",
      entries: [],
    } as const;
    const { path, bytes } = await writeDescriptor(canonicalJson(value));

    const pinned = await loadPinnedReleaseDescriptor({
      path,
      expectedArtifactHash: hashBytes(bytes),
      expectedReleaseSetHash: HASH_A,
      validate(candidate) {
        if (
          !candidate ||
          typeof candidate !== "object" ||
          (candidate as { schema_version?: unknown }).schema_version !== 2
        ) {
          throw new Error("invalid descriptor");
        }
        return candidate as typeof value;
      },
    });

    expect(pinned.descriptor).toEqual(value);
    expect(pinned.identity.artifactHash).toBe(hashBytes(bytes));
    expect(Object.isFrozen(pinned.descriptor)).toBe(true);
    expect(Object.isFrozen(pinned.descriptor.entries)).toBe(true);
  });

  it("rejects non-canonical or hash-mismatched bytes before validation", async () => {
    const nonCanonical = `{"release_set_hash":"${HASH_A}", "entries":[]}`;
    const first = await writeDescriptor(nonCanonical);
    await expect(
      loadPinnedReleaseDescriptor({
        path: first.path,
        expectedArtifactHash: hashBytes(first.bytes),
        expectedReleaseSetHash: HASH_A,
        validate: (value) => value as { release_set_hash: string },
      }),
    ).rejects.toMatchObject({
      code: "descriptor_not_canonical_jcs",
    });

    const canonical = await writeDescriptor(
      canonicalJson({ release_set_hash: HASH_A, entries: [] }),
    );
    await expect(
      loadPinnedReleaseDescriptor({
        path: canonical.path,
        expectedArtifactHash: `sha256:${"b".repeat(64)}`,
        expectedReleaseSetHash: HASH_A,
        validate: (value) => value as { release_set_hash: string },
      }),
    ).rejects.toMatchObject({
      code: "descriptor_artifact_hash_mismatch",
    });
  });

  it("rejects secret-like fields and symlink targets", async () => {
    const sensitive = await writeDescriptor(
      canonicalJson({
        release_set_hash: HASH_A,
        entries: [],
        credential_ref: "hidden",
      }),
    );
    await expect(
      loadPinnedReleaseDescriptor({
        path: sensitive.path,
        expectedArtifactHash: hashBytes(sensitive.bytes),
        expectedReleaseSetHash: HASH_A,
        validate: (value) => value as { release_set_hash: string },
      }),
    ).rejects.toMatchObject({
      code: "descriptor_contains_forbidden_field",
    });

    const directory = await makeTempDirectory();
    const target = join(directory, "target.json");
    const link = join(directory, "descriptor.json");
    const text = canonicalJson({ release_set_hash: HASH_A, entries: [] });
    await writeFile(target, text, { mode: 0o600 });
    await symlink(target, link);
    await expect(
      loadPinnedReleaseDescriptor({
        path: link,
        expectedArtifactHash: hashBytes(Buffer.from(text)),
        expectedReleaseSetHash: HASH_A,
        validate: (value) => value as { release_set_hash: string },
      }),
    ).rejects.toMatchObject({
      code: "descriptor_open_failed",
    });
  });
});

async function writeDescriptor(text: string) {
  const directory = await makeTempDirectory();
  const path = join(directory, "descriptor.json");
  const bytes = Buffer.from(text, "utf8");
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
  return { path, bytes };
}

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "krw-agent-v1-descriptor-"));
  tempDirectories.push(directory);
  return directory;
}
