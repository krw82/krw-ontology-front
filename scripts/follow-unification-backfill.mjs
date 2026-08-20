#!/usr/bin/env node
// 관심=알림 통일 백필 (2026-08-20) — docs/plans/2026-08-20-follow-unification-plan.md
//
// 기존 유저의 갈라진 상태를 치유한다:
//  1) 구독만 있고 관심 없음 → 관심 마킹 (RPC가 한도를 강제: free 3 초과분은
//     subscribed_at 최신순 3개만 시도하고 나머지는 스킵 보고)
//  2) 관심만 있고 구독 없음 → 구독 생성 (enabled=false 명시적 해제 이력은
//     존중해 스킵; sec_company_identifiers에 resolved CIK 없으면 스킵)
//
// 뉴스 팔로우는 별도 서비스 DB라 이 스크립트 범위 밖 — 관심 재토글 시 자동 복구된다.
//
// 사용: node scripts/follow-unification-backfill.mjs [--env-file .env] [--apply]
//       기본은 dry-run. prod 실행은 pooler 접근 런북 참조.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let envFile = ".env";
const apply = args.includes("--apply");
const envFileIndex = args.indexOf("--env-file");
if (envFileIndex !== -1) envFile = args[envFileIndex + 1] || ".env";
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/follow-unification-backfill.mjs [--env-file FILE] [--apply]");
  process.exit(0);
}

function loadEnvFile(filePath, { override = false } = {}) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  if (!existsSync(resolved)) return;
  for (const rawLine of readFileSync(resolved, "utf8").split(/\r?\n/)) {
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

loadEnvFile(path.join(repoRoot, ".env.production"));
loadEnvFile(envFile, { override: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: subs, error: subsError } = await db
    .from("user_filing_subscriptions")
    .select("user_id, ticker, enabled, cik, subscribed_at");
  if (subsError) throw new Error(`subscriptions read failed: ${subsError.message}`);
  const { data: marks, error: marksError } = await db
    .from("user_company_marks")
    .select("user_id, ticker, coverage_level");
  if (marksError) throw new Error(`marks read failed: ${marksError.message}`);

  const { data: identifiers, error: identifiersError } = await db
    .from("sec_company_identifiers")
    .select("ticker, cik")
    .eq("lookup_status", "resolved")
    .not("cik", "is", null);
  if (identifiersError) throw new Error(`identifiers read failed: ${identifiersError.message}`);
  const cikByTicker = new Map((identifiers ?? []).map((row) => [row.ticker, row.cik]));

  const markedSet = new Set(
    (marks ?? []).filter((mark) => mark.coverage_level !== null).map((mark) => `${mark.user_id}:${mark.ticker}`),
  );
  const subByUserTicker = new Map((subs ?? []).map((sub) => [`${sub.user_id}:${sub.ticker}`, sub]));

  // 1) 구독만 있고 관심 없음 → 마킹 후보
  const markTargets = [];
  const markSkippedByLimit = [];
  const perUserCandidates = new Map();
  for (const sub of subs ?? []) {
    if (!sub.enabled) continue;
    if (markedSet.has(`${sub.user_id}:${sub.ticker}`)) continue;
    const list = perUserCandidates.get(sub.user_id) ?? [];
    list.push(sub);
    perUserCandidates.set(sub.user_id, list);
  }
  for (const [userId, candidates] of perUserCandidates) {
    const ordered = [...candidates].sort((a, b) =>
      (b.subscribed_at ?? "").localeCompare(a.subscribed_at ?? ""),
    );
    markTargets.push(...ordered.slice(0, 3).map((sub) => ({ userId, ticker: sub.ticker })));
    markSkippedByLimit.push(...ordered.slice(3).map((sub) => ({ userId, ticker: sub.ticker })));
  }

  // 2) 관심만 있고 구독 없음 → 구독 후보
  const subscribeTargets = [];
  const skippedDisabledHistory = [];
  const skippedNoCik = [];
  for (const mark of marks ?? []) {
    if (mark.coverage_level !== "interest") continue;
    const key = `${mark.user_id}:${mark.ticker}`;
    const existing = subByUserTicker.get(key);
    if (existing?.enabled) continue;
    if (existing && !existing.enabled) {
      skippedDisabledHistory.push({ userId: mark.user_id, ticker: mark.ticker });
      continue;
    }
    const cik = cikByTicker.get(mark.ticker);
    if (!cik) {
      skippedNoCik.push({ userId: mark.user_id, ticker: mark.ticker });
      continue;
    }
    subscribeTargets.push({ userId: mark.user_id, ticker: mark.ticker, cik });
  }

  console.log(
    JSON.stringify(
      {
        apply,
        markTargets: markTargets.length,
        markSkippedByFreeLimit: markSkippedByLimit.length,
        subscribeTargets: subscribeTargets.length,
        skippedDisabledHistory: skippedDisabledHistory.length,
        skippedNoSecCik: skippedNoCik.length,
      },
      null,
      2,
    ),
  );
  if (!apply) {
    console.log("Dry run — re-run with --apply after review.");
    return;
  }

  let marked = 0;
  for (const target of markTargets) {
    const { error } = await db.rpc("set_user_company_coverage_level", {
      p_user_id: target.userId,
      p_ticker: target.ticker,
      p_coverage_level: "interest",
      p_idempotency_key: `follow-backfill:${target.userId}:${target.ticker}`,
      p_source: "follow_backfill",
    });
    if (error) {
      console.warn(`mark failed ${target.userId} ${target.ticker}: ${error.message}`);
      continue;
    }
    marked += 1;
  }

  let subscribed = 0;
  for (const target of subscribeTargets) {
    const now = new Date().toISOString();
    const { error } = await db
      .from("user_filing_subscriptions")
      .upsert(
        {
          user_id: target.userId,
          ticker: target.ticker,
          cik: target.cik,
          enabled: true,
          subscribed_at: now,
          disabled_at: null,
        },
        { onConflict: "user_id,ticker" },
      );
    if (error) {
      console.warn(`subscribe failed ${target.userId} ${target.ticker}: ${error.message}`);
      continue;
    }
    const { error: pollError } = await db
      .from("sec_filing_poll_state")
      .upsert({ cik: target.cik, enabled: true, next_poll_at: now }, { onConflict: "cik" });
    if (pollError) console.warn(`poll state failed ${target.ticker}: ${pollError.message}`);
    subscribed += 1;
  }

  console.log(JSON.stringify({ marked, subscribed }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
