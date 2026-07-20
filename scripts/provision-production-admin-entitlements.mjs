#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [envPath, proofPath] = process.argv.slice(2);
if (!envPath || !proofPath) {
  console.error(
    "Usage: scripts/provision-production-admin-entitlements.mjs ENV_FILE PROOF_FILE",
  );
  process.exit(2);
}

function readEnv(contents) {
  const values = new Map();
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (values.has(key)) throw new Error(`Duplicate production env key: ${key}`);
    values.set(key, value);
  }
  return values;
}

async function boundedFetch(url, init = {}) {
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}

const env = readEnv(await readFile(envPath, "utf8"));
const baseUrl = env.get("SUPABASE_URL") || env.get("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!baseUrl || !serviceRole) {
  throw new Error("Missing production Supabase URL or service-role credential");
}
const adminEmails = [
  ...new Set(
    (env.get("ADMIN_EMAILS") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
].sort();
if (adminEmails.length === 0) {
  throw new Error("ADMIN_EMAILS must contain at least one address");
}
for (const email of adminEmails) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAILS contains an invalid address");
  }
}

const headers = {
  apikey: serviceRole,
  Authorization: `Bearer ${serviceRole}`,
};
const usersByEmail = new Map();
for (let page = 1; page <= 100 && usersByEmail.size < adminEmails.length; page += 1) {
  const response = await boundedFetch(
    `${baseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`,
    { headers },
  );
  if (!response.ok) throw new Error(`Supabase Auth admin lookup failed: ${response.status}`);
  const payload = await response.json();
  const users = Array.isArray(payload) ? payload : payload?.users;
  if (!Array.isArray(users)) throw new Error("Unexpected Supabase Auth admin response");
  for (const user of users) {
    const email = typeof user?.email === "string" ? user.email.toLowerCase() : "";
    if (adminEmails.includes(email)) {
      if (usersByEmail.has(email)) throw new Error("Configured admin email is not unique");
      usersByEmail.set(email, user.id);
    }
  }
  if (users.length < 1000) break;
}
if (usersByEmail.size !== adminEmails.length) {
  throw new Error("Every configured ADMIN_EMAILS address must map to one auth user");
}

const userIds = [...usersByEmail.values()].sort();
if (userIds.length > 0) {
  const openSubscriptionUrl = new URL(
    `${baseUrl}/rest/v1/billing_toss_subscriptions`,
  );
  openSubscriptionUrl.searchParams.set("select", "user_id,status");
  openSubscriptionUrl.searchParams.set("user_id", `in.(${userIds.join(",")})`);
  openSubscriptionUrl.searchParams.set(
    "status",
    "in.(active,past_due,grace,pending_cancel)",
  );
  const openSubscriptionsResponse = await boundedFetch(openSubscriptionUrl, { headers });
  if (!openSubscriptionsResponse.ok) {
    throw new Error(
      `Admin open-subscription verification failed: ${openSubscriptionsResponse.status}`,
    );
  }
  const openSubscriptions = await openSubscriptionsResponse.json();
  if (!Array.isArray(openSubscriptions)) {
    throw new Error("Unexpected admin open-subscription response");
  }
  if (openSubscriptions.length > 0) {
    throw new Error(
      "Configured production admin has an open Toss subscription; reconcile it before provisioning internal access",
    );
  }
}

const now = new Date();
const periodEnd = new Date("9999-12-31T23:59:59.000Z");
const rows = userIds.map((userId) => ({
  user_id: userId,
  plan_key: "internal",
  status: "active",
  current_period_start: now.toISOString(),
  current_period_end: periodEnd.toISOString(),
  billing_period_start: now.toISOString(),
  billing_period_end: periodEnd.toISOString(),
  credit_anchor_at: now.toISOString(),
  cancel_at_period_end: false,
  plan_change_pending: null,
  entitlement_updated_at: now.toISOString(),
  updated_at: now.toISOString(),
}));

if (rows.length > 0) {
  const upsert = await boundedFetch(
    `${baseUrl}/rest/v1/user_entitlements?on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!upsert.ok) throw new Error(`Admin entitlement provisioning failed: ${upsert.status}`);

  const ids = rows.map((row) => row.user_id).sort();
  const verifyUrl = new URL(`${baseUrl}/rest/v1/user_entitlements`);
  verifyUrl.searchParams.set(
    "select",
    "user_id,plan_key,status,current_period_end",
  );
  verifyUrl.searchParams.set("user_id", `in.(${ids.join(",")})`);
  const verify = await boundedFetch(
    verifyUrl,
    { headers },
  );
  if (!verify.ok) throw new Error(`Admin entitlement verification failed: ${verify.status}`);
  const verifiedRows = await verify.json();
  if (
    !Array.isArray(verifiedRows) ||
    verifiedRows.length !== rows.length ||
    new Set(verifiedRows.map((row) => row.user_id)).size !== rows.length ||
    verifiedRows.some((row) => !ids.includes(row.user_id)) ||
    verifiedRows.some(
      (row) =>
        row.plan_key !== "internal" ||
        row.status !== "active" ||
        new Date(row.current_period_end).getTime() <= Date.now(),
    )
  ) {
    throw new Error("Admin entitlement verification returned an unsafe state");
  }
}

await writeFile(
  proofPath,
  `${JSON.stringify(
    {
      format: "krw-production-admin-entitlement-proof/v1",
      configuredAdminCount: adminEmails.length,
      provisionedAdminCount: rows.length,
      openSubscriptionCount: 0,
      adminSetSha256: createHash("sha256")
        .update(adminEmails.join("\n"))
        .digest("hex"),
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { mode: 0o400 },
);
console.log(`OK production internal admin entitlements: ${rows.length}`);
