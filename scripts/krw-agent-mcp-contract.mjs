#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const REQUIRED_ENDPOINT_REFS = new Set([
  "krw-ontology-local",
  "krw-feed-local",
  "krw-filings-local",
  "krw-guru-local",
]);
const ALLOWED_SESSION_REUSE = new Set(["run-scoped", "attested-stateless-v1"]);

function fail(message) {
  throw new Error(`invalid sealed MCP endpoint registry: ${message}`);
}

function validateOrigin(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.endsWith("/")) {
    fail("origin must be a non-empty bare HTTPS origin");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("origin is not a URL");
  }
  if (
    parsed.protocol !== "https:"
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    fail("origin must be HTTPS without credentials, path, query, or fragment");
  }
  return raw;
}

/**
 * Resolve the caller Origin from the exact YAML registry already sealed into
 * the Rust release. This intentionally parses only the closed endpoint fields
 * needed by the gateway; the Rust release validator remains the YAML source
 * of truth for the complete schema.
 */
export function resolveMcpOrigin(registryText) {
  if (typeof registryText !== "string" || registryText.length === 0) {
    fail("registry is empty");
  }
  const records = [];
  let currentEndpoint = null;
  for (const line of registryText.split(/\r?\n/)) {
    const endpointMatch = line.match(/^\s*(?:-\s*)?endpoint_ref:\s*([^\s#]+)\s*$/);
    if (endpointMatch) {
      currentEndpoint = endpointMatch[1];
      continue;
    }
    const originMatch = line.match(/^\s*origin:\s*([^\s#]+)\s*$/);
    if (originMatch) {
      if (!currentEndpoint) fail("origin appears before endpoint_ref");
      records.push({ endpoint: currentEndpoint, origin: validateOrigin(originMatch[1]) });
    }
  }

  const seen = new Set();
  for (const record of records) {
    if (REQUIRED_ENDPOINT_REFS.has(record.endpoint)) {
      if (seen.has(record.endpoint)) fail(`duplicate origin for ${record.endpoint}`);
      seen.add(record.endpoint);
    }
  }
  for (const required of REQUIRED_ENDPOINT_REFS) {
    if (!seen.has(required)) fail(`missing origin for ${required}`);
  }

  const origins = new Set(
    records
      .filter((record) => REQUIRED_ENDPOINT_REFS.has(record.endpoint))
      .map((record) => record.origin),
  );
  if (origins.size !== 1) fail("required endpoint origins do not match");
  return origins.values().next().value;
}

/**
 * Resolve session reuse from the sealed deployment binding. Runtime gateway
 * JSON is only an operator materialization; it must not be allowed to invent
 * a different isolation mode than the binding that the Rust release verifies.
 */
export function resolveMcpSessionReuse(bindingText) {
  if (typeof bindingText !== "string" || bindingText.length === 0) {
    fail("deployment binding is empty");
  }
  const records = [];
  let currentEndpoint = null;
  for (const line of bindingText.split(/\r?\n/)) {
    const endpointMatch = line.match(/^\s*(?:-\s*)?endpoint_ref:\s*([^\s#]+)\s*$/);
    if (endpointMatch) {
      currentEndpoint = endpointMatch[1];
      continue;
    }
    const reuseMatch = line.match(/^\s*tool_session_reuse:\s*([^\s#]+)\s*$/);
    if (reuseMatch && currentEndpoint) {
      const reuse = reuseMatch[1];
      if (!ALLOWED_SESSION_REUSE.has(reuse)) fail(`unsupported session reuse for ${currentEndpoint}`);
      records.push({ endpoint: currentEndpoint, reuse });
    }
  }

  const resolved = {};
  for (const required of REQUIRED_ENDPOINT_REFS) {
    const values = new Set(
      records.filter((record) => record.endpoint === required).map((record) => record.reuse),
    );
    if (values.size !== 1) fail(`session reuse is missing or inconsistent for ${required}`);
    resolved[required] = values.values().next().value;
  }
  return resolved;
}

function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--registry") {
    process.stderr.write("Usage: krw-agent-mcp-contract.mjs --registry /absolute/endpoint-registry.yaml\n");
    process.exitCode = 2;
    return;
  }
  const registryPath = argv[1];
  if (!registryPath.startsWith("/") || registryPath.includes("\0")) {
    fail("registry path must be absolute");
  }
  process.stdout.write(`${resolveMcpOrigin(fs.readFileSync(registryPath, "utf8"))}\n`);
}

const invokedAsMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "MCP contract resolution failed"}\n`);
    process.exitCode = 1;
  }
}
