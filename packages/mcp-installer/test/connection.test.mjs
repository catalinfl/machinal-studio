import assert from 'node:assert/strict';
import test from 'node:test';
import { checkConnection, normalizeEndpoint, validateAPIKey } from '../src/connection.mjs';
import { InstallerError } from '../src/errors.mjs';
import { API_KEY, CREDIT_SUMMARY, TOOLS, mcpHandler, reply, requestBody, serve } from './helpers.mjs';

test('origins and MCP paths normalize without guessing a hosted domain', () => {
  assert.equal(normalizeEndpoint('https://api.example.com'), 'https://api.example.com/mcp');
  assert.equal(normalizeEndpoint('http://127.0.0.1:8080/mcp/'), 'http://127.0.0.1:8080/mcp');
  assert.equal(normalizeEndpoint('http://localhost:8080'), 'http://localhost:8080/mcp');
  assert.equal(normalizeEndpoint('http://[::1]:8080'), 'http://[::1]:8080/mcp');
});

for (const value of ['http://api.example.com', 'ftp://localhost', 'https://key:secret@example.com', 'https://example.com?key=secret', 'https://example.com/#secret', 'https://example.com/v1', 'not a url']) {
  test(`unsafe or ambiguous endpoint is refused: ${value}`, () => {
    assert.throws(() => normalizeEndpoint(value), (error) => error instanceof InstallerError && !error.message.includes('secret'));
  });
}

test('only full application keys are accepted and validation never echoes input', () => {
  assert.equal(validateAPIKey(` ${API_KEY}\n`), API_KEY);
  const legacyKey = `dal_${'a'.repeat(64)}`;
  assert.equal(validateAPIKey(legacyKey), legacyKey);
  for (const key of ['', 'provider-secret', 'login-token', 'mach_bad', API_KEY.replace('mach_', 'DAL_'), `${API_KEY}\r\nHeader: injection`]) {
    assert.throws(() => validateAPIKey(key), (error) => error instanceof InstallerError && !error.message.includes('provider-secret'));
  }
});

test('verification uses only handshake and discovery, never paid tools, and forwards required headers', async (t) => {
  const calls = [];
  const endpoint = await serve(t, mcpHandler(calls));
  const result = await checkConnection(endpoint, API_KEY);
  assert.equal(result.toolCount, 3);
  assert.equal(result.credits.balance.remaining, CREDIT_SUMMARY.balance.remaining);
  assert.match(result.mediaWarning, /Full media workflow unavailable/);
  assert.deepEqual(calls.map((call) => call.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  assert.equal(calls[3].tool, 'get_credits');
  for (const call of calls) {
    assert.equal(call.headers.authorization, `Bearer ${API_KEY}`);
    assert.equal(call.headers.origin, undefined);
    assert.equal(call.url, '/mcp');
  }
  assert.equal(calls[2].headers['mcp-protocol-version'], '2025-11-25');
});

test('media capability detection never lists or downloads customer files', async (t) => {
  const calls = [];
  const mediaNames = ['request_media_access', 'list_media', 'get_asset_metadata', 'get_upload_target', 'get_media_download', 'get_video_result', 'get_download_preferences', 'set_download_preferences', 'wait_for_job', 'revoke_delivery_link'];
  const endpoint = await serve(t, mcpHandler(calls, { tools: [...TOOLS, ...mediaNames.map((name) => ({ name }))] }));
  const result = await checkConnection(endpoint, API_KEY);
  assert.equal(result.mediaWarning, undefined);
  assert.ok(calls.every((call) => call.method !== 'tools/call' || call.tool === 'get_credits'));
});

for (const status of [401, 403, 404, 429, 503]) {
  test(`HTTP ${status} is actionable without exposing the response`, async (t) => {
    const endpoint = await serve(t, (_request, response) => { response.writeHead(status).end(API_KEY); });
    await assert.rejects(checkConnection(endpoint, API_KEY), (error) => error.message.includes(String(status)) && !error.message.includes(API_KEY));
  });
}

test('redirects are never followed, so credentials cannot be forwarded to another endpoint', async (t) => {
  let received = 0;
  const target = await serve(t, (_request, response) => { received++; response.writeHead(200).end(); });
  const origin = await serve(t, (_request, response) => { response.writeHead(307, { Location: target }).end(); });
  await assert.rejects(checkConnection(origin, API_KEY), /Redirects are not followed/);
  assert.equal(received, 0);
});

test('RPC errors, wrong IDs, and unexpected server identity never leak server content', async (t) => {
  for (const payload of [
    { jsonrpc: '2.0', id: 1, error: { code: -32600, message: API_KEY } },
    { jsonrpc: '2.0', id: 9, result: { secret: API_KEY } },
    { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', serverInfo: { name: API_KEY } } },
  ]) {
    const endpoint = await serve(t, (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
    });
    await assert.rejects(checkConnection(endpoint, API_KEY), (error) => error instanceof InstallerError && !error.message.includes(API_KEY));
  }
});

test('previous server branding remains compatible until the API is redeployed', async (t) => {
  const endpoint = await serve(t, mcpHandler([], { serverName: 'Machinal' }));
  assert.equal((await checkConnection(endpoint, API_KEY)).toolCount, 3);
});

test('discovery must contain the expected machinal tools', async (t) => {
  const endpoint = await serve(t, async (request, response) => {
    const body = await requestBody(request);
    if (body.method === 'initialize') {
      reply(response, body, { protocolVersion: '2025-11-25', serverInfo: { name: 'machinal' } });
    } else if (body.method === 'notifications/initialized') {
      response.writeHead(202).end();
    } else {
      reply(response, body, { tools: [{ name: 'wrong_tool' }] });
    }
  });
  await assert.rejects(checkConnection(endpoint, API_KEY), /expected machinal tools/);
});

test('HTML, invalid JSON, oversized responses, and timeouts fail safely', async (t) => {
  const html = await serve(t, (_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }).end(API_KEY); });
  await assert.rejects(checkConnection(html, API_KEY), /MCP JSON/);
  const invalid = await serve(t, (_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }).end(API_KEY); });
  await assert.rejects(checkConnection(invalid, API_KEY), /invalid or interrupted/);
  const large = await serve(t, (_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }).end('x'.repeat(2 * 1024 * 1024 + 1)); });
  await assert.rejects(checkConnection(large, API_KEY), /safety limit/);
  const slow = await serve(t, () => {});
  await assert.rejects(checkConnection(slow, API_KEY, { timeout: 30 }), /Could not reach/);
});

test('temporary server failures retry a bounded number of times without calling paid tools', async (t) => {
  let requests = 0;
  const calls = [];
  const handler = mcpHandler(calls);
  const endpoint = await serve(t, (request, response) => {
    if (++requests < 3) return response.writeHead(503).end(API_KEY);
    return handler(request, response);
  });
  const sleeps = [];
  const result = await checkConnection(endpoint, API_KEY, { sleep: async (ms) => sleeps.push(ms) });
  assert.equal(result.toolCount, 3);
  assert.equal(requests, 6);
  assert.deepEqual(sleeps, [250, 500]);
  assert.ok(calls.every((call) => call.method !== 'tools/call' || call.tool === 'get_credits'));
});

test('authentication and rate limiting are never retried automatically and include recovery links', async (t) => {
  for (const status of [401, 402, 403, 429]) {
    let count = 0;
    const endpoint = await serve(t, (_request, response) => { count++; response.writeHead(status).end(API_KEY); });
    await assert.rejects(checkConnection(endpoint, API_KEY), (error) => {
      assert.equal(error.status, status);
      if (status === 401) assert.match(error.message, /https:\/\/machinal\.app\/api-keys/);
      if ([402, 403].includes(status)) assert.match(error.message, /https:\/\/machinal\.app\/membership/);
      assert.ok(!error.message.includes(API_KEY));
      return true;
    });
    assert.equal(count, 1);
  }
});

test('connection refusal retries at most three times and then offers local startup guidance', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED', message: API_KEY } });
  };
  await assert.rejects(checkConnection('http://localhost:8080/mcp', API_KEY, { fetchImpl, sleep: async () => {} }), (error) => {
    assert.equal(error.code, 'network');
    assert.equal(error.retryable, true);
    assert.match(error.message, /Local mode can help/);
    assert.ok(!error.message.includes(API_KEY));
    return true;
  });
  assert.equal(calls, 3);
});

test('optional credit transport failures degrade to a warning, but HTTP authorization loss still aborts', async (t) => {
  for (const status of [503, 401]) {
    const handler = mcpHandler();
    const endpoint = await serve(t, async (request, response) => {
      const body = await requestBody(request);
      if (body.method === 'tools/call') return response.writeHead(status).end(API_KEY);
      await handler({ headers: request.headers, url: request.url, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } }, response);
    });
    if (status === 401) await assert.rejects(checkConnection(endpoint, API_KEY), /401/);
    else {
      const result = await checkConnection(endpoint, API_KEY, { sleep: async () => {} });
      assert.equal(result.credits, null);
      assert.match(result.creditsWarning, /verified balance/);
    }
  }
});
