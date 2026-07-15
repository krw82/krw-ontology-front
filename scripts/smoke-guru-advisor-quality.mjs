#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");

const repoRoot = process.cwd();
const defaultQuestionPath = path.join(repoRoot, "scripts", "guru-quality-questions.json");
const defaultLogRoot = path.join(homedir(), "krw-ontology-log", "guru-quality");

function parseArgs(argv) {
  const args = {
    all: false,
    reportOnly: false,
    guru: "",
    id: "",
    limit: 3,
    questions: defaultQuestionPath,
    out: process.env.KRW_GURU_QUALITY_LOG_DIR || defaultLogRoot,
    timeoutMs: Number.parseInt(
      process.env.KRW_GURU_QUALITY_TIMEOUT_MS || "600000",
      10,
    ),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--all":
        args.all = true;
        break;
      case "--report-only":
        args.reportOnly = true;
        break;
      case "--guru":
        args.guru = argv[++index] || "";
        break;
      case "--id":
        args.id = argv[++index] || "";
        break;
      case "--limit":
        args.limit = Number.parseInt(argv[++index] || "0", 10);
        break;
      case "--questions":
        args.questions = argv[++index] || defaultQuestionPath;
        break;
      case "--out":
        args.out = argv[++index] || defaultLogRoot;
        break;
      case "--timeout-ms":
        args.timeoutMs = Number.parseInt(argv[++index] || "0", 10);
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.all) args.limit = Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(args.limit) || args.limit < 0) {
    throw new Error(`Invalid --limit: ${args.limit}`);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new Error(`Invalid --timeout-ms: ${args.timeoutMs}`);
  }
  return args;
}

function printUsage() {
  console.error(
    "Usage: npm run guru:quality:smoke -- [--limit N|--all] [--guru buffett|marks|ackman|flatt|terry_smith] [--id CASE_ID] [--out DIR] [--timeout-ms 600000] [--report-only]",
  );
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function installServerOnlyStub() {
  const stubRoot = path.join(tmpdir(), "krw-guru-quality-node-stubs");
  const moduleDir = path.join(stubRoot, "server-only");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(path.join(moduleDir, "index.js"), "module.exports = {};\n");
  writeFileSync(
    path.join(moduleDir, "package.json"),
    JSON.stringify({ name: "server-only", main: "index.js" }),
  );
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${stubRoot}${path.delimiter}${process.env.NODE_PATH}`
    : stubRoot;
  Module._initPaths();
}

function ensureRuntimeDefaults() {
  const home = homedir();
  process.env.KRW_ONTOLOGY_PLUGIN_PATH ||= path.join(
    repoRoot,
    "ref",
    "plugins",
    "prod",
    "krw-ontology",
  );
  process.env.KRW_GURU_ADVISOR_PLUGIN_PATH ||= path.join(
    repoRoot,
    "ref",
    "plugins",
    "prod",
    "krw-guru-advisor",
  );
  process.env.KRW_ONTOLOGY_ROOT ||= path.join(
    home,
    "krw-ontology-data",
    "releases",
    "prod",
    "current",
  );
  process.env.KRW_GURU_RELEASE_ROOT ||= path.join(
    home,
    "krw-ontology-guru-data",
    "releases",
    "prod",
    "current",
  );
  process.env.CLAUDE_AGENT_CWD ||= path.join(repoRoot, ".agent-workspace");
  process.env.CLAUDE_AGENT_MAX_TURNS ||= "40";
  process.env.AGENT_MAX_TOOL_CALLS ||= "32";
  process.env.AGENT_MAX_TOOL_RESULT_CHARS ||= "100000";
  process.env.GURU_AGENT_GENERATED_BRIEF_ENABLED ||= "1";
}

function selectCases(cases, args) {
  let selected = cases;
  if (args.guru) selected = selected.filter((item) => item.guru === args.guru);
  if (args.id) selected = selected.filter((item) => item.id === args.id);
  return selected.slice(0, args.limit);
}

function qualityFlags(text, toolNames, rawText = "") {
  const internalPattern =
    /\b(?:ResearchPack|CompanyEvidencePack|GuruCompanyResearchPack|GuruCompanyEvidenceReview|MCP|tool call|subagent|reviewed_id|schema|parameter\s+encoding|tool failed)\b|수신 완료|서브에이전트|도구 호출/i;
  const numericTokens =
    text.match(
      /(?:\$[0-9][0-9.,]*(?:\s?(?:B|M|K|bn|mn|조|억|만))?|[0-9][0-9.,]*\s?(?:%|배|달러|조|억|만|bps|bp)|(?:FY|CY)?20[0-9]{2}Q[1-4]|(?:FY|CY)20[0-9]{2})/gi,
    ) || [];
  const tableLines = text.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
  const reportHeadingLines = text
    .split(/\r?\n/)
    .filter((line) => /^\s*#{2,3}\s+/.test(line))
    .filter((line) => !/^\s*###\s+이어서\s+볼\s+질문\s*$/i.test(line));
  const reportStylePattern =
    /(?:^\s*---+\s*$|^\s*(?:핵심\s*지표|재무\s*구조|밸류에이션|투자\s*시사점|종합\s*평가)\s*[:：]?\s*$|수치로\s*보면|구분\s*\||^\s*\d+\.\s+(?:비즈니스|재무|밸류에이션|리스크|종합))/im;
  const processLimitationPattern =
    /(?:현재\s*세션|tool\s*budget|도구\s*예산|retrieval|MCP|subagent|서브에이전트|직접\s*확인하지\s*못|직접\s*확인할\s*수\s*있는|확인하지\s*못했습니다|공시\s*데이터에서는[^.]{0,120}뒷받침하지\s*못)/i;
  const productBoundaryHallucinationPattern =
    /(?:KRW\s*Ontology[^.]{0,120}(?:국내|한국|KRX)|국내\s*상장사\s*중심|KRX\s*상장사|NYSE[^.]{0,120}(?:한계|커버|없)|뉴욕에\s*상장[^.]{0,120}(?:한계|커버|없)|미국\s*상장사[^.]{0,120}(?:커버하지\s*않|범위\s*밖))/i;
  const usedAgentTool = toolNames.some(
    (name) => name === "Agent" || name.endsWith("__Agent"),
  );
  return {
    has_internal_terms: internalPattern.test(text),
    raw_had_internal_terms: internalPattern.test(rawText),
    number_count: numericTokens.length,
    number_heavy: numericTokens.length >= 1,
    report_style: reportStylePattern.test(text) || reportHeadingLines.length > 0,
    process_limitation_language: processLimitationPattern.test(text),
    stray_han_text: /[\p{Script=Han}]/u.test(text),
    has_markdown_table: tableLines.length >= 2,
    product_boundary_hallucination: productBoundaryHallucinationPattern.test(text),
    has_change_condition: /바뀌|깨지|조건|확인|달라질|would change|change my mind/i.test(text),
    has_followup: /이어서|다음|질문|확인해|볼까|더 볼/i.test(text),
    used_company_subagent_signal: usedAgentTool,
    used_review_tool: toolNames.some((name) => name.includes("krw_guru_review_company_evidence")),
    used_verified_evidence_tool: toolNames.some((name) =>
      name.includes("krw_ontology_verify_evidence"),
    ),
    verified_pack_matches_review: false,
    zero_verified_company_evidence: false,
    answer_numbers_missing_from_verified_evidence: [],
    used_investigation_brief: false,
    used_sealed_question_evidence: false,
    has_visible_quantitative_expression: false,
  };
}

function scoreFlags(flags) {
  let score = 100;
  if (flags.has_internal_terms) score -= 25;
  if (flags.timed_out) score -= 30;
  if (flags.number_heavy) score -= 15;
  if (flags.report_style) score -= 10;
  if (flags.process_limitation_language) score -= 10;
  if (flags.product_boundary_hallucination) score -= 20;
  if (flags.stray_han_text) score -= 8;
  if (flags.has_markdown_table) score -= 8;
  if (!flags.has_change_condition) score -= 10;
  if (!flags.has_followup) score -= 7;
  if (!flags.used_company_subagent_signal) score -= 10;
  if (!flags.used_review_tool) score -= 15;
  if (!flags.used_verified_evidence_tool) score -= 25;
  if (!flags.verified_pack_matches_review) score -= 30;
  if (flags.zero_verified_company_evidence) score -= 25;
  if ((flags.answer_numbers_missing_from_verified_evidence || []).length > 0) {
    score -= 15;
  }
  if (!flags.used_investigation_brief) score -= 8;
  if (!flags.used_sealed_question_evidence) score -= 8;
  if (flags.has_visible_quantitative_expression) score -= 25;
  return Math.max(0, score);
}

function validatedGuruEvidenceReview(call) {
  if (!call?.toolName?.includes?.("krw_guru_review_company_evidence")) {
    return null;
  }
  const rawResult = unwrapMcpJsonResult(call.resultJson);
  const result = rawResult?.validated_evidence_analysis ?? rawResult;
  if (
    !result ||
    typeof result !== "object" ||
    result.format !== "krw-guru-validated-evidence-analysis/v1" ||
    typeof result.pack_hash !== "string" ||
    typeof result.brief_hash !== "string" ||
    result.validation?.all_questions_assessed !== true ||
    result.validation?.evidence_is_question_scoped !== true ||
    result.validation?.verdict_is_answerability_scoped !== true
  ) {
    return null;
  }
  return result;
}

function hasReviewedCompanyEvidencePayload(toolCalls) {
  return toolCalls.some((call) => {
    if (!call?.toolName?.includes?.("krw_guru_review_company_evidence")) {
      return false;
    }
    if (validatedGuruEvidenceReview(call)) return true;
    const args = String(call.argumentsJson || "");
    return (
      args.includes('"company_payload"') &&
      args.includes('"format":"krw-verified-company-evidence/v1"') &&
      args.includes('"pack_hash"')
    );
  });
}

function hasInvestigationBriefDelegation(toolCalls, sseText = "") {
  if (toolCalls.some((call) => validatedGuruEvidenceReview(call))) return true;
  if (sseText.includes("krw-guru-investigation-brief/v1")) return true;
  if (hasSealedQuestionEvidencePayload(toolCalls)) return true;
  return toolCalls.some((call) => {
    const args = String(call?.argumentsJson || "");
    return (
      call?.toolName?.includes?.("Agent") &&
      args.includes("krw-guru-investigation-brief/v1") &&
      args.includes("brief_hash")
    );
  });
}

function hasSealedQuestionEvidencePayload(toolCalls) {
  return toolCalls.some((call) => {
    if (!call?.toolName?.includes?.("krw_guru_review_company_evidence")) {
      return false;
    }
    if (validatedGuruEvidenceReview(call)) return true;
    try {
      const args = JSON.parse(String(call.argumentsJson || "{}"));
      const brief = args?.investigation_brief;
      const raw = args?.company_payload?.evidence_by_question;
      if (
        !brief ||
        brief.format !== "krw-guru-investigation-brief/v1" ||
        typeof brief.brief_hash !== "string" ||
        !args?.agent_analysis
      ) {
        return false;
      }
      if (Array.isArray(raw)) {
        return raw.some(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof item.question_id === "string",
        );
      }
      if (raw && typeof raw === "object") {
        return Object.values(raw).some(
          (item) => item && typeof item === "object",
        );
      }
      return false;
    } catch {
      return false;
    }
  });
}

function verifiedEvidenceAudit(toolCalls, answer, question) {
  const verifiedPacks = toolCalls
    .filter((call) => call?.toolName?.includes?.("krw_ontology_verify_evidence"))
    .map((call) => unwrapMcpJsonResult(call.resultJson))
    .filter(
      (payload) =>
        payload &&
        typeof payload === "object" &&
        payload.format === "krw-verified-company-evidence/v1" &&
        typeof payload.pack_hash === "string",
    );
  const reviewPacks = toolCalls
    .filter((call) => call?.toolName?.includes?.("krw_guru_review_company_evidence"))
    .map((call) => {
      const validatedReview = validatedGuruEvidenceReview(call);
      if (validatedReview) {
        return {
          brief_hash: validatedReview.brief_hash,
          pack_hash: validatedReview.pack_hash,
          payload: null,
        };
      }
      try {
        const args = JSON.parse(String(call.argumentsJson || "{}"));
        return {
          payload: args?.company_payload,
          brief_hash: args?.investigation_brief?.brief_hash,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (review) =>
        (review?.payload && typeof review.payload === "object") ||
        (typeof review?.pack_hash === "string" &&
          typeof review?.brief_hash === "string"),
    );
  const verifiedPackMatchesReview = verifiedPacks.some((verified) =>
    reviewPacks.some(
      (reviewed) =>
        (reviewed.payload &&
          canonicalJson(verified) === canonicalJson(reviewed.payload) &&
          typeof reviewed.brief_hash === "string" &&
          reviewed.brief_hash === verified.brief_hash) ||
        (typeof reviewed.pack_hash === "string" &&
          reviewed.pack_hash === verified.pack_hash &&
          typeof reviewed.brief_hash === "string" &&
          reviewed.brief_hash === verified.brief_hash),
    ),
  );
  const latestPack = verifiedPacks.at(-1) || null;
  const verifiedCount = Number(
    latestPack?.verification_summary?.verified_object_count || 0,
  );
  const strongEvidence = (latestPack?.evidence_by_question || [])
    .flatMap((item) => item?.evidence || [])
    .filter((item) => item?.usable_for_strong_claim === true);
  const allowedNumericText = [question, JSON.stringify(strongEvidence)].join(" ");
  const allowedNumbers = new Set(exactNumberTokens(allowedNumericText));
  const answerNumbersMissingFromVerifiedEvidence = exactNumberTokens(answer)
    .filter((token) => !allowedNumbers.has(token))
    .filter((token, index, values) => values.indexOf(token) === index);
  return {
    verified_pack_matches_review: verifiedPackMatchesReview,
    zero_verified_company_evidence: Boolean(latestPack) && verifiedCount === 0,
    answer_numbers_missing_from_verified_evidence:
      answerNumbersMissingFromVerifiedEvidence,
  };
}

function unwrapMcpJsonResult(value) {
  if (!value || typeof value !== "object") return null;
  if (value.format === "krw-verified-company-evidence/v1") return value;
  if (typeof value.result === "string") {
    try {
      const parsed = JSON.parse(value.result);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return value.result && typeof value.result === "object" ? value.result : null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactNumberTokens(text) {
  return (
    String(text || "").match(
      /(?:\$[0-9][0-9.,]*(?:\s?(?:B|M|K|bn|mn|조|억|만))?|[0-9][0-9.,]*\s?(?:%|배|달러|조|억|만|bps|bp)|(?:FY|CY)?20[0-9]{2}Q[1-4]|(?:FY|CY)20[0-9]{2})/gi,
    ) || []
  ).map((token) => token.replace(/\s+/g, "").toUpperCase());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv(path.join(repoRoot, ".env"));
  loadDotEnv(path.join(repoRoot, ".env.local"));
  ensureRuntimeDefaults();
  installServerOnlyStub();

  const cases = JSON.parse(readFileSync(path.resolve(args.questions), "utf8"));
  const selected = selectCases(cases, args);
  mkdirSync(path.resolve(args.out), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonlPath = path.join(args.out, `guru-quality-${stamp}.jsonl`);
  const summaryPath = path.join(args.out, `guru-quality-${stamp}.md`);

  if (selected.length === 0) {
    writeFileSync(summaryPath, "# Guru Quality Smoke\n\nNo cases selected.\n");
    console.log(`No cases selected. Wrote ${summaryPath}`);
    if (!args.reportOnly) {
      throw new Error("Guru quality smoke selected no cases");
    }
    return;
  }

  const { runAgent } = await import("../src/lib/agent/runner.ts");
  const { sanitizeAssistantContent } = await import("../src/lib/chat/assistant-content.ts");

  const summaryLines = [
    "# Guru Quality Smoke",
    "",
    `- started_at: ${new Date().toISOString()}`,
    `- cases: ${selected.length}`,
    `- jsonl: ${jsonlPath}`,
    "",
    `- timeout_ms: ${args.timeoutMs}`,
    "",
    "| id | guru | ticker | status | elapsed | score | sealed brief | verified pack | pack match | review tool | internal terms |",
    "|---|---|---:|---|---:|---:|---|---|---|---|---|",
  ];

  let failedCases = 0;
  for (const item of selected) {
    const toolNames = [];
    const chunks = [];
    const caseStartedAtMs = Date.now();
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, args.timeoutMs);
    // The SDK CLI child is intentionally unref'ed. Keep this standalone smoke
    // harness alive until runAgent settles so it can record the final contract
    // result instead of exiting while the child is still working.
    const keepAlive = setInterval(() => undefined, 1_000);
    const writer = {
      async write(chunk) {
        const text = Buffer.from(chunk).toString("utf8");
        chunks.push(text);
        for (const match of text.matchAll(/event: tool_call_start\ndata: ([^\n]+)/g)) {
          try {
            const payload = JSON.parse(match[1]);
            if (payload.toolName) toolNames.push(payload.toolName);
          } catch {
            // Keep the smoke running; the final accumulated result is authoritative.
          }
        }
      },
    };
    const startedAt = new Date().toISOString();
    let record;
    try {
      const result = await runAgent(
        {
          sessionId: randomUUID(),
          userMessage: item.question,
          scopeType: item.ticker ? "company" : "global",
          defaultTickers: item.ticker ? [item.ticker] : [],
          defaultDocumentTypes: [],
          researchMode: "deep",
          runKind: "guru_advisor",
          responseLocale: "ko",
          abortSignal: abortController.signal,
        },
        writer,
      );
      const rawAnswer = result.acc.fullText || "";
      const cleanedAnswer = sanitizeAssistantContent(rawAnswer);
      const allToolNames = [
        ...toolNames,
        ...result.acc.toolCalls.map((call) => call.toolName),
      ];
      const sseText = chunks.join("");
      const flags = qualityFlags(cleanedAnswer, allToolNames, rawAnswer);
      if (hasReviewedCompanyEvidencePayload(result.acc.toolCalls)) {
        flags.used_company_subagent_signal = true;
      }
      flags.used_investigation_brief = hasInvestigationBriefDelegation(
        result.acc.toolCalls,
        sseText,
      );
      flags.used_sealed_question_evidence = hasSealedQuestionEvidencePayload(
        result.acc.toolCalls,
      );
      Object.assign(
        flags,
        verifiedEvidenceAudit(
          result.acc.toolCalls,
          cleanedAnswer,
          item.question,
        ),
      );
      const elapsedMs = Date.now() - caseStartedAtMs;
      if (abortController.signal.aborted || result.status === "cancelled") {
        flags.timed_out = true;
      }
      record = {
        id: item.id,
        guru: item.guru,
        ticker: item.ticker || null,
        category: item.category || null,
        question: item.question,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        elapsed_ms: elapsedMs,
        status: result.status,
        score: scoreFlags(flags),
        flags,
        tool_names: Array.from(new Set(allToolNames)),
        tool_calls: result.acc.toolCalls,
        citations_count: result.acc.citations.length,
        raw_answer: rawAnswer,
        cleaned_answer: cleanedAnswer,
        sse_preview: sseText.slice(0, 8000),
      };
    } catch (error) {
      const elapsedMs = Date.now() - caseStartedAtMs;
      const timedOut = abortController.signal.aborted;
      record = {
        id: item.id,
        guru: item.guru,
        ticker: item.ticker || null,
        category: item.category || null,
        question: item.question,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        elapsed_ms: elapsedMs,
        status: timedOut ? "timeout" : "error",
        score: 0,
        flags: {
          timed_out: timedOut,
          used_review_tool: toolNames.some((name) =>
            name.includes("krw_guru_review_company_evidence"),
          ),
          has_internal_terms: false,
        },
        error: error instanceof Error ? error.stack || error.message : String(error),
        tool_names: Array.from(new Set(toolNames)),
        sse_preview: chunks.join("").slice(0, 8000),
      };
    } finally {
      clearTimeout(timeout);
      clearInterval(keepAlive);
    }
    if (record.status !== "completed") failedCases += 1;
    writeFileSync(jsonlPath, `${JSON.stringify(record)}\n`, { flag: "a" });
    summaryLines.push(
      `| ${record.id} | ${record.guru} | ${record.ticker || ""} | ${record.status} | ${Math.round((record.elapsed_ms ?? 0) / 1000)}s | ${record.score} | ${record.flags?.used_investigation_brief ? "yes" : "no"} | ${record.flags?.used_verified_evidence_tool ? "yes" : "no"} | ${record.flags?.verified_pack_matches_review ? "yes" : "no"} | ${record.flags?.used_review_tool ? "yes" : "no"} | ${record.flags?.has_internal_terms ? "yes" : "no"} |`,
    );
  }

  summaryLines.push("", `Finished at ${new Date().toISOString()}.`);
  writeFileSync(summaryPath, `${summaryLines.join("\n")}\n`);
  console.log(`Guru quality smoke complete: ${summaryPath}`);
  if (failedCases > 0 && !args.reportOnly) {
    throw new Error(
      `Guru quality smoke failed ${failedCases} of ${selected.length} cases`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
