import { createHash } from "node:crypto";

export type JsonPrimitive = null | boolean | number | string;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type ContentHash = `sha256:${string}`;

const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isContentHash(value: unknown): value is ContentHash {
  return typeof value === "string" && CONTENT_HASH_PATTERN.test(value);
}

/** RFC 8785 JSON Canonicalization Scheme for JSON-domain values. */
export function canonicalJson(value: JsonValue): string {
  return canonicalize(value, new Set<object>());
}

export function canonicalHash(value: JsonValue): ContentHash {
  return hashBytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function hashBytes(value: Uint8Array): ContentHash {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function isJsonValue(
  value: unknown,
  ancestors = new Set<object>(),
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "string" || hasValidUnicode(value);
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.every(
        (item, index) =>
          Object.hasOwn(value, index) && isJsonValue(item, ancestors),
      );
    }
    if (!isPlainObject(value)) return false;
    return Object.entries(value).every(
      ([key, item]) => hasValidUnicode(key) && isJsonValue(item, ancestors),
    );
  } finally {
    ancestors.delete(value);
  }
}

function canonicalize(value: JsonValue, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite JSON number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }

  if (ancestors.has(value)) throw new TypeError("cyclic JSON value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError("sparse JSON array");
        }
      }
      return `[${value
        .map((item) => canonicalize(item, ancestors))
        .join(",")}]`;
    }

    if (!isPlainObject(value)) {
      throw new TypeError("JSON object has a custom prototype");
    }
    const members = Object.keys(value)
      .sort()
      .map((key) => {
        assertValidUnicode(key);
        const member = value[key];
        if (member === undefined) throw new TypeError("undefined JSON member");
        return `${JSON.stringify(key)}:${canonicalize(member, ancestors)}`;
      });
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function isPlainObject(value: object): value is JsonObject {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasValidUnicode(value: string): boolean {
  try {
    assertValidUnicode(value);
    return true;
  } catch {
    return false;
  }
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("unpaired UTF-16 high surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("unpaired UTF-16 low surrogate");
    }
  }
}
