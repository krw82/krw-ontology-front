#!/usr/bin/env node
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { createServerClient } from "@supabase/ssr";
import WebSocket from "ws";

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const DEFAULT_BASE_URL = "https://krwontology.com";
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_RECONNECT_DELAY_MS = 800;
const AUTH_REFRESH_SKEW_MS = 10 * 60 * 1000;
const DEFAULT_220Q_SOURCE =
  "~/test/krw_222_fast_research_pack_full_final.jsonl";
const RUN_TAG = new Date().toISOString().replace(/[:.]/g, "-");

const BUILTIN_CASES = [
  {
    id: "AAPL_SERVICES_MIX",
    cat: "metric",
    ticker: "AAPL",
    q: "Apple의 iPhone과 Services 매출 비중이 어떻게 달라졌고, 마진에는 어떤 의미인지 비교해줘.",
  },
  {
    id: "AAPL_DMA_RISK",
    cat: "risk",
    ticker: "AAPL",
    q: "주요 리스크 요인인 App Store 규제(특히 EU DMA)가 Services 매출에 미칠 잠재적 영향은 어느 정도로 추정되는가?",
  },
  {
    id: "MSFT_AI_CAPEX",
    cat: "metric",
    ticker: "MSFT",
    q: "MSFT의 AI 인프라 투자 부담이 capex와 margin에 어떻게 잡히는지 공시자료 기준으로 봐줘.",
  },
  {
    id: "AMZN_AWS_MARGIN",
    cat: "trend",
    ticker: "AMZN",
    q: "AMZN의 AWS 성장과 북미/국제 segment 수익성 변화가 어떻게 갈렸는지 봐줘.",
  },
  {
    id: "NVDA_CHINA_EXPORT",
    cat: "risk",
    ticker: "NVDA",
    q: "NVDA가 중국 export control에 직접 노출되어 있는지, 매출과 마진에는 어떤 경로로 영향이 갈 수 있는지 봐줘.",
  },
  {
    id: "GOOGL_ADS_YOUTUBE",
    cat: "trend",
    ticker: "GOOGL",
    q: "GOOGL의 Search 광고와 YouTube 광고 성장 흐름을 비교해줘.",
  },
  {
    id: "META_CAPEX_MARGIN",
    cat: "metric",
    ticker: "META",
    q: "META의 capex 증가가 영업마진에 부담인지 공시자료 기준으로 분석해줘.",
  },
  {
    id: "JPM_NII_DEPOSITS",
    cat: "metric",
    ticker: "JPM",
    q: "JPM의 NII와 예금 비용 변화가 수익성에 어떤 영향을 줬는지 최근 공시 기준으로 설명해줘.",
  },
  {
    id: "COST_MEMBERSHIP",
    cat: "metric",
    ticker: "COST",
    q: "COST의 comparable sales와 membership fee revenue가 매출 방어력에 어떻게 기여했는지 봐줘.",
  },
  {
    id: "AAPL_TARIFF",
    cat: "scenario",
    ticker: "AAPL",
    q: "관세가 올라가면 AAPL에는 어떤 경로로 부담이 생겨?",
  },
  {
    id: "CLOUD_WINNERS",
    cat: "discovery",
    ticker: null,
    q: "클라우드 수요 증가에 가장 직접적으로 수혜 보는 기업을 찾아줘.",
  },
  {
    id: "AI_CAPEX_BURDEN",
    cat: "discovery",
    ticker: null,
    q: "AI capex 증가가 부담으로 잡히는 기업들을 찾아줘.",
  },
  {
    id: "AAPL_FOLLOWUPS",
    cat: "light",
    ticker: "AAPL",
    q: "AAPL 관련해서 다음에 물어볼 만한 질문 3개만 추천해줘.",
  },
  {
    id: "MSFT_FOLLOWUPS",
    cat: "light",
    ticker: "MSFT",
    q: "이어서 보면 좋은 MSFT 분석 포인트 3개만 알려줘.",
  },
  {
    id: "AMZN_FOLLOWUPS",
    cat: "light",
    ticker: "AMZN",
    q: "AMZN 답변 이후 후속 질문으로 뭐를 물어보면 좋아?",
  },
];

const SUITES = {
  "3q": BUILTIN_CASES.slice(0, 3),
  "5q": BUILTIN_CASES.slice(0, 5),
  "30q": [
    ...BUILTIN_CASES,
    ...BUILTIN_CASES.map((item) => ({
      ...item,
      id: `${item.id}_R2`,
      q: `${item.q} 핵심 근거와 숫자를 더 압축해서 정리해줘.`,
    })),
  ].slice(0, 30),
};

function usage() {
  console.log(`Usage: node scripts/run-prod-chat-e2e.mjs [options]

Run production chat Agent E2E from the local machine using a dedicated test
account. The script calls the production web API, lets the production
agent-worker execute the run, then collects run/message/tool-call rows through
Supabase REST.

Options:
  --base-url URL              Defaults to PROD_E2E_BASE_URL or ${DEFAULT_BASE_URL}
  --supabase-url URL          Defaults to PROD_E2E_SUPABASE_URL
  --supabase-anon-key KEY     Defaults to PROD_E2E_SUPABASE_ANON_KEY
  --email EMAIL               Defaults to PROD_E2E_EMAIL
  --password PASSWORD         Defaults to PROD_E2E_PASSWORD
  --env-file PATH             Load PROD_E2E_* values from a local env file
  --suite 3q|5q|30q|220q      Defaults to 3q
  --question-file PATH        JSON array of { id, q, ticker?, cat? }
  --suite-220q-source PATH    JSONL source for --suite 220q. Defaults to ${DEFAULT_220Q_SOURCE}
  --research-mode MODE        Defaults to deep
  --concurrency N             Defaults to PROD_E2E_CONCURRENCY or 1
  --start-index N             0-based case offset for long-run resume
  --max-cases N               Limit selected cases
  --timeout-ms N              Per-case timeout. Defaults to ${DEFAULT_TIMEOUT_MS}
  --output PATH               Defaults to /tmp/krw-prod-chat-e2e-<timestamp>.json
  --dry-run                   Print plan only; does not authenticate or call prod
  --help, -h                  Show this help

Required for real runs:
  PROD_E2E_SUPABASE_URL, PROD_E2E_SUPABASE_ANON_KEY,
  PROD_E2E_EMAIL, PROD_E2E_PASSWORD
`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PROD_E2E_BASE_URL || DEFAULT_BASE_URL,
    supabaseUrl: process.env.PROD_E2E_SUPABASE_URL || "",
    supabaseAnonKey: process.env.PROD_E2E_SUPABASE_ANON_KEY || "",
    email: process.env.PROD_E2E_EMAIL || "",
    password: process.env.PROD_E2E_PASSWORD || "",
    suite: process.env.PROD_E2E_SUITE || "3q",
    questionFile: "",
    suite220qSource: process.env.PROD_E2E_220Q_SOURCE || DEFAULT_220Q_SOURCE,
    researchMode: process.env.PROD_E2E_RESEARCH_MODE || "deep",
    concurrency: Number(process.env.PROD_E2E_CONCURRENCY || 1),
    startIndex: Number(process.env.PROD_E2E_START_INDEX || 0),
    maxCases: Number(process.env.PROD_E2E_MAX_CASES || 0),
    timeoutMs: Number(process.env.PROD_E2E_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    output: process.env.PROD_E2E_OUTPUT || "",
    envFile: "",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") {
      usage();
      process.exit(0);
    }
    if (flag === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    const valueFlags = new Set([
      "--base-url",
      "--supabase-url",
      "--supabase-anon-key",
      "--email",
      "--password",
      "--env-file",
      "--suite",
      "--question-file",
      "--suite-220q-source",
      "--research-mode",
      "--concurrency",
      "--start-index",
      "--max-cases",
      "--timeout-ms",
      "--output",
    ]);
    if (!valueFlags.has(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    const value = argv[i + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    i += 1;

    if (flag === "--base-url") args.baseUrl = value;
    else if (flag === "--supabase-url") args.supabaseUrl = value;
    else if (flag === "--supabase-anon-key") args.supabaseAnonKey = value;
    else if (flag === "--email") args.email = value;
    else if (flag === "--password") args.password = value;
    else if (flag === "--env-file") args.envFile = value;
    else if (flag === "--suite") args.suite = value;
    else if (flag === "--question-file") args.questionFile = value;
    else if (flag === "--suite-220q-source") args.suite220qSource = value;
    else if (flag === "--research-mode") args.researchMode = value;
    else if (flag === "--concurrency") args.concurrency = Number(value);
    else if (flag === "--start-index") args.startIndex = Number(value);
    else if (flag === "--max-cases") args.maxCases = Number(value);
    else if (flag === "--timeout-ms") args.timeoutMs = Number(value);
    else if (flag === "--output") args.output = value;
  }

  return args;
}

async function applyEnvFile(args) {
  if (!args.envFile) return args;

  const text = await readFile(args.envFile, "utf8");
  const values = parseEnvText(text);
  return {
    ...args,
    baseUrl:
      args.baseUrl === DEFAULT_BASE_URL && values.PROD_E2E_BASE_URL
        ? values.PROD_E2E_BASE_URL
        : args.baseUrl || DEFAULT_BASE_URL,
    supabaseUrl: args.supabaseUrl || values.PROD_E2E_SUPABASE_URL || "",
    supabaseAnonKey:
      args.supabaseAnonKey || values.PROD_E2E_SUPABASE_ANON_KEY || "",
    email: args.email || values.PROD_E2E_EMAIL || "",
    password: args.password || values.PROD_E2E_PASSWORD || "",
    suite:
      args.suite === "3q" && values.PROD_E2E_SUITE
        ? values.PROD_E2E_SUITE
        : args.suite || "3q",
    suite220qSource:
      args.suite220qSource === DEFAULT_220Q_SOURCE && values.PROD_E2E_220Q_SOURCE
        ? values.PROD_E2E_220Q_SOURCE
        : args.suite220qSource || DEFAULT_220Q_SOURCE,
    researchMode:
      args.researchMode === "deep" && values.PROD_E2E_RESEARCH_MODE
        ? values.PROD_E2E_RESEARCH_MODE
        : args.researchMode || "deep",
    concurrency: args.concurrency || Number(values.PROD_E2E_CONCURRENCY || 1),
    startIndex: args.startIndex || Number(values.PROD_E2E_START_INDEX || 0),
    maxCases: args.maxCases || Number(values.PROD_E2E_MAX_CASES || 0),
    timeoutMs:
      args.timeoutMs || Number(values.PROD_E2E_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    output: args.output || values.PROD_E2E_OUTPUT || "",
  };
}

function parseEnvText(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function selectCases(args) {
  let cases;
  if (args.questionFile) {
    const parsed = JSON.parse(await readFile(args.questionFile, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("--question-file must be a JSON array");
    }
    cases = parsed.map((item, index) => normalizeCase(item, index));
  } else {
    if (args.suite === "220q") {
      cases = await load220qCases(args.suite220qSource);
    } else {
      cases = SUITES[args.suite];
      if (!cases) {
        throw new Error(`Unknown suite: ${args.suite}. Use one of ${[...Object.keys(SUITES), "220q"].join(", ")}`);
      }
    }
  }

  const startIndex =
    Number.isFinite(args.startIndex) && args.startIndex > 0 ? Math.floor(args.startIndex) : 0;
  const selected = startIndex > 0 ? cases.slice(startIndex) : cases;

  if (Number.isFinite(args.maxCases) && args.maxCases > 0) {
    return selected.slice(0, args.maxCases);
  }
  return selected;
}

async function load220qCases(sourcePath) {
  const text = await readFile(sourcePath, "utf8");
  const cases = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const item = JSON.parse(line);
    cases.push(
      normalizeCase(
        {
          id: item.case_id ?? `Q${index + 1}`,
          cat: item.category ?? "220q",
          ticker: item.ticker ?? null,
          q: item.question,
        },
        index,
      ),
    );
    if (cases.length >= 220) break;
  }
  if (cases.length < 220) {
    throw new Error(`220q source only yielded ${cases.length} cases: ${sourcePath}`);
  }
  return cases;
}

function normalizeCase(item, index) {
  if (!item || typeof item !== "object") {
    throw new Error(`Invalid question case at index ${index}`);
  }
  if (typeof item.q !== "string" || !item.q.trim()) {
    throw new Error(`Question case ${index} is missing q`);
  }
  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `Q${index + 1}`,
    cat: typeof item.cat === "string" && item.cat.trim() ? item.cat.trim() : "custom",
    ticker:
      typeof item.ticker === "string" && item.ticker.trim()
        ? item.ticker.trim().toUpperCase()
        : null,
    q: item.q.trim(),
  };
}

function validateConfig(args, cases) {
  new URL(args.baseUrl);
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 10_000) {
    throw new Error("--timeout-ms must be at least 10000");
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be at least 1");
  }
  if (!Number.isFinite(args.startIndex) || args.startIndex < 0) {
    throw new Error("--start-index must be at least 0");
  }
  if (!cases.length) throw new Error("No E2E cases selected");

  if (args.dryRun) return;

  const missing = [];
  if (!args.supabaseUrl) missing.push("PROD_E2E_SUPABASE_URL");
  if (!args.supabaseAnonKey) missing.push("PROD_E2E_SUPABASE_ANON_KEY");
  if (!args.email) missing.push("PROD_E2E_EMAIL");
  if (!args.password) missing.push("PROD_E2E_PASSWORD");
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(", ")}`);
  }
}

function redacted(value) {
  if (!value) return "(missing)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function authenticate(args) {
  const cookieJar = new Map();
  const supabase = createServerClient(args.supabaseUrl, args.supabaseAnonKey, {
    cookies: {
      getAll() {
        return Array.from(cookieJar.entries()).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          cookieJar.set(name, value);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: args.email,
    password: args.password,
  });
  if (error) throw new Error(`test account sign-in failed: ${error.message}`);
  if (!data.session?.access_token) {
    throw new Error("test account sign-in did not return an access token");
  }

  return {
    userId: data.user?.id ?? null,
    accessToken: data.session.access_token,
    expiresAtMs: data.session.expires_at
      ? data.session.expires_at * 1000
      : Date.now() + 50 * 60 * 1000,
    cookieHeader: Array.from(cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; "),
  };
}

function authNeedsRefresh(auth) {
  return !auth.expiresAtMs || Date.now() >= auth.expiresAtMs - AUTH_REFRESH_SKEW_MS;
}

function isExpired(auth) {
  return Boolean(auth.expiresAtMs && Date.now() >= auth.expiresAtMs);
}

function isInfrastructureRateLimit(result) {
  const notes = result.notes ?? [];
  const eventTexts = (result.events ?? []).flatMap((event) => [
    event?.event,
    event?.data?.text,
    event?.data?.error_code,
    event?.data?.error_message,
  ]);
  return [...notes, ...eventTexts].some((note) => {
    if (!note) return false;
    const lower = note.toLowerCase();
    return (
      lower.includes("post /api/chat/run failed: 429") ||
      lower.includes("too many requests") ||
      lower.includes("rate_limited") ||
      lower.includes("jwt expired") ||
      lower.includes("402 insufficient balance") ||
      lower.includes("insufficient balance")
    );
  });
}

function isImmediateInfraFailure(result) {
  const toolCalls = result.db?.tool_calls?.length ?? 0;
  return result.grade === "FAIL" && toolCalls === 0 && result.elapsed_sec <= 10;
}

function buildHeaders(auth) {
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${auth.accessToken}`,
    Cookie: auth.cookieHeader,
  };
}

function buildRestHeaders(args, auth) {
  return {
    apikey: args.supabaseAnonKey,
    Authorization: `Bearer ${auth.accessToken}`,
  };
}

function buildRequestBody(testCase, args, requestId) {
  const content = `[PROD_E2E:${RUN_TAG}:${testCase.id}] ${testCase.q}`;
  return {
    content,
    request_id: requestId,
    research_mode: args.researchMode,
    ...(testCase.ticker
      ? { scope_type: "company", default_tickers: [testCase.ticker] }
      : { scope_type: "global" }),
  };
}

function makeRequestId() {
  return randomUUID();
}

async function runCase(testCase, args, auth) {
  const started = Date.now();
  const requestId = makeRequestId(testCase);
  const state = {
    case_id: testCase.id,
    request_id: requestId,
    session_id: null,
    run_id: null,
    last_event_id: 0,
    events: [],
    terminal_event: null,
    error: null,
    reconnects: 0,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  timeout.unref?.();

  try {
    const postResponse = await fetch(new URL("/api/chat/run", args.baseUrl), {
      method: "POST",
      headers: buildHeaders(auth),
      body: JSON.stringify(buildRequestBody(testCase, args, requestId)),
      signal: controller.signal,
    });

    if (!postResponse.ok) {
      throw new Error(
        `POST /api/chat/run failed: ${postResponse.status} ${await postResponse.text()}`,
      );
    }

    state.session_id = postResponse.headers.get("x-chat-session-id");
    await readSseResponse(postResponse, state);

    while (!state.terminal_event && Date.now() - started < args.timeoutMs) {
      if (!state.session_id) break;
      state.reconnects += 1;
      await delay(DEFAULT_RECONNECT_DELAY_MS);
      const url = new URL("/api/chat/run/reconnect", args.baseUrl);
      url.searchParams.set("session_id", state.session_id);
      if (state.run_id) url.searchParams.set("run_id", state.run_id);
      if (state.last_event_id) {
        url.searchParams.set("last_event_id", String(state.last_event_id));
      }

      const reconnectResponse = await fetch(url, {
        method: "GET",
        headers: buildHeaders(auth),
        signal: controller.signal,
      });
      if (!reconnectResponse.ok) {
        throw new Error(
          `GET /api/chat/run/reconnect failed: ${reconnectResponse.status} ${await reconnectResponse.text()}`,
        );
      }
      await readSseResponse(reconnectResponse, state);
    }

    if (!state.terminal_event) {
      state.error = "case timeout before terminal run event";
    }
  } catch (error) {
    state.error =
      controller.signal.aborted
        ? "case timeout"
        : error instanceof Error
          ? error.message
          : String(error);
  } finally {
    clearTimeout(timeout);
  }

  const db = await collectDbState(args, auth, {
    requestId,
    sessionId: state.session_id,
    runId: state.run_id,
  }).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const elapsedMs = Date.now() - started;
  const grade = gradeCase(testCase, state, db, elapsedMs, args.timeoutMs);

  return {
    ...testCase,
    request_id: requestId,
    session_id: state.session_id,
    run_id: state.run_id,
    status: grade.status,
    grade: grade.grade,
    notes: grade.notes,
    elapsed_ms: elapsedMs,
    elapsed_sec: Math.round(elapsedMs / 100) / 10,
    reconnects: state.reconnects,
    terminal_event: state.terminal_event,
    error: state.error,
    event_count: state.events.length,
    events: state.events,
    db,
  };
}

async function readSseResponse(response, state) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      applySseEvent(parseSseBlock(block), state);
    }
  }

  const remaining = buffer.trim();
  if (remaining) applySseEvent(parseSseBlock(remaining), state);
}

function parseSseBlock(block) {
  const dataLines = [];
  let id = null;
  let event = "message";
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) id = Number(line.slice(3).trim());
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  let data = null;
  if (dataLines.length) {
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      data = dataLines.join("\n");
    }
  }
  return { id, event, data };
}

function applySseEvent(parsed, state) {
  if (!parsed.event || parsed.event === "message") return;
  if (Number.isFinite(parsed.id)) {
    state.last_event_id = Math.max(state.last_event_id, parsed.id);
  }
  const data = parsed.data && typeof parsed.data === "object" ? parsed.data : {};
  if (typeof data.session_id === "string") state.session_id = data.session_id;
  if (typeof data.run_id === "string" && data.run_id) state.run_id = data.run_id;
  if (parsed.event === "run_started") {
    if (typeof data.session_id === "string") state.session_id = data.session_id;
    if (typeof data.run_id === "string") state.run_id = data.run_id;
  }
  if (
    parsed.event === "done" ||
    parsed.event === "error" ||
    parsed.event === "cancelled"
  ) {
    state.terminal_event = parsed.event;
  }
  if (
    parsed.event === "state_sync" &&
    ["completed", "failed", "cancelled", "expired"].includes(data.status)
  ) {
    state.terminal_event = `state_sync:${data.status}`;
  }
  state.events.push({
    id: parsed.id,
    event: parsed.event,
    data,
  });
}

async function collectDbState(args, auth, ids) {
  const headers = buildRestHeaders(args, auth);
  const requestFilter = encodeURIComponent(ids.requestId);
  const runs = await rest(
    args,
    headers,
    `agent_runs?request_id=eq.${requestFilter}&select=id,status,error_code,error_message,queued_at,claimed_at,started_at,finished_at,latency_ms,input_tokens,output_tokens,assistant_message_id,session_id&order=queued_at.asc`,
  );
  const run = runs.at(-1) ?? null;
  const runId = run?.id ?? ids.runId;
  const sessionId = run?.session_id ?? ids.sessionId;
  let messages = [];
  let toolCalls = [];
  let events = [];

  if (sessionId) {
    messages = await rest(
      args,
      headers,
      `messages?session_id=eq.${sessionId}&select=id,role,status,created_at,content&order=created_at.asc`,
    );
  }
  if (runId) {
    toolCalls = await rest(
      args,
      headers,
      `tool_calls?run_id=eq.${runId}&select=id,tool_name,started_at,finished_at,error_message,result_summary&order=started_at.asc`,
    );
    events = await rest(
      args,
      headers,
      `agent_run_events?run_id=eq.${runId}&select=id,event_type,created_at,payload&order=id.asc`,
    );
  }

  const assistant = run?.assistant_message_id
    ? messages.find((message) => message.id === run.assistant_message_id) ?? null
    : messages.filter((message) => message.role === "assistant").at(-1) ?? null;

  return {
    run,
    messages: messages.map((message) => ({
      ...message,
      content_preview: String(message.content ?? "").replace(/\s+/g, " ").slice(0, 400),
      content_chars: String(message.content ?? "").length,
      content: undefined,
    })),
    assistant: assistant
      ? {
          id: assistant.id,
          status: assistant.status,
          chars: String(assistant.content ?? "").length,
          preview: String(assistant.content ?? "").replace(/\s+/g, " ").slice(0, 1200),
        }
      : null,
    tool_calls: toolCalls.map((tool) => ({
      ...tool,
      duration_ms:
        tool.started_at && tool.finished_at
          ? new Date(tool.finished_at).getTime() - new Date(tool.started_at).getTime()
          : null,
    })),
    events,
    open_tool_calls: toolCalls.filter((tool) => !tool.finished_at).length,
  };
}

async function rest(args, headers, pathName) {
  const response = await fetch(`${args.supabaseUrl}/rest/v1/${pathName}`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Supabase REST failed: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

function gradeCase(testCase, state, db, elapsedMs, timeoutMs) {
  const notes = [];
  const run = db?.run ?? null;
  const assistant = db?.assistant ?? null;
  const openToolCalls = db?.open_tool_calls ?? null;

  if (state.error) notes.push(state.error);
  if (db?.error) notes.push(`db collection failed: ${db.error}`);
  if (!run) notes.push("run row not found");
  if (run && run.status !== "completed") {
    notes.push(`run status is ${run.status}`);
  }
  if (!assistant) notes.push("assistant message not found");
  if (assistant && assistant.status !== "completed") {
    notes.push(`assistant status is ${assistant.status}`);
  }
  if (assistant && assistant.chars < 120) notes.push("assistant answer too short");
  if (openToolCalls != null && openToolCalls > 0) {
    notes.push(`open tool calls: ${openToolCalls}`);
  }
  if (elapsedMs > timeoutMs) notes.push("case exceeded timeout");
  if (testCase.cat !== "light" && (db?.tool_calls?.length ?? 0) < 1) {
    notes.push("no tool calls observed");
  }

  if (!run || run.status !== "completed" || state.error || db?.error) {
    return { grade: "FAIL", status: run?.status ?? "failed", notes };
  }
  if (
    !assistant ||
    assistant.status !== "completed" ||
    assistant.chars < 120 ||
    (openToolCalls ?? 0) > 0
  ) {
    return { grade: "PARTIAL", status: run.status, notes };
  }
  if (notes.length) return { grade: "PARTIAL", status: run.status, notes };
  return { grade: "PASS", status: run.status, notes: ["basic checks passed"] };
}

function summarize(results, args) {
  const counts = { pass: 0, partial: 0, fail: 0 };
  for (const result of results) {
    if (result.grade === "PASS") counts.pass += 1;
    else if (result.grade === "PARTIAL") counts.partial += 1;
    else counts.fail += 1;
  }
  const elapsed = results.map((result) => result.elapsed_sec).sort((a, b) => a - b);
  const pick = (p) =>
    elapsed.length ? elapsed[Math.min(elapsed.length - 1, Math.floor((elapsed.length - 1) * p))] : 0;
  return {
    started_at: RUN_TAG,
    finished_at: new Date().toISOString(),
    base_url: args.baseUrl,
    supabase_url_host: args.supabaseUrl ? new URL(args.supabaseUrl).host : null,
    suite: args.suite,
    concurrency: args.concurrency,
    research_mode: args.researchMode,
    count: results.length,
    concurrency: args.concurrency,
    ...counts,
    score_pct: Math.round(((counts.pass + counts.partial * 0.5) / Math.max(1, results.length)) * 1000) / 10,
    avg_elapsed_sec:
      Math.round((results.reduce((sum, item) => sum + item.elapsed_sec, 0) / Math.max(1, results.length)) * 100) / 100,
    median_elapsed_sec: pick(0.5),
    p90_elapsed_sec: pick(0.9),
    max_elapsed_sec: elapsed.at(-1) ?? 0,
  };
}

function markdown(report) {
  const s = report.summary;
  const lines = [
    `# Production Chat E2E (${s.suite})`,
    "",
    `- base URL: ${s.base_url}`,
    `- Supabase: ${s.supabase_url_host}`,
    `- research mode: ${s.research_mode}`,
    `- cases: ${s.count}`,
    `- PASS / PARTIAL / FAIL: ${s.pass} / ${s.partial} / ${s.fail}`,
    `- score: ${s.score_pct}%`,
    `- avg / median / p90 / max: ${s.avg_elapsed_sec}s / ${s.median_elapsed_sec}s / ${s.p90_elapsed_sec}s / ${s.max_elapsed_sec}s`,
    "",
    "| case | grade | status | sec | tools | open tools | reconnects | notes |",
    "|---|---|---|---:|---:|---:|---:|---|",
  ];
  for (const result of report.results) {
    const tools = result.db?.tool_calls?.length ?? 0;
    const open = result.db?.open_tool_calls ?? "";
    const notes = (result.notes ?? []).join("; ").replace(/\|/g, "\\|");
    lines.push(
      `| ${result.id} | ${result.grade} | ${result.status} | ${result.elapsed_sec} | ${tools} | ${open} | ${result.reconnects} | ${notes} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function writeReport(report, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  const markdownPath = outputPath.match(/\.json$/i)
    ? outputPath.replace(/\.json$/i, ".md")
    : `${outputPath}.md`;
  await writeFile(markdownPath, markdown(report), "utf8");
  return { outputPath, markdownPath };
}

function jsonlPathFor(outputPath) {
  return outputPath.match(/\.json$/i)
    ? outputPath.replace(/\.json$/i, ".jsonl")
    : `${outputPath}.jsonl`;
}

async function runCases(cases, args, auth, jsonlPath) {
  const results = [];
  let nextIndex = 0;
  let cachedAuth = auth;
  let refreshPromise = null;
  const concurrency = Math.min(args.concurrency, cases.length);

  async function getAuthForCase(workerIndex, testCase) {
    if (!authNeedsRefresh(cachedAuth)) return cachedAuth;

    if (!refreshPromise) {
      refreshPromise = authenticate(args)
        .then((nextAuth) => {
          cachedAuth = nextAuth;
          return nextAuth;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    try {
      return await refreshPromise;
    } catch (error) {
      console.log(
        JSON.stringify({
          worker: workerIndex,
          case: testCase.id,
          auth_refresh_failed: error instanceof Error ? error.message : String(error),
        }),
      );
      if (isExpired(cachedAuth)) throw error;
      return cachedAuth;
    }
  }

  async function worker(workerIndex) {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= cases.length) return;

      const testCase = cases[index];
      console.log(JSON.stringify({ worker: workerIndex, case: testCase.id, n: index + 1, total: cases.length }));
      const caseAuth = await getAuthForCase(workerIndex, testCase);
      const result = await runCase(testCase, args, caseAuth);
      results[index] = result;
      await appendFile(jsonlPath, `${JSON.stringify(result)}\n`, "utf8");
      console.log(
        JSON.stringify({
          worker: workerIndex,
          case: result.id,
          grade: result.grade,
          status: result.status,
          elapsed_sec: result.elapsed_sec,
          tools: result.db?.tool_calls?.length ?? null,
          open_tool_calls: result.db?.open_tool_calls ?? null,
          notes: result.notes,
        }),
      );

      if (isInfrastructureRateLimit(result) || isImmediateInfraFailure(result)) {
        throw new Error(
          `Production E2E stopped at ${testCase.id}; infrastructure/rate-limit failure detected. Resume with --start-index ${args.startIndex + index}.`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)));
  return results.filter(Boolean);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let args = parseArgs(process.argv.slice(2));
  args = await applyEnvFile(args);
  if (!args.output) {
    args.output = `/tmp/krw-prod-chat-e2e-${RUN_TAG}.json`;
  }
  const cases = await selectCases(args);
  validateConfig(args, cases);

  const plan = {
    dry_run: args.dryRun,
    base_url: args.baseUrl,
    supabase_url: args.supabaseUrl ? new URL(args.supabaseUrl).host : "(missing)",
    supabase_anon_key: redacted(args.supabaseAnonKey),
    email: args.email || "(missing)",
    password: redacted(args.password),
    suite: args.suite,
    suite_220q_source: args.suite === "220q" ? args.suite220qSource : undefined,
    research_mode: args.researchMode,
    concurrency: args.concurrency,
    start_index: args.startIndex,
    timeout_ms: args.timeoutMs,
    output: args.output,
    cases: cases.map(({ id, cat, ticker, q }) => ({ id, cat, ticker, q })),
  };

  if (args.dryRun) {
    console.log(JSON.stringify({ plan, message: "Dry run: no auth or production request executed." }, null, 2));
    return;
  }

  console.log(JSON.stringify({ plan: { ...plan, cases: `${cases.length} cases` } }));
  const auth = await authenticate(args);
  console.log(JSON.stringify({ authenticated: true, user_id: auth.userId }));

  const jsonlPath = jsonlPathFor(args.output);
  await mkdir(path.dirname(jsonlPath), { recursive: true });
  await rm(jsonlPath, { force: true });
  const results = await runCases(cases, args, auth, jsonlPath);

  const report = {
    kind: "prod_chat_e2e",
    summary: summarize(results, args),
    results,
  };
  const written = await writeReport(report, args.output);
  console.log(JSON.stringify({ written: { ...written, jsonlPath }, summary: report.summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
