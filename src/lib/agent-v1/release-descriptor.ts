import { constants as fsConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, normalize, parse, resolve } from "node:path";
import {
  canonicalJson,
  hashBytes,
  isContentHash,
  isJsonValue,
  type ContentHash,
  type JsonValue,
} from "./canonical-json";

const DEFAULT_MAX_DESCRIPTOR_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_KEY_PARTS = ["secret", "credential", "endpoint", "prompt"];
const FORBIDDEN_EXACT_KEYS = new Set([
  "api_base",
  "api_key",
  "headers",
  "url",
]);
const SENSITIVE_VALUE_PATTERNS = [
  /(?:https?|wss?):\/\//i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]/i,
  /\b(?:sk|ds|rk)-[A-Za-z0-9_-]{12,}\b/,
];

export class ReleaseDescriptorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ReleaseDescriptorError";
  }
}

export interface ReleaseDescriptorIdentity {
  readonly artifactHash: ContentHash;
  readonly releaseSetHash: ContentHash;
  readonly fileDevice: bigint;
  readonly fileInode: bigint;
  readonly fileSize: number;
}

export interface PinnedReleaseDescriptor<T> {
  readonly descriptor: T;
  readonly identity: ReleaseDescriptorIdentity;
}

export interface LoadReleaseDescriptorOptions<
  T extends { readonly release_set_hash: string },
> {
  readonly path: string;
  readonly expectedArtifactHash: string;
  readonly expectedReleaseSetHash: string;
  readonly validate: (value: unknown) => T;
  readonly maxBytes?: number;
}

/**
 * Loads the daemon-generated descriptor exactly once. Deployment changes use a
 * process restart; individual runs never reread or reinterpret this artifact.
 */
export async function loadPinnedReleaseDescriptor<
  T extends { readonly release_set_hash: string },
>(options: LoadReleaseDescriptorOptions<T>): Promise<PinnedReleaseDescriptor<T>> {
  const artifactPath = validateArtifactPath(options.path);
  if (!isContentHash(options.expectedArtifactHash)) {
    throw new ReleaseDescriptorError("invalid_expected_artifact_hash");
  }
  if (!isContentHash(options.expectedReleaseSetHash)) {
    throw new ReleaseDescriptorError("invalid_expected_release_set_hash");
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DESCRIPTOR_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) {
    throw new ReleaseDescriptorError("invalid_descriptor_size_limit");
  }

  const parentPath = resolve(artifactPath, "..");
  const canonicalParent = await realpath(parentPath).catch(() => {
    throw new ReleaseDescriptorError("descriptor_parent_unavailable");
  });
  if (canonicalParent === parse(canonicalParent).root) {
    throw new ReleaseDescriptorError("unsafe_descriptor_parent");
  }
  const canonicalPath = resolve(canonicalParent, parse(artifactPath).base);

  const handle = await open(
    canonicalPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  ).catch(() => {
    throw new ReleaseDescriptorError("descriptor_open_failed");
  });
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new ReleaseDescriptorError("descriptor_not_regular_file");
    if ((stat.mode & 0o022n) !== 0n) {
      throw new ReleaseDescriptorError("descriptor_is_writable_by_others");
    }
    if (stat.size < 1n || stat.size > BigInt(maxBytes)) {
      throw new ReleaseDescriptorError("descriptor_size_out_of_bounds");
    }

    const bytes = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) {
        throw new ReleaseDescriptorError("descriptor_short_read");
      }
      offset += read.bytesRead;
    }
    const afterRead = await handle.stat({ bigint: true });
    if (
      afterRead.dev !== stat.dev ||
      afterRead.ino !== stat.ino ||
      afterRead.size !== stat.size ||
      afterRead.mtimeNs !== stat.mtimeNs
    ) {
      throw new ReleaseDescriptorError("descriptor_changed_during_read");
    }

    const artifactHash = hashBytes(bytes);
    if (artifactHash !== options.expectedArtifactHash) {
      throw new ReleaseDescriptorError("descriptor_artifact_hash_mismatch");
    }
    const text = decodeUtf8(bytes);
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(text);
    } catch {
      throw new ReleaseDescriptorError("descriptor_invalid_json");
    }
    if (!isJsonValue(parsedValue)) {
      throw new ReleaseDescriptorError("descriptor_not_json_domain");
    }
    if (canonicalJson(parsedValue) !== text) {
      throw new ReleaseDescriptorError("descriptor_not_canonical_jcs");
    }
    rejectSensitiveMaterial(parsedValue);

    let descriptor: T;
    try {
      descriptor = options.validate(parsedValue);
    } catch {
      throw new ReleaseDescriptorError("descriptor_contract_rejected");
    }
    if (
      descriptor.release_set_hash !== options.expectedReleaseSetHash ||
      descriptor.release_set_hash !==
        (parsedValue as { readonly release_set_hash?: unknown }).release_set_hash
    ) {
      throw new ReleaseDescriptorError("descriptor_release_set_hash_mismatch");
    }

    return Object.freeze({
      descriptor: deepFreeze(descriptor),
      identity: Object.freeze({
        artifactHash,
        releaseSetHash: options.expectedReleaseSetHash,
        fileDevice: stat.dev,
        fileInode: stat.ino,
        fileSize: Number(stat.size),
      }),
    });
  } finally {
    await handle.close();
  }
}

function validateArtifactPath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    !isAbsolute(value) ||
    normalize(value) !== value ||
    value === parse(value).root
  ) {
    throw new ReleaseDescriptorError("unsafe_descriptor_path");
  }
  return value;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ReleaseDescriptorError("descriptor_invalid_utf8");
  }
}

function rejectSensitiveMaterial(value: JsonValue, depth = 0): void {
  if (depth > 64) throw new ReleaseDescriptorError("descriptor_too_deep");
  if (typeof value === "string") {
    if (value.includes("\0") || SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new ReleaseDescriptorError("descriptor_contains_sensitive_value");
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectSensitiveMaterial(item, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      FORBIDDEN_EXACT_KEYS.has(normalizedKey) ||
      FORBIDDEN_KEY_PARTS.some((part) => normalizedKey.includes(part))
    ) {
      throw new ReleaseDescriptorError("descriptor_contains_forbidden_field");
    }
    rejectSensitiveMaterial(nested, depth + 1);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
