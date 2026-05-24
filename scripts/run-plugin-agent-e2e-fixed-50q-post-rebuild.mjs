import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

const OUT_DIR = '~/test/krw-ontology-index-quality-20260520';
const WORKSPACE = '~/test/krw-agent-e2e-workspace';
const PLUGIN_PATH = '~/.codex/plugins/cache/krw-ontology-local/krw-ontology/0.1.0';
const DATA_ROOT = '~/krw-ontology-data';
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const PER_CASE_TIMEOUT_MS = Number(process.env.E2E_CASE_TIMEOUT_MS || 240000);
const MAX_CASES = Number(process.env.E2E_MAX_CASES || 50);
const RUN_TAG = new Date().toISOString().replace(/[:.]/g, '-');

const TOOL_PREFIX = 'mcp__plugin_krw-ontology_krw-ontology__';
const TOOLS = [
  'krw_ontology_catalog',
  'krw_ontology_company_context',
  'krw_ontology_index_context',
  'krw_ontology_topic_map',
  'krw_ontology_query',
  'krw_ontology_query_context',
  'krw_ontology_retrieve',
  'krw_ontology_trace',
  'krw_ontology_quality',
  'krw_ontology_compare',
  'krw_ontology_plan_query',
  'krw_ontology_chain',
];
const ALLOWED_TOOLS = TOOLS.map((t) => `${TOOL_PREFIX}${t}`);

const QUESTIONS = [
  { id: 'M01', cat: 'metric', ticker: 'AAPL', q: 'AAPL의 iPhone과 Services 매출 비중은 2021~2025년에 어떻게 달라졌고, 성장률 차이는 무엇인지 비교해줘.' },
  { id: 'M02', cat: 'metric', ticker: 'MSFT', q: 'MSFT의 cloud/AI 인프라 투자 부담이 capex와 margin에 어떻게 잡히는지 공시자료 기준으로 봐줘.' },
  { id: 'M03', cat: 'metric', ticker: 'AMZN', q: 'AMZN의 fulfillment cost와 shipping cost가 매출 성장률을 갉아먹는지 숫자와 사업 메커니즘으로 점검해줘.' },
  { id: 'M04', cat: 'metric', ticker: 'JPM', q: 'JPM의 NII와 예금 비용 변화가 수익성에 어떤 영향을 줬는지 최근 공시 기준으로 설명해줘.' },
  { id: 'M05', cat: 'metric', ticker: 'BAC', q: 'BAC의 NII 민감도와 funding cost 부담을 공시자료 기준으로 봐줘.' },
  { id: 'M06', cat: 'metric', ticker: 'GOOGL', q: 'GOOGL의 광고 매출 성장률과 operating margin 추이를 같이 봐줘.' },
  { id: 'M07', cat: 'metric', ticker: 'META', q: 'META의 capex 증가가 영업마진에 부담인지 공시자료 기준으로 분석해줘.' },
  { id: 'M08', cat: 'metric', ticker: 'NVDA', q: 'NVDA의 data center revenue 성장과 gross margin 흐름을 같이 봐줘.' },
  { id: 'M09', cat: 'metric', ticker: 'AAPL', q: 'AAPL의 total net sales와 Services net sales 성장률 차이를 계산 관점으로 설명해줘.' },
  { id: 'M10', cat: 'metric', ticker: 'MSFT', q: 'MSFT의 revenue growth와 operating income growth 차이가 어디서 났는지 봐줘.' },
  { id: 'M11', cat: 'metric', ticker: 'COST', q: 'COST의 comparable sales와 membership fee revenue가 매출 방어력에 어떻게 기여했는지 봐줘.' },
  { id: 'M12', cat: 'metric', ticker: 'UNH', q: 'UNH의 의료비율 또는 cost ratio 변화가 operating margin에 어떤 압박을 줬는지 설명해줘.' },

  { id: 'T01', cat: 'trend', ticker: 'AAPL', q: 'AAPL의 제품 매출과 서비스 매출 추세를 최근 여러 기간 기준으로 비교해줘.' },
  { id: 'T02', cat: 'trend', ticker: 'AMZN', q: 'AMZN의 AWS 성장과 북미/국제 segment 수익성 변화가 어떻게 갈렸는지 봐줘.' },
  { id: 'T03', cat: 'trend', ticker: 'GOOGL', q: 'GOOGL의 Search 광고와 YouTube 광고 성장 흐름을 비교해줘.' },
  { id: 'T04', cat: 'trend', ticker: 'META', q: 'META의 advertising revenue와 Reality Labs 손실 흐름을 같이 설명해줘.' },
  { id: 'T05', cat: 'trend', ticker: 'NFLX', q: 'NFLX의 revenue growth와 operating margin 개선이 어떤 경로로 나타났는지 봐줘.' },
  { id: 'T06', cat: 'trend', ticker: 'TSLA', q: 'TSLA의 automotive revenue와 gross margin 추세가 가격 인하 영향과 어떻게 연결되는지 봐줘.' },
  { id: 'T07', cat: 'trend', ticker: 'KO', q: 'KO의 가격/믹스와 volume 변화가 매출 성장에 어떻게 기여했는지 봐줘.' },
  { id: 'T08', cat: 'trend', ticker: 'PEP', q: 'PEP의 organic revenue growth와 operating profit 흐름을 비교해줘.' },

  { id: 'C01', cat: 'compare', ticker: null, q: 'AAPL과 MSFT 중 AI 인프라 투자 부담이 margin에 더 직접적으로 잡히는 쪽은?' },
  { id: 'C02', cat: 'compare', ticker: null, q: 'JPM과 BAC 중 금리/NII 민감도가 더 직접적으로 보이는 쪽은?' },
  { id: 'C03', cat: 'compare', ticker: null, q: 'GOOGL과 META 중 광고 둔화에 더 직접 노출된 쪽은?' },
  { id: 'C04', cat: 'compare', ticker: null, q: 'AMZN과 MSFT 중 cloud demand 수혜가 operating income에 더 잘 연결되는 쪽은?' },
  { id: 'C05', cat: 'compare', ticker: null, q: 'V와 MA 중 cross-border 회복이 매출에 더 직접적으로 연결되는 쪽은?' },
  { id: 'C06', cat: 'compare', ticker: null, q: 'NVDA와 AMD 중 AI data center demand가 매출에 더 직접적으로 드러나는 쪽은?' },
  { id: 'C07', cat: 'compare', ticker: null, q: 'KO와 PEP 중 원가 인플레이션이 margin에 더 직접적으로 부담인 쪽은?' },
  { id: 'C08', cat: 'compare', ticker: null, q: 'COST와 MCD 중 소비 둔화에 더 방어적인 구조를 가진 쪽은?' },

  { id: 'D01', cat: 'direct', ticker: 'AAPL', q: 'AAPL이 LNG 가격이나 Henry Hub 가격에 직접 노출되어 있나?' },
  { id: 'D02', cat: 'direct', ticker: 'V', q: 'V가 원유 가격에 직접 노출되어 있나?' },
  { id: 'D03', cat: 'direct', ticker: 'MSFT', q: 'MSFT가 HBM spot price에 직접 노출되어 있나?' },
  { id: 'D04', cat: 'direct', ticker: 'AMZN', q: 'AMZN이 호르무즈 해협 봉쇄에 직접 노출되어 있나?' },
  { id: 'D05', cat: 'direct', ticker: 'AAPL', q: 'AAPL이 관세에 직접 영향을 받는다고 공시했나?' },
  { id: 'D06', cat: 'direct', ticker: 'NVDA', q: 'NVDA가 중국 export control에 직접 노출되어 있나?' },
  { id: 'D07', cat: 'direct', ticker: 'LLY', q: 'LLY가 특허 만료나 바이오시밀러 경쟁에 직접 노출되어 있나?' },
  { id: 'D08', cat: 'direct', ticker: 'NEE', q: 'NEE가 금리 상승에 직접적으로 capex나 financing cost 부담을 받는지 봐줘.' },

  { id: 'S01', cat: 'scenario', ticker: 'AMZN', q: '유가가 오르면 AMZN의 어느 재무 채널이 영향을 받을 수 있어?' },
  { id: 'S02', cat: 'scenario', ticker: 'AAPL', q: '관세가 올라가면 AAPL에는 어떤 경로로 부담이 생겨?' },
  { id: 'S03', cat: 'scenario', ticker: 'JPM', q: '금리 하락은 JPM에 좋은가 나쁜가? NII와 credit 관점으로 나눠서 봐줘.' },
  { id: 'S04', cat: 'scenario', ticker: null, q: '소비 둔화가 COST와 MCD에 미치는 영향은 어떻게 달라?' },
  { id: 'S05', cat: 'scenario', ticker: null, q: '달러 강세가 MSFT와 AAPL 매출에 주는 영향은 어떻게 달라?' },
  { id: 'S06', cat: 'scenario', ticker: 'NVDA', q: '중국 수출 규제가 강화되면 NVDA의 매출과 margin에는 어떤 경로로 영향이 갈 수 있어?' },

  { id: 'R01', cat: 'discovery', ticker: null, q: '클라우드 수요 증가에 가장 직접적으로 수혜 보는 기업을 찾아줘.' },
  { id: 'R02', cat: 'discovery', ticker: null, q: '소비 둔화에 가장 민감한 기업을 찾아줘.' },
  { id: 'R03', cat: 'discovery', ticker: null, q: '자사주/배당으로 주주환원 방어력이 큰 기업을 찾아줘.' },
  { id: 'R04', cat: 'discovery', ticker: null, q: '규제 리스크가 사업모델에 직접 연결되는 기업을 찾아줘.' },
  { id: 'R05', cat: 'discovery', ticker: null, q: 'AI capex 증가가 부담으로 잡히는 기업들을 찾아줘.' },

  { id: 'L01', cat: 'light', ticker: 'AAPL', q: 'AAPL 관련해서 다음에 물어볼 만한 질문 3개만 추천해줘.' },
  { id: 'L02', cat: 'light', ticker: 'MSFT', q: '이어서 보면 좋은 MSFT 분석 포인트 3개만 알려줘.' },
  { id: 'L03', cat: 'light', ticker: 'AMZN', q: 'AMZN 답변 이후 후속 질문으로 뭐를 물어보면 좋아?' },
].slice(0, MAX_CASES);

const NUMERIC_10 = QUESTIONS.filter((q) => q.cat === 'metric').slice(0, 10);

function promptFor(q) {
  const scope = q.ticker ? `\n기본 티커: ${q.ticker}` : '';
  return `/krw-ontology:krw-ontology-research ${q.q}${scope}`;
}

function getBlocks(message) {
  const content = message?.message?.content ?? message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

function normalizeToolName(name) {
  if (typeof name !== 'string') return null;
  const i = name.lastIndexOf('__');
  return i >= 0 ? name.slice(i + 2) : name;
}

function parseToolJson(text) {
  if (!text || typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function summarizeText(v, max = 1600) {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.slice(0, max);
}

function hasInternalLeak(answer) {
  const patterns = [
    /quote_id/i, /span_id/i, /support_link_id/i, /edge_id/i, /object_id/i,
    /chunk label/i, /MetricObservation/i, /ExternalFactorExposure/i,
    /BusinessFactor/i, /ResearchClaim/i, /EvidenceQuote/i,
    /ontology/i, /MCP\b/i, /JSONL/i, /trace_id/i,
  ];
  return patterns.some((p) => p.test(answer));
}

function gradeCase(q, status, answer, toolCalls, error) {
  if (status !== 'completed' || error) return { grade: 'FAIL', notes: ['run failed or timed out'] };
  const notes = [];
  if (answer.trim().length < 120) notes.push('answer too short');
  if (hasInternalLeak(answer)) notes.push('internal term leak');
  if (q.cat === 'direct' && /직접/.test(q.q)) {
    if (!/(직접|공시자료|확인|노출|관련 맥락|근거)/.test(answer)) notes.push('directness language weak');
  }
  if (q.cat === 'metric') {
    if (!/(매출|성장|마진|비중|수익|비용|NII|capex|현금|영업)/i.test(answer)) notes.push('metric language weak');
  }
  if (q.cat === 'light' && toolCalls.length > 2) notes.push('light intent used too many tools');
  const hasTool = q.cat === 'light' ? true : toolCalls.length > 0;
  if (!hasTool) notes.push('no MCP tool observed');
  if (notes.some((n) => n.includes('internal') || n.includes('too many tools'))) return { grade: 'FAIL', notes };
  if (notes.length > 0) return { grade: 'PARTIAL', notes };
  return { grade: 'PASS', notes: ['basic checks passed'] };
}

async function runOne(q, suiteName) {
  const started = Date.now();
  const sessionId = `${suiteName}-${RUN_TAG}-${q.id}`;
  const cwd = WORKSPACE;
  await mkdir(cwd, { recursive: true });
  const toolCalls = [];
  const open = new Map();
  const textParts = [];
  const observedModels = new Set();
  let diagnostics = null;
  let status = 'completed';
  let error = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_CASE_TIMEOUT_MS);
  try {
    const sdkOptions = {
      cwd,
      model: MODEL,
      pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE || undefined,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: [
          'Use the KRW Ontology plugin skill and MCP tools for equity research.',
          'Answer in Korean. Do not expose internal IDs, object types, chunk labels, tool names, MCP, ontology, JSONL, or debug fields.',
          'For Korean questions, internally form an English Research Brief, but do not show it unless explicitly asked.',
          'For follow-up question recommendation requests, do not run deep research; suggest 3 concise follow-up questions from current ticker/topic context.',
        ].join('\n'),
      },
      plugins: [{ type: 'local', path: PLUGIN_PATH }],
      tools: [],
      allowedTools: ALLOWED_TOOLS,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project'],
      maxTurns: 20,
      includePartialMessages: false,
      abortController: controller,
      env: {
        ...process.env,
        KRW_ONTOLOGY_ROOT: DATA_ROOT,
        KRW_ONTOLOGY_PLUGIN_PATH: PLUGIN_PATH,
        CLAUDE_PLUGIN_PATH: PLUGIN_PATH,
      },
      sessionId,
    };
    const sdkQuery = query({ prompt: promptFor(q), options: sdkOptions });
    try {
      const [initResult, statusResult] = await Promise.allSettled([
        sdkQuery.initializationResult(),
        sdkQuery.mcpServerStatus(),
      ]);
      diagnostics = {
        pluginPath: PLUGIN_PATH,
        cwd,
        model: MODEL,
        slashCommands: initResult.status === 'fulfilled' ? initResult.value.commands?.map((c) => c.name) : [],
        mcpServerStatus: statusResult.status === 'fulfilled' ? statusResult.value : null,
        initError: initResult.status === 'rejected' ? String(initResult.reason) : null,
        mcpStatusError: statusResult.status === 'rejected' ? String(statusResult.reason) : null,
      };
    } catch (e) {
      diagnostics = { diagnostics_error: String(e) };
    }

    for await (const message of sdkQuery) {
      if (message?.model) observedModels.add(message.model);
      if (message?.message?.model) observedModels.add(message.message.model);

      if (message.type === 'assistant') {
        const blocks = getBlocks(message);
        const containsTool = blocks.some((b) => b.type === 'tool_use');
        for (const block of blocks) {
          if (block.type === 'text' && !containsTool && typeof block.text === 'string') textParts.push(block.text);
          if (block.type === 'tool_use') {
            const id = block.id || `tool-${toolCalls.length + 1}`;
            const tc = {
              id,
              name: normalizeToolName(block.name),
              input: block.input ?? {},
              started_at: new Date().toISOString(),
              finished_at: null,
              duration_sec: null,
              result_chars: null,
              is_error: false,
            };
            open.set(id, tc);
            toolCalls.push(tc);
          }
        }
      }

      if (message.type === 'user') {
        const blocks = getBlocks(message);
        for (const block of blocks) {
          if (block.type !== 'tool_result') continue;
          const id = block.tool_use_id;
          const tc = open.get(id);
          const txt = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
          if (tc) {
            tc.finished_at = new Date().toISOString();
            tc.duration_sec = Math.round((new Date(tc.finished_at) - new Date(tc.started_at)) / 100) / 10;
            tc.result_chars = txt.length;
            tc.is_error = Boolean(block.is_error);
            tc.result_preview = summarizeText(txt, 800);
            open.delete(id);
          }
        }
      }

      if (message.type === 'result') {
        if (message.subtype === 'success') {
          if (!textParts.join('').trim() && typeof message.result === 'string') textParts.push(message.result);
          status = 'completed';
        } else {
          status = 'failed';
          error = Array.isArray(message.errors) ? message.errors.join('\n') : 'SDK result failure';
        }
      }
    }
  } catch (e) {
    status = controller.signal.aborted ? 'timeout' : 'failed';
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
    const now = new Date().toISOString();
    for (const tc of open.values()) {
      tc.finished_at = now;
      tc.duration_sec = Math.round((new Date(now) - new Date(tc.started_at)) / 100) / 10;
      tc.is_error = true;
    }
  }

  const answer = textParts.join('').trim();
  const elapsed_sec = Math.round((Date.now() - started) / 100) / 10;
  const grade = gradeCase(q, status, answer, toolCalls, error);
  return {
    ...q,
    suite: suiteName,
    session_id: sessionId,
    prompt: promptFor(q),
    status,
    error,
    elapsed_sec,
    observed_models: Array.from(observedModels),
    answer_len: answer.length,
    answer_preview: answer.slice(0, 1200),
    answer,
    tool_calls: toolCalls,
    diagnostics,
    grade: grade.grade,
    notes: grade.notes,
  };
}

function summarize(results, mode) {
  const counts = { pass: 0, partial: 0, fail: 0, timeout: 0 };
  const cats = {};
  for (const r of results) {
    if (r.status === 'timeout') counts.timeout += 1;
    if (r.grade === 'PASS') counts.pass += 1;
    else if (r.grade === 'PARTIAL') counts.partial += 1;
    else counts.fail += 1;
    cats[r.cat] ||= { total: 0, pass: 0, partial: 0, fail: 0, timeout: 0, avg_elapsed_sec: 0, avg_tool_calls: 0 };
    const c = cats[r.cat];
    c.total += 1;
    if (r.status === 'timeout') c.timeout += 1;
    if (r.grade === 'PASS') c.pass += 1;
    else if (r.grade === 'PARTIAL') c.partial += 1;
    else c.fail += 1;
    c.avg_elapsed_sec += r.elapsed_sec;
    c.avg_tool_calls += r.tool_calls.length;
  }
  const elapsed = results.map((r) => r.elapsed_sec).sort((a,b) => a-b);
  const toolCounts = results.map((r) => r.tool_calls.length).sort((a,b) => a-b);
  const pick = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))] : 0;
  for (const c of Object.values(cats)) {
    c.avg_elapsed_sec = Math.round((c.avg_elapsed_sec / c.total) * 100) / 100;
    c.avg_tool_calls = Math.round((c.avg_tool_calls / c.total) * 100) / 100;
  }
  const allTools = results.flatMap((r) => r.tool_calls.map((tc) => ({
    question_id: r.id,
    question: r.q,
    cat: r.cat,
    tool_name: tc.name,
    duration_sec: tc.duration_sec,
    result_chars: tc.result_chars,
    input: tc.input,
    is_error: tc.is_error,
  })));
  const slowest = allTools.filter((t) => typeof t.duration_sec === 'number').sort((a,b) => b.duration_sec - a.duration_sec).slice(0, 10);
  return {
    mode,
    started_at: RUN_TAG,
    updated_at: new Date().toISOString(),
    done: true,
    pluginPath: PLUGIN_PATH,
    dataRoot: DATA_ROOT,
    cwd: WORKSPACE,
    model: MODEL,
    count: results.length,
    ...counts,
    score_pct: Math.round(((counts.pass + 0.5 * counts.partial) / Math.max(1, results.length)) * 1000) / 10,
    avg_elapsed_sec: Math.round((results.reduce((s,r)=>s+r.elapsed_sec,0) / Math.max(1, results.length)) * 100) / 100,
    median_elapsed_sec: pick(elapsed, 0.5),
    p90_elapsed_sec: pick(elapsed, 0.9),
    max_elapsed_sec: elapsed.at(-1) ?? 0,
    avg_tool_calls: Math.round((results.reduce((s,r)=>s+r.tool_calls.length,0) / Math.max(1, results.length)) * 100) / 100,
    median_tool_calls: pick(toolCounts, 0.5),
    p90_tool_calls: pick(toolCounts, 0.9),
    max_tool_calls: toolCounts.at(-1) ?? 0,
    by_category: cats,
    slowest_tool_calls_top10: slowest,
  };
}

function markdown(report) {
  const s = report.summary;
  const lines = [];
  lines.push(`# KRW Ontology Plugin-only Agent E2E Report (${report.kind})`);
  lines.push('');
  lines.push(`- 생성 시각: ${s.updated_at}`);
  lines.push(`- 플러그인: \`${s.pluginPath}\``);
  lines.push(`- 데이터 루트: \`${s.dataRoot}\``);
  lines.push(`- 모델: \`${s.model}\``);
  lines.push(`- 문항 수: ${s.count}`);
  lines.push(`- PASS / PARTIAL / FAIL / TIMEOUT: ${s.pass} / ${s.partial} / ${s.fail} / ${s.timeout}`);
  lines.push(`- 점수: ${s.score_pct}%`);
  lines.push(`- 평균/중앙값/p90/최대 시간: ${s.avg_elapsed_sec}s / ${s.median_elapsed_sec}s / ${s.p90_elapsed_sec}s / ${s.max_elapsed_sec}s`);
  lines.push(`- 평균/중앙값/p90/최대 tool calls: ${s.avg_tool_calls} / ${s.median_tool_calls} / ${s.p90_tool_calls} / ${s.max_tool_calls}`);
  lines.push('');
  lines.push('## Category summary');
  lines.push('');
  lines.push('| category | total | pass | partial | fail | timeout | avg sec | avg tools |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [cat, c] of Object.entries(s.by_category)) {
    lines.push(`| ${cat} | ${c.total} | ${c.pass} | ${c.partial} | ${c.fail} | ${c.timeout} | ${c.avg_elapsed_sec} | ${c.avg_tool_calls} |`);
  }
  lines.push('');
  lines.push('## Slowest tool calls top 10');
  lines.push('');
  lines.push('| rank | question | category | tool | duration | result chars | input |');
  lines.push('|---:|---|---|---|---:|---:|---|');
  s.slowest_tool_calls_top10.forEach((t, i) => {
    const input = JSON.stringify(t.input ?? {}).replace(/\|/g, '\\|').slice(0, 260);
    lines.push(`| ${i+1} | ${t.question_id} | ${t.cat} | ${t.tool_name} | ${t.duration_sec}s | ${t.result_chars ?? ''} | ${input} |`);
  });
  lines.push('');
  lines.push('## Per-question results');
  lines.push('');
  lines.push('| id | category | grade | status | sec | tools | question | notes |');
  lines.push('|---|---|---|---|---:|---:|---|---|');
  for (const r of report.results) {
    const q = r.q.replace(/\|/g, '\\|');
    const notes = (r.notes ?? []).join('; ').replace(/\|/g, '\\|');
    lines.push(`| ${r.id} | ${r.cat} | ${r.grade} | ${r.status} | ${r.elapsed_sec} | ${r.tool_calls.length} | ${q} | ${notes} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function runSuite(name, questions) {
  const results = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(JSON.stringify({ suite: name, n: i + 1, total: questions.length, id: q.id, cat: q.cat, q: q.q }, null, 0));
    const r = await runOne(q, name);
    results.push(r);
    console.log(JSON.stringify({ suite: name, id: q.id, grade: r.grade, status: r.status, elapsed_sec: r.elapsed_sec, tools: r.tool_calls.length, slowest_tool_sec: Math.max(0, ...r.tool_calls.map(t => t.duration_sec || 0)) }, null, 0));
  }
  const report = { kind: name, summary: summarize(results, name), results };
  const jsonPath = path.join(OUT_DIR, `krw_ontology_plugin_agent_e2e_${name}_${RUN_TAG}.json`);
  const mdPath = path.join(OUT_DIR, `krw_ontology_plugin_agent_e2e_${name}_${RUN_TAG}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, markdown(report), 'utf8');
  return { report, jsonPath, mdPath };
}

await mkdir(OUT_DIR, { recursive: true });
await mkdir(WORKSPACE, { recursive: true });
await writeFile(path.join(OUT_DIR, `krw_ontology_fixed_50q_post_rebuild_${RUN_TAG}.json`), JSON.stringify({ created_at: new Date().toISOString(), questions: QUESTIONS, numeric_10: NUMERIC_10 }, null, 2), 'utf8');
const main = await runSuite('fixed_50q_post_rebuild', QUESTIONS);
const numeric = await runSuite('numeric_10_post_rebuild', NUMERIC_10);
console.log(JSON.stringify({ main: { jsonPath: main.jsonPath, mdPath: main.mdPath, summary: main.report.summary }, numeric: { jsonPath: numeric.jsonPath, mdPath: numeric.mdPath, summary: numeric.report.summary } }, null, 2));
