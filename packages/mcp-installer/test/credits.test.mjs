import assert from 'node:assert/strict';
import test from 'node:test';
import { compactCreditSummaryLines, creditSummaryLines, parseCreditSummary } from '../src/credits.mjs';
import { checkConnection } from '../src/connection.mjs';
import { API_KEY, CREDIT_SUMMARY, mcpHandler, serve, TOOLS } from './helpers.mjs';

test('credit reporting keeps pending provider costs informational without reserving the wallet', () => {
  const data = structuredClone(CREDIT_SUMMARY);
  Object.assign(data.balance, { remaining: 800, monthlyRemaining: 800, purchasedRemaining: 0, reserved: 0, debt: 4, usagePending: true });
  const summary = parseCreditSummary(data);
  assert.equal(summary.balance.remaining, 800);
  const lines = creditSummaryLines(summary).join('\n');
  assert.match(lines, /800 available/);
  assert.match(lines, /not reserved for current work/);
  assert.match(lines, /Usage awaiting payment: 4 credits/);
  assert.match(lines, /does not reserve the balance/);
  assert.doesNotMatch(lines, /Low balance/);
  assert.match(lines, /2026-11-01/);
  assert.match(lines, /AI charges are known after usage/);
});

test('only balances below 30 get a short approximate rendering and scene warning', () => {
  for (const remaining of [29, 30, 992.997426]) {
    const data = structuredClone(CREDIT_SUMMARY);
    data.balance.remaining = remaining;
    const lines = creditSummaryLines(parseCreditSummary(data)).join('\n');
    assert.equal(lines.includes('Low balance:'), remaining < 30);
    assert.ok(!lines.includes('992.997426'));
  }
});

test('unavailable or malformed balances are never converted to zero or printed as untrusted text', () => {
  for (const invalid of [null, {}, { balance: { remaining: API_KEY } }, { balance: { ...CREDIT_SUMMARY.balance, debt: NaN } }, { balance: { ...CREDIT_SUMMARY.balance, remaining: -1 } }]) {
    assert.equal(parseCreditSummary(invalid), null);
  }
  const data = structuredClone(CREDIT_SUMMARY);
  data.balance.nextReset = API_KEY;
  data.pricing.renderPerMinute = `\x1b[31m${API_KEY}`;
  const lines = creditSummaryLines(parseCreditSummary(data)).join('\n');
  assert.ok(!lines.includes(API_KEY));
  assert.ok(!lines.includes('\x1b'));
});

test('unconfigured pricing is a blocker even when there are credits', () => {
  const summary = parseCreditSummary({ ...CREDIT_SUMMARY, pricing: { configured: false } });
  assert.match(creditSummaryLines(summary).join('\n'), /pricing is not configured/);
});

test('updated MCP pricing bills server video and scene rendering but not client-authored code', () => {
  const data = structuredClone(CREDIT_SUMMARY);
  data.balance.remaining = 0;
  data.pricing.configured = false;
  data.mcpPricing = { sceneAuthoringCredits: 0, sceneCompilationCredits: 0, serverRenderingBilled: true, toolSelectionCredits: 0, providerPricingConfigured: false, renderPricingConfigured: false };
  const lines = creditSummaryLines(parseCreditSummary(data)).join('\n');
  assert.match(lines, /Server video rendering AND server scene rendering are billed/);
  assert.match(lines, /without a server AI generation fee/);
  assert.match(lines, /Video and scene rendering cannot start; source authoring\/compilation remains available/);
  assert.doesNotMatch(lines, /MCP rendering remain free|final rendering use zero|Only images.*are billed/);
  Object.assign(data.mcpPricing, { renderPricingConfigured: true, renderPerMinute: '3', sceneRenderPerMinute: '3' });
  assert.match(creditSummaryLines(parseCreditSummary(data)).join('\n'), /video 3 and scenes 3 credits\/output minute, recorded separately/);
});

test('older APIs can connect but explicitly report that balance lookup is unavailable', async (t) => {
  const endpoint = await serve(t, mcpHandler([], { tools: TOOLS.filter((tool) => tool.name !== 'get_credits') }));
  const result = await checkConnection(endpoint, API_KEY);
  assert.equal(result.credits, null);
  assert.match(result.creditsWarning, /does not expose get_credits/);
});

test('voice and caption minimums are displayed only from valid deployed metadata', () => {
  const data = structuredClone(CREDIT_SUMMARY);
  data.mcpPricing = {
    sceneAuthoringCredits: 0, sceneCompilationCredits: 0, serverRenderingBilled: true,
    toolSelectionCredits: 0, providerPricingConfigured: true, renderPricingConfigured: true,
    speechMinimumCredits: 1, transcriptionMinimumCredits: 1,
  };
  const summary = parseCreditSummary(data);
  for (const lines of [creditSummaryLines(summary), compactCreditSummaryLines(summary)]) {
    assert.match(lines.join('\n'), /Audio minimums: speech 1 and captions\/transcription 1 credits/);
    assert.match(lines.join('\n'), /verified positive usage; higher usage costs more/);
  }
  for (const invalid of [undefined, -1, 0.5, Infinity, '1', API_KEY]) {
    data.mcpPricing.speechMinimumCredits = invalid;
    assert.doesNotMatch(creditSummaryLines(parseCreditSummary(data)).join('\n'), /Audio minimums:/);
  }
});

test('a ledger outage does not invent a wallet or prevent free recipe setup', async (t) => {
  const endpoint = await serve(t, mcpHandler([], { credits: API_KEY, creditStatus: 503 }));
  const result = await checkConnection(endpoint, API_KEY);
  assert.equal(result.credits, null);
  assert.match(result.creditsWarning, /verified balance/);
  assert.ok(!JSON.stringify(result).includes(API_KEY));
});

test('loss of authorization during credit lookup fails setup rather than saving a broken connection', async (t) => {
  const endpoint = await serve(t, mcpHandler([], { creditStatus: 401 }));
  await assert.rejects(checkConnection(endpoint, API_KEY), /401/);
});

test('compact credits show the balance and billing rule without the full pricing explanation', () => {
  const lines = compactCreditSummaryLines(parseCreditSummary(CREDIT_SUMMARY));
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'API credits: 900 available.');
  assert.match(lines[1], /billed after usage.*not reserved/);
  assert.doesNotMatch(lines.join('\n'), /USD|monthly|Next monthly reset/);
});

test('compact credits preserve debt, pending usage, low balance and unavailable pricing', () => {
  const data = structuredClone(CREDIT_SUMMARY);
  Object.assign(data.balance, { remaining: 20, debt: 4, usagePending: true });
  data.mcpPricing = { sceneAuthoringCredits: 0, sceneCompilationCredits: 0, serverRenderingBilled: true, toolSelectionCredits: 0, providerPricingConfigured: false, renderPricingConfigured: false };
  const text = compactCreditSummaryLines(parseCreditSummary(data)).join('\n');
  for (const pattern of [/Usage awaiting payment: 4/, /Some provider costs/, /Low balance:/, /Video and scene rendering cannot start/, /Paid image, speech and caption pricing is not configured/]) {
    assert.match(text, pattern);
  }
  assert.match(compactCreditSummaryLines(parseCreditSummary({ ...data, mcpPricing: null, pricing: { configured: false } })).join('\n'), /Paid API pricing is not configured/);
});
