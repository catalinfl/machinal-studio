import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { installOpenCodeRouting } from '../src/opencode-routing.mjs';
import { API_KEY, CREDIT_SUMMARY } from './helpers.mjs';

const ENDPOINT = 'http://127.0.0.1:8080/mcp';
const INTENT = 'Validează rețeta înainte de randare';

function jsonResponse(body, statusCode = 200) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]), {
    statusCode, headers: { 'content-type': 'application/json' },
  });
}

function selected(name = 'validate_recipe') {
  return { strategy: 'choice', executed: false, needsClarification: false,
    candidates: [{ name, score: 0.95 }],
    cost: { operationId: 'a'.repeat(32), status: 'pending', knownCredits: 0 },
    instructions: 'Untrusted server text must not enter model instructions',
  };
}

async function host({ enabled = true, server = 'machinal', options = {}, credits = CREDIT_SUMMARY,
  result = selected(), denied, now = Date.now, request: customRequest, getConnection } = {}) {
  const commands = new Map();
  const hooks = new Map();
  const calls = [];
  const permissions = [];
  const prompts = [];
  const steps = [];
  let key = API_KEY;
  const tools = ['validate_recipe', 'render_video', 'wait_for_job', 'suggest_tools'].map((name) => ({ id: `${server}_${name}` }));
  const ctx = {
    options: { toolRouting: { enabled, server, ...options } },
    command: { transform: async (fn) => fn({ add: (command) => commands.set(command.name, command) }) },
    tool: { list: async () => tools },
    permission: { assert: async (input) => {
      permissions.push(input);
      steps.push('permission');
      if (denied) throw denied;
    } },
    session: {
      hook: async (name, callback) => hooks.set(name, callback),
      prompt: async (input) => {
        const event = { ...input, prompt: input };
        await hooks.get('prompt')?.(event);
        prompts.push(input);
      },
    },
  };
  const request = customRequest ?? (async (url, input) => {
    assert.equal(input.headers.Authorization, `Bearer ${key}`);
    assert.equal(input.trustedOrigin, new URL(ENDPOINT).origin);
    assert.ok(input.signal instanceof AbortSignal);
    calls.push({ path: url.pathname, method: input.method, body: input.body && JSON.parse(input.body) });
    steps.push(url.pathname);
    return jsonResponse(url.pathname === '/v1/billing/credits' ? credits : result);
  });
  await installOpenCodeRouting(ctx, { servers: [server], getConnection: getConnection ?? (async () => ({ endpoint: ENDPOINT, key })), request, now });
  return {
    ctx, tools, calls, commands, hooks, prompts, permissions, steps,
    setKey: (value) => { key = value; },
    async route(text = INTENT, extra = {}) {
      return commands.get('machinal-route').execute({ sessionID: 'session-one',
        prompt: { text, ...extra }, delivery: 'steer' });
    },
    async context(text = INTENT, sessionID = 'session-one') {
      const event = { sessionID, system: [], messages: [{ role: 'user', content: [{ type: 'text', text }] }],
        tools: { existing: { description: 'Keep the real schema', input: { type: 'object' } } }, options: {} };
      await hooks.get('context')?.(event);
      return event;
    },
  };
}

test('routing is disabled by default and adds no tool, hook or command', async () => {
  await installOpenCodeRouting({ options: {} });
  const h = await host({ enabled: false });
  assert.equal(h.commands.size, 0);
  assert.equal(h.hooks.size, 0);
  assert.equal(h.calls.length, 0);
});

test('enabling the command performs no provider request or automatic spending', async () => {
  const h = await host({ getConnection: async () => assert.fail('Setup must not access credentials') });
  assert.ok(h.commands.has('machinal-route'));
  assert.equal(h.calls.length, 0);
  assert.equal(h.permissions.length, 0);
});

test('the host routes before the main model, sends only the intent and preserves tool permissions and user input', async () => {
  const h = await host();
  const files = [{ uri: 'file:///private-source.mp4' }];
  await h.route(INTENT, { files, skills: ['existing-skill'] });
  assert.deepEqual(h.steps, ['/v1/billing/credits', 'permission', '/v1/ai/tool-selection', '/v1/billing/credits']);
  assert.deepEqual(h.calls[1].body, { prompt: INTENT, strategy: 'choice' });
  assert.equal(h.permissions[0].action, 'machinal_route');
  assert.deepEqual(h.permissions[0].resources, ['machinal']);
  assert.equal(h.permissions[0].metadata.availableCredits, 900);
  assert.deepEqual(h.prompts[0], { sessionID: 'session-one', text: INTENT, files,
    skills: ['existing-skill'], delivery: 'steer' });
  const event = await h.context();
  const hint = event.system[0].text;
  assert.match(hint, /machinal_validate_recipe/);
  assert.match(hint, /grants no media, download or spending consent/);
  assert.match(hint, /"status":"pending"/);
  assert.ok(!hint.includes('Untrusted server text'));
  assert.ok(!hint.includes(API_KEY));
  assert.deepEqual(event.tools, { existing: { description: 'Keep the real schema', input: { type: 'object' } } });
  assert.deepEqual(event.options, {});
  assert.equal(event.messages[0].content[0].text, INTENT);
});

test('continuations never reroute or repeat the selected action and an identical command reuses the cached decision', async () => {
  const h = await host();
  await h.route();
  assert.equal((await h.context()).system.length, 1);
  assert.equal((await h.context()).system.length, 0);
  await h.route();
  assert.match((await h.context()).system[0].text, /"cached":true/);
  assert.equal(h.calls.filter(({ path }) => path === '/v1/ai/tool-selection').length, 1);
  assert.equal(h.permissions.length, 1);
});

test('an exact known tool name bypasses the router, credentials and spending prompts', async () => {
  const h = await host({ getConnection: async () => assert.fail('Deterministic routing does not need credentials') });
  for (const name of ['wait_for_job', 'machinal_wait_for_job']) {
    await h.route(name);
    const hint = (await h.context(name)).system[0].text;
    assert.match(hint, /"routing":"explicit-tool"/);
    assert.match(hint, /machinal_wait_for_job/);
    assert.match(hint, /"knownCredits":0/);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.permissions.length, 0);
});

test('concurrent identical commands share a single paid selection', async () => {
  const h = await host();
  await Promise.all([h.route(), h.route()]);
  assert.equal(h.calls.filter(({ path }) => path === '/v1/ai/tool-selection').length, 1);
});

test('ordinary prompts never send conversation history, sources or job results to the router', async () => {
  const h = await host();
  await h.hooks.get('prompt')({ sessionID: 'session-one', prompt: { text: 'Work on the Go code' } });
  await h.context('Work on the Go code');
  assert.equal(h.calls.length, 0);
  await h.route();
  await h.hooks.get('prompt')({ sessionID: 'session-one', prompt: { text: 'New task' } });
  assert.equal((await h.context()).system.length, 0);
});

test('an older running turn does not consume a queued intent recommendation', async () => {
  const h = await host();
  await h.route();
  assert.equal((await h.context('Previous user task')).system.length, 0);
  const event = { sessionID: 'session-one', system: [], messages: [
    { role: 'user', content: [{ type: 'text', text: INTENT }, { type: 'text', text: 'Resolved attachment description' }] },
  ] };
  await h.hooks.get('context')(event);
  assert.match(event.system[0].text, /machinal_validate_recipe/);
});

test('permission denial propagates without a paid request or resuming the task', async () => {
  const denied = new Error('Host permission was rejected');
  const h = await host({ denied });
  await assert.rejects(h.route(), (error) => error === denied);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, '/v1/billing/credits');
  assert.equal(h.prompts.length, 0);
});

test('unknown, malformed, low-confidence and recursive selections fall back without executing anything', async () => {
  for (const result of [
    selected('execute_shell'), selected('suggest_tools'),
    { ...selected(), executed: true },
    { ...selected(), strategy: 'legacy' },
    { ...selected(), candidates: [{ name: 'render_video', score: 0.4 }] },
    { ...selected(), needsClarification: true },
    { ...selected(), candidates: [null] },
  ]) {
    const h = await host({ result });
    await h.route();
    const hint = (await h.context()).system[0].text;
    assert.match(hint, /"status":"unavailable"/);
    assert.ok(!hint.includes('execute_shell'));
    assert.equal(h.calls.filter(({ path }) => path === '/v1/ai/tool-selection').length, 1);
    assert.equal(h.prompts.length, 1);
  }
});

test('explicit defer returns to the main model without a second router call', async () => {
  const h = await host({ result: { strategy: 'choice', executed: false, needsClarification: true, candidates: [] } });
  await h.route();
  assert.match((await h.context()).system[0].text, /"status":"deferred"/);
  assert.equal(h.calls.length, 3);
});

test('provider failure is cached and is not retried with another paid request', async () => {
  let submissions = 0;
  const h = await host({ request: async (url) => {
    if (url.pathname === '/v1/ai/tool-selection') {
      submissions++;
      throw new Error(`Sensitive provider failure ${API_KEY}`);
    }
    return jsonResponse(CREDIT_SUMMARY);
  } });
  await h.route();
  const first = (await h.context()).system[0].text;
  assert.match(first, /"status":"unavailable"/);
  assert.ok(!first.includes(API_KEY));
  await h.route();
  assert.equal(submissions, 1);
  assert.match((await h.context()).system[0].text, /"cached":true/);
});

test('unverified credits, missing pricing, debt and insufficient balances never reach the provider', async () => {
  for (const credits of [
    {}, { ...CREDIT_SUMMARY, pricing: { configured: false } },
    { ...CREDIT_SUMMARY, balance: { remaining: 0, debt: 0 } },
    { ...CREDIT_SUMMARY, balance: { remaining: 50, debt: 1 } },
    { ...CREDIT_SUMMARY, balance: { remaining: '900', debt: 0 } },
  ]) {
    const h = await host({ credits });
    await h.route();
    assert.equal(h.calls.length, 1);
    assert.equal(h.permissions.length, 0);
    assert.match((await h.context()).system[0].text, /"status":"unavailable"/);
  }
});

test('low credits are reported without changing the configured rate or estimating an exact cost', async () => {
  const h = await host({ credits: { ...CREDIT_SUMMARY, balance: { remaining: 20, debt: 0 } } });
  await h.route();
  assert.match((await h.context()).system[0].text, /"lowCredits":true/);
});

test('cache keys are scoped to credentials, sessions, intent and the current tool catalog', async () => {
  const h = await host();
  await h.route();
  h.setKey(`mach_${'b'.repeat(64)}`);
  await h.route();
  h.tools.push({ id: 'machinal_compile_recipe' });
  await h.route();
  await h.route('Compile the recipe');
  await h.commands.get('machinal-route').execute({ sessionID: 'session-two', prompt: { text: INTENT }, delivery: 'queue' });
  assert.equal(h.calls.filter(({ path }) => path === '/v1/ai/tool-selection').length, 5);
  assert.equal((await h.context(INTENT, 'unrelated-session')).system.length, 0);
});

test('expired decisions require a new explicit command, never a continuation', async () => {
  let time = 1000;
  const h = await host({ now: () => time });
  await h.route();
  time += 5 * 60_000 + 1;
  await h.context();
  await h.context();
  assert.equal(h.calls.length, 3);
  await h.route();
  assert.equal(h.calls.length, 6);
});

test('a custom approved server is used and invalid multi-server settings fail before network access', async () => {
  const h = await host({ server: 'video-tools' });
  await h.route();
  assert.match((await h.context()).system[0].text, /video-tools_validate_recipe/);
  await assert.rejects(installOpenCodeRouting({ options: { toolRouting: { enabled: true } } }, {
    servers: ['first', 'second'],
  }), /Select one approved/);
});

test('invalid UTF-8 byte length is rejected before any request', async () => {
  const h = await host();
  for (const text of ['', ' ', 'ă'.repeat(3001)]) await assert.rejects(h.route(text), /UTF-8 bytes/);
  assert.equal(h.calls.length, 0);
});

test('missing or changed authentication falls back without accessing another endpoint', async () => {
  const h = await host({ getConnection: async () => { throw new Error(API_KEY); } });
  await h.route();
  const hint = (await h.context()).system[0].text;
  assert.match(hint, /"status":"unavailable"/);
  assert.ok(!hint.includes(API_KEY));
  assert.equal(h.calls.length, 0);
});
