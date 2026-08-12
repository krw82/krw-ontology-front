#!/usr/bin/env node

/**
 * Provision one durable, non-human production account for Agent V1 product
 * canaries. The account is deliberately an ordinary Supabase Auth principal
 * with the existing `internal` entitlement; the web admission gate still
 * admits it only when its returned UUID is explicitly configured on GCP.
 *
 * The generated password never enters Git, stdout, or GCP. It is rotated and
 * written only to the two operator-owned 0600 files supplied on the command
 * line. A matching human account is never adopted: an existing account must
 * already carry the non-user-editable `app_metadata.krw_agent_canary` marker.
 */

import { randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ENV_BYTES = 1024 * 1024;
const ACTIVE_SUBSCRIPTION_STATES = ["active", "past_due", "grace", "pending_cancel"];
const CRITICAL_ENV_KEYS = new Set([
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
]);

function fail(message) {
  throw new Error(message);
}

function usage() {
  return [
    "usage: node scripts/provision-krw-agent-production-canary.mjs \\",
    "  --env-file /absolute/operator-runtime.env \\",
    "  --email agent-canary@example.com \\",
    "  --state-file /absolute/private-account-state.json \\",
    "  --e2e-env-file /absolute/private-prod-e2e.env",
    "",
    "The account is created or safely reused, password-rotated, and granted the existing internal entitlement.",
  ].join("\n");
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (flag === "--dry-run") {
      values.dry_run = true;
      continue;
    }
    if (![
      "--env-file",
      "--email",
      "--state-file",
      "--e2e-env-file",
    ].includes(flag)) {
      fail(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    values[flag.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  for (const key of ["env_file", "email", "state_file", "e2e_env_file"]) {
    if (!values[key]) fail(`missing --${key.replaceAll("_", "-")}`);
  }
  if (!EMAIL.test(values.email)) fail("--email is invalid");
  return values;
}

function regularFile(path, label, { allowMissing = false, maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
  if (!isAbsolute(path)) fail(`${label} must be absolute`);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat && allowMissing) return resolve(path);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) {
    fail(`${label} must be a regular file`);
  }
  return resolve(path);
}

function parseEnv(path) {
  const values = new Map();
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // The Mac runtime envelope is a shell file with a few helper functions
    // below its assignments. Parse assignments only; never source it merely
    // to obtain Supabase credentials.
    const assignment = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    let value = rawValue.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    // Generated runtime envelopes may re-export unrelated worker settings at
    // the end. Last assignment is normal shell semantics for those values;
    // the few credentials/origins that this command consumes stay strict.
    if (values.has(key) && CRITICAL_ENV_KEYS.has(key)) {
      fail(`operator env has a duplicate critical key: ${key}`);
    }
    values.set(key, value);
  }
  return values;
}

function requiredEnv(env, ...keys) {
  for (const key of keys) {
    const value = env.get(key)?.trim();
    if (value) return value;
  }
  fail(`operator env is missing ${keys.join(" or ")}`);
}

function secureOutput(path, label) {
  if (!isAbsolute(path)) fail(`${label} must be absolute`);
  const output = resolve(path);
  if (output === "/") fail(`${label} must not be the filesystem root`);
  const existing = lstatSync(output, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    fail(`${label} is not a regular file`);
  }
  return output;
}

function writeAtomically(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    fail("canary output parent must be a real directory");
  }
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, `${typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`}`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch {}
  }
}

async function api(baseUrl, serviceRole, pathname, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Supabase ${method} ${pathname} failed: ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

function generatePassword() {
  // Base64url contains only password-safe characters and has 256 bits entropy.
  return randomBytes(32).toString("base64url");
}

function assertCanaryUser(user, email) {
  if (!user || typeof user !== "object" || !UUID.test(user.id ?? "")) {
    fail("Supabase Auth returned an invalid canary user");
  }
  if (String(user.email ?? "").toLowerCase() !== email.toLowerCase()) {
    fail("canary user email does not match the configured address");
  }
  if (user.app_metadata?.krw_agent_canary !== true) {
    fail("refusing to adopt an existing account without the canary app-metadata marker");
  }
  return user.id.toLowerCase();
}

async function findCanaryByEmail(baseUrl, serviceRole, email) {
  for (let page = 1; page <= 100; page += 1) {
    const value = await api(baseUrl, serviceRole, `/auth/v1/admin/users?page=${page}&per_page=1000`);
    const users = Array.isArray(value) ? value : value?.users;
    if (!Array.isArray(users)) fail("Supabase Auth user lookup returned an invalid payload");
    const match = users.find((user) => String(user?.email ?? "").toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (users.length < 1000) return null;
  }
  fail("Supabase Auth user lookup exceeded its bounded page limit");
}

function priorState(path, email) {
  if (!lstatSync(path, { throwIfNoEntry: false })) return null;
  const raw = readFileSync(path, "utf8");
  let value;
  try { value = JSON.parse(raw); } catch { fail("canary state file is not valid JSON"); }
  if (
    !value || typeof value !== "object" ||
    value.schema_version !== "krw-agent-production-canary-account/v1" ||
    !UUID.test(value.user_id ?? "") ||
    String(value.email ?? "").toLowerCase() !== email.toLowerCase()
  ) {
    fail("canary state file does not match the configured account");
  }
  return value;
}

async function provisionEntitlement(baseUrl, serviceRole, userId) {
  const subscriptions = await api(
    baseUrl,
    serviceRole,
    `/rest/v1/billing_toss_subscriptions?select=user_id,status&user_id=eq.${encodeURIComponent(userId)}&status=in.(${ACTIVE_SUBSCRIPTION_STATES.join(",")})`,
  );
  if (!Array.isArray(subscriptions)) fail("subscription verification returned an invalid payload");
  if (subscriptions.length > 0) {
    fail("canary account has an active paid subscription and cannot receive internal access");
  }
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    plan_key: "internal",
    status: "active",
    current_period_start: now,
    current_period_end: "9999-12-31T23:59:59.000Z",
    billing_period_start: now,
    billing_period_end: "9999-12-31T23:59:59.000Z",
    credit_anchor_at: now,
    cancel_at_period_end: false,
    plan_change_pending: null,
    entitlement_updated_at: now,
    updated_at: now,
  };
  await api(baseUrl, serviceRole, "/rest/v1/user_entitlements?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: [row],
  });
  const verified = await api(
    baseUrl,
    serviceRole,
    `/rest/v1/user_entitlements?select=user_id,plan_key,status,current_period_end&user_id=eq.${encodeURIComponent(userId)}`,
  );
  if (
    !Array.isArray(verified) || verified.length !== 1 ||
    verified[0]?.user_id !== userId || verified[0]?.plan_key !== "internal" ||
    verified[0]?.status !== "active" ||
    Date.parse(verified[0]?.current_period_end ?? "") <= Date.now()
  ) {
    fail("canary internal entitlement verification returned an unsafe state");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = regularFile(args.env_file, "--env-file", { maxBytes: MAX_ENV_BYTES });
  const statePath = secureOutput(args.state_file, "--state-file");
  const e2eEnvPath = secureOutput(args.e2e_env_file, "--e2e-env-file");
  if (statePath === e2eEnvPath) fail("state and E2E env files must be distinct");
  const env = parseEnv(envPath);
  const baseUrl = requiredEnv(env, "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requiredEnv(env, "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRole = requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const appUrl = requiredEnv(env, "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL");
  if (new URL(baseUrl).protocol !== "https:" || new URL(appUrl).protocol !== "https:") {
    fail("production canary requires HTTPS Supabase and application URLs");
  }
  if (args.dry_run) {
    process.stdout.write(`${JSON.stringify({
      status: "planned",
      email: args.email.toLowerCase(),
      state_file: statePath,
      e2e_env_file: e2eEnvPath,
      public_base_url: new URL(appUrl).origin,
      will_create_or_reuse_tagged_account: true,
      will_provision_internal_entitlement: true,
    })}\n`);
    return;
  }

  const prior = priorState(statePath, args.email);
  let user = null;
  if (prior) {
    user = await api(baseUrl, serviceRole, `/auth/v1/admin/users/${encodeURIComponent(prior.user_id)}`);
  } else {
    user = await findCanaryByEmail(baseUrl, serviceRole, args.email);
  }
  const password = generatePassword();
  if (user) {
    const userId = assertCanaryUser(user, args.email);
    user = await api(baseUrl, serviceRole, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: { password, email_confirm: true },
    });
  } else {
    user = await api(baseUrl, serviceRole, "/auth/v1/admin/users", {
      method: "POST",
      body: {
        email: args.email.toLowerCase(),
        password,
        email_confirm: true,
        app_metadata: { krw_agent_canary: true },
      },
    });
    user = user?.user ?? user;
  }
  const userId = assertCanaryUser(user, args.email);
  await provisionEntitlement(baseUrl, serviceRole, userId);

  const state = {
    schema_version: "krw-agent-production-canary-account/v1",
    user_id: userId,
    email: args.email.toLowerCase(),
    password,
    provisioned_at: new Date().toISOString(),
  };
  const e2eEnv = [
    `PROD_E2E_BASE_URL=${new URL(appUrl).origin}`,
    `PROD_E2E_SUPABASE_URL=${baseUrl}`,
    `PROD_E2E_SUPABASE_ANON_KEY=${anonKey}`,
    `PROD_E2E_EMAIL=${state.email}`,
    `PROD_E2E_PASSWORD=${password}`,
    `KRW_AGENT_CANARY_PRINCIPAL_ID=${userId}`,
    "",
  ].join("\n");
  writeAtomically(statePath, state);
  writeAtomically(e2eEnvPath, e2eEnv);
  process.stdout.write(`${JSON.stringify({
    status: "provisioned",
    user_id: userId,
    email: state.email,
    entitlement: "internal",
    state_file: statePath,
    e2e_env_file: e2eEnvPath,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`production canary provisioning: ${error instanceof Error ? error.message : "unknown failure"}\n`);
  process.exitCode = 1;
});
